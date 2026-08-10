/** Dashboard routes: return */
import {
  acknowledgeReturnClosureSchema,
  applyRestockForClosedReturn,
  createReturnRequestSchema,
  ensureUniqueReturnTrackingId,
  findAdmins,
  getContractErrorMessage,
  insertNotification,
  insertNotifications,
  parseWithSchema
} from './dashboardImports.js';
import {
  canRequestReturnForOrder,
  getRemainingReturnableQuantity,
  getReturnRequestBlockReason
} from '../../utils/orderReturnRules.js';
import { listBuyerOutgoingReturns } from '../../services/returnListService.js';
export * from './shared/dashboardHelpers.js';

export function registerDashboardReturnRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase
  } = ctx;

router.post('/service-provider/orders/:id/returns', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const decodedId = decodeURIComponent(id);
    const payload = parseWithSchema(createReturnRequestSchema, req.body || {});
    const { orderItemId, quantity, reason, trackingId } = payload;

    const requestedQty = Number(quantity);
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid quantity' });
    }

    let { data: order } = await supabase
      .from('orders')
      .select('id, order_number, service_provider_id, supplier_id, status')
      .eq('order_number', decodedId)
      .eq('service_provider_id', req.userId)
      .maybeSingle();

    if (!order) {
      const { data: orderById } = await supabase
        .from('orders')
        .select('id, order_number, service_provider_id, supplier_id, status')
        .eq('id', decodedId)
        .eq('service_provider_id', req.userId)
        .maybeSingle();
      order = orderById || null;
    }

    if (!order) {
      return res.status(404).json({ status: 'error', message: 'Order not found' });
    }

    if (!canRequestReturnForOrder({ status: order.status })) {
      return res.status(400).json({
        status: 'error',
        message: getReturnRequestBlockReason({ status: order.status })
      });
    }

    const { data: orderItem } = await supabase
      .from('order_items')
      .select('id, quantity')
      .eq('id', orderItemId)
      .eq('order_id', order.id)
      .maybeSingle();

    if (!orderItem) {
      return res.status(404).json({ status: 'error', message: 'Order item not found' });
    }

    const orderedQty = Number(orderItem.quantity || 0);
    const { data: existingReturns } = await supabase
      .from('order_returns')
      .select('id, quantity, status')
      .eq('order_item_id', orderItem.id);

    const remainingQty = getRemainingReturnableQuantity(orderedQty, existingReturns || []);
    if (remainingQty <= 0) {
      return res.status(400).json({
        status: 'error',
        message: 'All units for this item have already been requested for return.'
      });
    }
    if (requestedQty > remainingQty) {
      return res.status(400).json({
        status: 'error',
        message: `Return quantity cannot exceed remaining returnable quantity (${remainingQty})`
      });
    }

    const statusHistory = [
      {
        status: 'requested',
        by: req.userId,
        note: reason,
        at: new Date().toISOString()
      }
    ];

    const activeReturnCount = (existingReturns || []).filter(
      (row) => String(row?.status || '').toLowerCase() !== 'rejected'
    ).length;

    let uniqueTrackingId;
    try {
      uniqueTrackingId = await ensureUniqueReturnTrackingId({
        preferredTrackingId: trackingId,
        orderNumber: order.order_number,
        orderItemId: orderItem.id,
        existingReturnCountOnItem: activeReturnCount
      });
    } catch (trackingErr) {
      if (String(trackingErr?.name || '') === 'TrackingIdTakenError') {
        return res.status(400).json({ status: 'error', message: trackingErr.message });
      }
      throw trackingErr;
    }

    const insertReturn = async (trackingValue) =>
      supabase
        .from('order_returns')
        .insert({
          order_id: order.id,
          order_item_id: orderItem.id,
          service_provider_id: req.userId,
          supplier_id: order.supplier_id,
          quantity: requestedQty,
          reason: String(reason).trim(),
          tracking_id: trackingValue,
          status: 'requested',
          status_history: statusHistory
        })
        .select('*')
        .single();

    let { data: created, error: createErr } = await insertReturn(uniqueTrackingId);

    if (
      createErr &&
      String(createErr.code || '') === '23505' &&
      /tracking_id/i.test(String(createErr.message || createErr.details || ''))
    ) {
      const retryTrackingId = await ensureUniqueReturnTrackingId({
        orderNumber: order.order_number,
        orderItemId: orderItem.id,
        existingReturnCountOnItem: activeReturnCount + 1
      });
      ({ data: created, error: createErr } = await insertReturn(retryTrackingId));
    }

    if (createErr) {
      console.error('[Returns] create error:', createErr);
      if (String(createErr.code || '') === '23505') {
        return res.status(400).json({
          status: 'error',
          message: 'This tracking ID is already in use. Choose a different ID or leave blank to auto-generate one.'
        });
      }
      return res.status(500).json({ status: 'error', message: 'Failed to create return request' });
    }

    // Notify supplier
    try {
      await insertNotification({
        user_id: order.supplier_id,
        type: 'order_return_requested',
        title: `Return requested for ${order.order_number}`,
        message: `A return request was created for order ${order.order_number}.`,
        related_order_id: order.id,
        is_read: false,
        metadata: {
          returnId: created.id,
          orderItemId: orderItem.id,
          quantity: requestedQty
        }
      }, supabase);
    } catch (notifErr) {
      console.error('[Returns] supplier notification failed:', notifErr);
    }

    // Notify admins as well (return requests are operationally important).
    try {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
      const { data: admins } = await findAdmins(adminEmail, supabase);

      if (admins && admins.length > 0) {
        const notifications = admins.map((admin) => ({
          user_id: admin.id,
          type: 'order_return_requested',
          title: `Return requested for ${order.order_number}`,
          message: `Service provider requested return for order ${order.order_number}.`,
          related_order_id: order.id,
          is_read: false,
          metadata: {
            returnId: created.id,
            orderItemId: orderItem.id,
            quantity: requestedQty,
            supplierId: order.supplier_id,
            serviceProviderId: req.userId
          }
        }));
        await insertNotifications(notifications, supabase);
      }
    } catch (adminNotifErr) {
      console.error('[Returns] admin notification failed:', adminNotifErr);
    }

    return res.json({ status: 'success', returnRequest: created });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('[Returns] create request error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// List return requests initiated by current buyer (scope=retail|upstream)
router.get('/service-provider/returns', authenticateToken, async (req, res) => {
  try {
    const { returns, scope } = await listBuyerOutgoingReturns(
      supabase,
      req.userId,
      req.query.scope
    );
    return res.json({ status: 'success', scope, returns });
  } catch (error) {
    console.error('[Returns] service-provider list exception:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch return requests' });
  }
});

// Confirm return completion from the service-provider side (after supplier has closed the return).
// Applies inventory restock idempotently — safe if stock was already restored when the supplier marked closed.
router.patch('/service-provider/returns/:id/acknowledge-closure', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(acknowledgeReturnClosureSchema, req.body || {});
    const { id } = req.params;

    const { data: row, error: fetchErr } = await supabase
      .from('order_returns')
      .select('*')
      .eq('id', id)
      .eq('service_provider_id', req.userId)
      .maybeSingle();

    if (fetchErr || !row) {
      return res.status(404).json({ status: 'error', message: 'Return request not found' });
    }

    if (String(row.status || '') !== 'closed') {
      return res.status(400).json({
        status: 'error',
        message:
          'The supplier must mark this return as closed before you can confirm completion.'
      });
    }

    const meta = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
    const alreadyAcked = Boolean(meta.buyer_acknowledged_closure_at);
    const buyerAt = new Date().toISOString();

    let merged = row;
    if (!alreadyAcked) {
      const { data: updated, error: updErr } = await supabase
        .from('order_returns')
        .update({
          metadata: { ...meta, buyer_acknowledged_closure_at: buyerAt }
        })
        .eq('id', id)
        .eq('service_provider_id', req.userId)
        .select('*')
        .single();

      if (updErr) {
        console.error('[Returns] acknowledge-closure update error:', updErr);
        return res.status(500).json({ status: 'error', message: 'Failed to update return request' });
      }
      merged = updated;
    }

    // Inventory is restored when the supplier closes the return. Keep this call as an
    // idempotent safety net for older closed returns that may not have been restocked yet.
    let restock = { ok: true, already: true, reason: 'closed_auto_restocked' };
    try {
      restock = await applyRestockForClosedReturn(merged, req.userId);
    } catch (restockErr) {
      console.error('[Returns] acknowledge-closure restock error:', restockErr);
      return res.status(500).json({
        status: 'error',
        message:
          'Your confirmation was saved, but inventory could not be updated. Please try again or contact support.',
        returnRequest: merged,
        inventory: { ok: false, error: String(restockErr.message || restockErr) }
      });
    }

    return res.json({
      status: 'success',
      returnRequest: merged,
      inventory: restock
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('[Returns] acknowledge-closure exception:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Update payment status for service provider order
}
