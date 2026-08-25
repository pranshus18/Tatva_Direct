/** Supplier routes: order */
import {
  applyRestockForClosedReturn,
  generateAndAttachReceiptPdf,
  RECEIPT_PDF_LAYOUT_VERSION,
  getContractErrorMessage,
  insertNotification,
  getInvalidPrimaryStatusTransitionMessage,
  isCancelledOrderStatus,
  isValidPrimaryOrderStatus,
  isValidPrimaryStatusTransition,
  logger,
  mergeOrderItemSpecificationsForDisplay,
  parseSpecificationsObject,
  parseWithSchema,
  recordInventoryMovement,
  retrySupabaseQuery,
  supplierOrderStatusPatchSchema,
  supplierReturnStatusPatchSchema,
  toLifecycleStateFromStatus
} from './supplierImports.js';
import {
  normalizeUserAddress
} from './shared/productHelpers.js';
import { isValidSupplierReturnTransition } from '../../utils/orderReturnRules.js';
import { listSupplierIncomingReturns } from '../../services/returnListService.js';
import { enrichOrderItemsWithVariantImages } from '../../services/productImageService.js';
import { sumOrderItemQuantities } from '../../utils/orderItemQuantity.js';
import {
  healOrderPaymentStatusIfPaid,
  resolveEffectivePaymentStatus
} from '../../utils/effectivePaymentStatus.js';

export function registerSupplierOrderRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase,
    resolveTaxRatesForProductCreate
  } = ctx;

router.get('/orders', authenticateToken, async (req, res) => {
  try {
    const scopeRaw = String(req.query.scope || 'all').trim().toLowerCase();
    const scope = ['retail', 'chain', 'all'].includes(scopeRaw) ? scopeRaw : 'all';

    // Use retry logic for transient SSL/network errors
    const result = await retrySupabaseQuery(async () => {
      return await supabase
        .from('orders')
        .select(`
          *,
          service_provider:users!orders_service_provider_id_fkey (id, name, company, email, phone, user_type),
          order_items (
            *,
            product:products (id, name, category, unit, price)
          ),
          boq:boqs (id, name)
        `)
        .eq('supplier_id', req.userId)
        .order('created_at', { ascending: false });
    }, {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 5000
    });
    
    if (result.error) {
      // Check if it's a transient error that we couldn't recover from
      const errorMessage = result.error.message?.toLowerCase() || '';
      if (errorMessage.includes('ssl handshake') || errorMessage.includes('525') || errorMessage.includes('cloudflare')) {
        console.error('Get orders error (SSL/Network):', result.error.message?.substring(0, 200));
        // Return empty array instead of error for better UX
        return res.json({ 
          status: 'success',
          orders: [],
          scope,
          warning: 'Unable to fetch orders due to network issues. Please try again in a moment.'
        });
      }
      throw result.error;
    }

    const rawOrders = result.data || [];
    const scopedOrders = rawOrders.filter((order) => {
      const buyer = order.service_provider;
      const chainUpstreamOrder =
        String(order.channel || '').toLowerCase() === 'b2b_po' &&
        String(buyer?.user_type || '').toLowerCase() === 'supplier';
      if (scope === 'chain') return chainUpstreamOrder;
      if (scope === 'retail') return !chainUpstreamOrder;
      return true;
    });

    const orderIds = scopedOrders.map((o) => o.id).filter(Boolean);
    let invoiceByOrderId = new Map();
    if (orderIds.length > 0) {
      const { data: invoiceRows } = await supabase
        .from('invoices')
        .select('order_id, invoice_number, metadata')
        .in('order_id', orderIds);
      invoiceByOrderId = new Map((invoiceRows || []).map((inv) => [inv.order_id, inv]));
    }
    const ordersWithInvoices = scopedOrders.map((o) => {
      const inv = invoiceByOrderId.get(o.id);
      const buyer = o.service_provider;
      const chainUpstreamOrder =
        String(o.channel || '').toLowerCase() === 'b2b_po' &&
        String(buyer?.user_type || '').toLowerCase() === 'supplier';
      return {
        id: o.id,
        orderNumber: o.order_number || o.id,
        customer: buyer?.name || buyer?.company || 'Service Provider',
        company: buyer?.company || '',
        amount: parseFloat(o.total_amount || 0),
        totalAmount: parseFloat(o.total_amount || 0),
        status: o.status,
        paymentStatus: resolveEffectivePaymentStatus({ order: o }),
        paymentMethod: o.payment_method || null,
        createdAt: o.created_at,
        updatedAt: o.updated_at || o.created_at,
        itemCount: sumOrderItemQuantities(o.order_items),
        channel: o.channel || null,
        chainUpstreamOrder,
        buyerIsSupplier: String(buyer?.user_type || '').toLowerCase() === 'supplier',
        invoiceNumber: inv?.invoice_number || null,
        invoicePdfUrl: inv?.metadata?.pdfUrl || null,
        trackingNumber: o.tracking_number || null,
        shippingProvider: o.shipping_provider || null,
        expectedDeliveryDate: o.expected_delivery_date || null
      };
    });

    res.json({
      status: 'success',
      scope,
      orders: ordersWithInvoices
    });
  } catch (error) {
    console.error('Get orders error:', error);
    
    // For network/SSL errors, return empty array instead of error
    const errorMessage = error.message?.toLowerCase() || String(error).toLowerCase();
    if (errorMessage.includes('ssl handshake') || errorMessage.includes('525') || errorMessage.includes('cloudflare') || errorMessage.includes('network')) {
      return res.json({ 
        status: 'success',
        orders: [],
        warning: 'Unable to fetch orders due to network issues. Please try again in a moment.'
      });
    }
    
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

// Inventory summary for the logged-in supplier (by outlet)

router.get('/orders/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const decodedId = decodeURIComponent(id);
    
    console.log(`[Supplier Order Details] Fetching order details for ID: ${decodedId}, User: ${req.userId} (type: ${typeof req.userId})`);
    
    // Try to find by orderNumber first
    let { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          *,
          product:products (id, name, category, unit, price, description, location, specifications)
        ),
        boq:boqs (id, name)
      `)
      .eq('order_number', decodedId)
      .eq('supplier_id', req.userId)
      .single();
    
    if (orderError) {
      console.log(`[Supplier Order Details] Error finding by order_number:`, orderError);
    } else if (order) {
      console.log(`[Supplier Order Details] Found order by order_number: ${order.id}`);
    }
    
    // If not found by orderNumber, try id
    if (orderError || !order) {
      console.log(`[Supplier Order Details] Trying to find by ID: ${decodedId}`);
      const { data: orderById, error: orderByIdError } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            *,
            product:products (id, name, category, unit, price, description, location, specifications)
          ),
          boq:boqs (id, name)
        `)
        .eq('id', decodedId)
        .eq('supplier_id', req.userId)
        .single();
      
      if (orderByIdError) {
        console.log(`[Supplier Order Details] Error finding by id:`, orderByIdError);
      }
      
      if (!orderByIdError && orderById) {
        order = orderById;
        orderError = null;
        console.log(`[Supplier Order Details] Found order by id: ${order.id}`);
      }
    }
    
    if (orderError || !order) {
      console.log(`[Supplier Order Details] Order not found: ${decodedId} for user ${req.userId}`);
      // Debug: Check if order exists for any supplier
      const { data: anyOrder, count } = await supabase
        .from('orders')
        .select('id, order_number, supplier_id', { count: 'exact' })
        .or(`order_number.eq.${decodedId},id.eq.${decodedId}`);
      console.log(`[Supplier Order Details] Debug: Found ${count || 0} orders with ID/order_number ${decodedId}`);
      if (anyOrder && anyOrder.length > 0) {
        console.log(`[Supplier Order Details] Debug: Order exists but supplier_id mismatch:`, {
          order_supplier_id: anyOrder[0].supplier_id,
          request_user_id: req.userId,
          match: anyOrder[0].supplier_id === req.userId
        });
      }
      return res.status(404).json({ 
        status: 'error',
        message: 'Order not found or you do not have permission to view this order' 
      });
    }
    
    console.log(`[Supplier Order Details] Order found: ${order.id}, service_provider_id: ${order.service_provider_id}`);
    
    // Fetch service provider separately
    let serviceProvider = null;
    if (order.service_provider_id) {
      const { data: serviceProviderData, error: serviceProviderError } = await supabase
        .from('users')
        .select('id, name, company, email, phone, address, profile, user_type')
        .eq('id', order.service_provider_id)
        .single();
      
      if (serviceProviderError) {
        console.error(`[Supplier Order Details] Error fetching service provider:`, serviceProviderError);
      } else {
        serviceProvider = {
          ...serviceProviderData,
          address: normalizeUserAddress(serviceProviderData?.address || {})
        };
        console.log(`[Supplier Order Details] Service provider fetched:`, serviceProvider?.name || serviceProvider?.company || 'N/A');
      }
    } else {
      console.log(`[Supplier Order Details] No service_provider_id in order`);
    }
    
    // Format order for frontend.
    // Use immutable order snapshot fields so placed orders never drift with later edits.
    // Resolve images from the ordered supplier offer/variant — not catalog products.images.
    const rawOrderItems = Array.isArray(order.order_items) ? order.order_items : [];
    const orderItemsWithImages = await enrichOrderItemsWithVariantImages(supabase, rawOrderItems);
    order.order_items = orderItemsWithImages.map((it) => {
      const snapshot = parseSpecificationsObject(it?.specifications) || {};
      const variantAttributes =
        snapshot?.variantAttributes && typeof snapshot.variantAttributes === 'object'
          ? snapshot.variantAttributes
          : {};
      const productSpecs = parseSpecificationsObject(it?.product?.specifications);
      const displaySpecifications = mergeOrderItemSpecificationsForDisplay(productSpecs, snapshot);

      return {
        ...it,
        specifications: displaySpecifications,
        unitPrice: parseFloat(it?.unit_price ?? it?.unitPrice ?? 0) || 0,
        totalPrice: parseFloat(it?.total_price ?? it?.totalPrice ?? 0) || 0,
        asin: snapshot?.parentAsin || it?.product?.asin || null,
        parentAsin: snapshot?.parentAsin || it?.product?.asin || null,
        variantKey: snapshot?.variantKey || null,
        variantAsin: snapshot?.variantAsin || null,
        productTrackingId: snapshot?.variantAsin || null,
        brandModel: snapshot?.brandModel ?? variantAttributes?.brandModel ?? null
      };
    });

    // Attach invoice + PDF URL (if invoice PDF was generated after payment)
    let invoice = null;
    try {
      const { data: invoiceRow } = await supabase
        .from('invoices')
        .select('*')
        .eq('order_id', order.id)
        .maybeSingle();
      invoice = invoiceRow || null;
    } catch (e) {
      console.error('[Supplier Order Details] Failed to fetch invoice:', e);
    }
    let receipt = null;
    try {
      const { data: receiptRow } = await supabase
        .from('payment_receipts')
        .select('*')
        .eq('order_id', order.id)
        .maybeSingle();
      receipt = receiptRow || null;
      if (
        receipt &&
        (!receipt?.metadata?.pdfUrl ||
          Number(receipt?.metadata?.pdfLayoutVersion || 0) < RECEIPT_PDF_LAYOUT_VERSION)
      ) {
        const { data: supplierData } = await supabase
          .from('users')
          .select('id, name, company, email, phone, address, profile, user_type')
          .eq('id', req.userId)
          .maybeSingle();
        const backfilled = await generateAndAttachReceiptPdf({
          receipt,
          order,
          supplier: supplierData || { id: req.userId, name: 'Supplier' },
          serviceProvider
        });
        receipt = backfilled?.receipt || receipt;
      }
      order = await healOrderPaymentStatusIfPaid(supabase, order, receipt);
    } catch (e) {
      console.error('[Supplier Order Details] Failed to fetch receipt:', e);
    }

    let returns = [];
    try {
      const { data: returnRows } = await supabase
        .from('order_returns')
        .select('*')
        .eq('order_id', order.id)
        .eq('supplier_id', req.userId)
        .order('created_at', { ascending: false });
      returns = returnRows || [];
    } catch (e) {
      console.error('[Supplier Order Details] Failed to fetch returns:', e);
    }

    const formattedOrder = {
      ...order,
      orderNumber: order.order_number || order.id,
      totalAmount: parseFloat(order.total_amount || 0),
      paymentStatus: resolveEffectivePaymentStatus({ order, receipt }),
      paymentMethod: order.payment_method,
      status: order.status || 'pending',
      createdAt: order.created_at,
      updatedAt: order.updated_at || order.created_at,
      channel: order.channel || null,
      statusHistory: Array.isArray(order.status_history) ? order.status_history : [],
      trackingNumber: order.tracking_number || null,
      trackingUrl: order.tracking_url || null,
      shippingProvider: order.shipping_provider || null,
      expectedDeliveryDate: order.expected_delivery_date,
      actualDeliveryDate: order.actual_delivery_date,
      deliveryAddress: order.delivery_address,
      items: order.order_items || [],
      serviceProvider: serviceProvider,
      boq: order.boq || null,
      invoice: invoice,
      invoicePdfUrl: invoice?.metadata?.pdfUrl || null,
      receipt: receipt,
      receiptPdfUrl: receipt?.metadata?.pdfUrl || null,
      returns
    };
    
    console.log(`[Supplier Order Details] Returning order details for: ${formattedOrder.orderNumber}`);
    
    res.json({ 
      status: 'success',
      order: formattedOrder
    });
  } catch (error) {
    console.error('[Supplier Order Details] Get supplier order details error:', error);
    console.error('[Supplier Order Details] Error stack:', error.stack);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: error.message 
    });
  }
});

// List return requests for current supplier (scope=customer|chain)
router.get('/returns', authenticateToken, async (req, res) => {
  try {
    const { returns, scope } = await listSupplierIncomingReturns(
      supabase,
      req.userId,
      req.query.scope
    );
    return res.json({ status: 'success', scope, returns });
  } catch (error) {
    console.error('[Supplier Returns] list exception:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to fetch return requests' });
  }
});

// Update return status (supplier workflow)
router.patch('/returns/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const payloadInput = parseWithSchema(supplierReturnStatusPatchSchema, req.body || {});
    const { status, supplierNotes } = payloadInput;

    const { data: existing } = await supabase
      .from('order_returns')
      .select('*')
      .eq('id', id)
      .eq('supplier_id', req.userId)
      .maybeSingle();

    if (!existing) {
      return res.status(404).json({ status: 'error', message: 'Return request not found' });
    }

    if (existing.status === status) {
      // Idempotent restock for already-closed returns that may have missed inventory sync.
      if (status === 'closed') {
        try {
          const restock = await applyRestockForClosedReturn(existing, req.userId);
          return res.json({ status: 'success', returnRequest: existing, inventory: restock });
        } catch (restockErr) {
          console.error('[Supplier Returns] closed restock retry failed:', restockErr);
          return res.status(500).json({
            status: 'error',
            message: 'Return is already closed, but inventory could not be restocked. Please try again.',
            inventory: { ok: false, error: String(restockErr?.message || restockErr) }
          });
        }
      }
      return res.json({ status: 'success', returnRequest: existing });
    }

    if (!isValidSupplierReturnTransition(existing.status, status)) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot move return from "${existing.status}" to "${status}".`
      });
    }

    const history = Array.isArray(existing.status_history) ? existing.status_history : [];
    history.push({
      status,
      by: req.userId,
      note: supplierNotes || '',
      at: new Date().toISOString()
    });

    const closingNow = status === 'closed' && existing.status !== 'closed';
    const prevMeta =
      existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
    const metadataPatch = closingNow
      ? { ...prevMeta, supplier_closed_at: new Date().toISOString() }
      : prevMeta;

    const { data: updated, error: updateErr } = await supabase
      .from('order_returns')
      .update({
        status,
        supplier_notes: supplierNotes || existing.supplier_notes || null,
        status_history: history,
        ...(closingNow ? { metadata: metadataPatch } : {})
      })
      .eq('id', id)
      .eq('supplier_id', req.userId)
      .select('*')
      .single();

    if (updateErr) {
      console.error('[Supplier Returns] update error:', updateErr);
      return res.status(500).json({ status: 'error', message: 'Failed to update return status' });
    }

    // Restock seller inventory as soon as the return is closed (retail + upstream).
    // applyRestockForClosedReturn is idempotent, so buyer acknowledge-closure can safely retry.
    let restockResult = null;
    if (closingNow) {
      try {
        restockResult = await applyRestockForClosedReturn(updated, req.userId);
        if (restockResult.ok && !restockResult.skipped && !restockResult.already) {
          console.log('[Supplier Returns] return restocked on close', {
            returnId: existing.id,
            qtyToAdd: restockResult.qtyToAdd
          });
        } else if (restockResult && restockResult.ok === false) {
          console.error('[Supplier Returns] auto-restock on close did not apply', {
            returnId: existing.id,
            reason: restockResult.reason
          });
        }
      } catch (restockErr) {
        console.error('[Supplier Returns] auto-restock on close failed:', restockErr);
        restockResult = {
          ok: false,
          error: String(restockErr?.message || restockErr)
        };
      }
    }

    // Notify service provider
    try {
      const message = closingNow
        ? `Your return request for order ${existing.order_id} is now ${status}. Inventory has been restored to the supplier automatically.`
        : `Your return request for order ${existing.order_id} is now ${status}.`;
      await insertNotification({
        user_id: existing.service_provider_id,
        type: 'order_return_status_updated',
        title: `Return ${status.replace('_', ' ')}`,
        message,
        related_order_id: existing.order_id,
        is_read: false,
        metadata: { returnId: existing.id, status }
      }, supabase);
    } catch (notifErr) {
      console.error('[Supplier Returns] notification error:', notifErr);
    }

    return res.json({
      status: 'success',
      returnRequest: updated,
      ...(closingNow ? { inventory: restockResult } : {})
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('[Supplier Returns] update exception:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Update order status (and optional tracking info for shipments)
router.patch('/orders/:id/status', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierOrderStatusPatchSchema, req.body || {});
    const { status, notes, shippingProvider, trackingNumber, trackingUrl } = payloadInput;
    const { id } = req.params;
    const decodedId = decodeURIComponent(id);
    
    console.log(`Updating order status for ID: ${decodedId}, Status: ${status}, User: ${req.userId}`);
    
    if (!status) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Status is required' 
      });
    }
    
    // Validate status
    const normalizedStatus = String(status || '').trim().toLowerCase();
    const validStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'returned'];
    if (!isValidPrimaryOrderStatus(normalizedStatus)) {
      return res.status(400).json({ 
        status: 'error',
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}` 
      });
    }
    
    // Try to find by orderNumber first
    let { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_number', decodedId)
      .eq('supplier_id', req.userId)
      .single();
    
    // If not found by orderNumber, try id
    if (orderError || !order) {
      const { data: orderById, error: orderByIdError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', decodedId)
        .eq('supplier_id', req.userId)
        .single();
      
      if (!orderByIdError && orderById) {
        order = orderById;
        orderError = null;
      }
    }
    
    if (orderError || !order) {
      logger.debug(`Order not found for status update: ${decodedId} for user ${req.userId}`);
      return res.status(404).json({ 
        status: 'error',
        message: 'Order not found or you do not have permission to update this order' 
      });
    }

    const previousStatus = String(order.status || '');
    if (
      isCancelledOrderStatus(previousStatus) ||
      isCancelledOrderStatus(order.lifecycle_state)
    ) {
      return res.status(400).json({
        status: 'error',
        message: 'This order is cancelled and the status cannot be changed.'
      });
    }
    if (!isValidPrimaryStatusTransition(previousStatus, normalizedStatus)) {
      return res.status(400).json({
        status: 'error',
        message: getInvalidPrimaryStatusTransitionMessage(previousStatus, normalizedStatus)
      });
    }

    // Get current status history
    const statusHistory = order.status_history || [];
    
    // Record the NEW status event in history (so timeline matches the displayed status)
    statusHistory.push({
      status: normalizedStatus,
      updatedBy: req.userId,
      notes: notes || `Status updated to ${normalizedStatus}`,
      timestamp: new Date().toISOString()
    });
    
    // Update status
    const updatePayload = { 
      status: normalizedStatus,
      lifecycle_state: toLifecycleStateFromStatus(normalizedStatus),
      status_history: statusHistory
    };

    // Arrival tracking: set actual delivery date when supplier marks delivered
    if (normalizedStatus === 'delivered') {
      updatePayload.actual_delivery_date = new Date().toISOString();
    }

    // Allow supplier to attach/update tracking info (mainly when marking as shipped)
    if (typeof shippingProvider === 'string') {
      updatePayload.shipping_provider = shippingProvider || null;
    }
    if (typeof trackingNumber === 'string') {
      updatePayload.tracking_number = trackingNumber || null;
    }
    if (typeof trackingUrl === 'string') {
      updatePayload.tracking_url = trackingUrl || null;
    }

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', order.id)
      .select(`
        *,
        service_provider:users!orders_service_provider_id_fkey (id, name, company, email, phone, address),
        order_items (
          *,
          product:products (id, name, category, unit, price, description, location, specifications)
        ),
        boq:boqs (id, name)
      `)
      .single();
    
    if (updateError) {
      logger.error('Update error:', updateError);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to update order status'
      });
    }

    // If supplier cancels an order, restore their inventory (seller stock) for all line items.
    // We do it after successful status update and prevent double-restock using inventory_movements.
    if (normalizedStatus === 'cancelled' && previousStatus !== 'cancelled') {
      try {
        const { data: existingRestock } = await supabase
          .from('inventory_movements')
          .select('id')
          .eq('reference_order_id', order.id)
          .eq('movement_type', 'adjustment')
          .ilike('notes', '%cancel_restock%')
          .limit(1);

        const already = existingRestock && existingRestock.length > 0;
        if (!already) {
          const { data: items } = await supabase
            .from('order_items')
            .select('id, product_id, supplier_product_id, quantity')
            .eq('order_id', order.id);

          for (const it of items || []) {
            const qty = parseFloat(it.quantity || 0) || 0;
            if (!qty || qty <= 0) continue;
            if (!it.supplier_product_id) continue;

            await recordInventoryMovement({
              supplierProductId: it.supplier_product_id,
              supplierId: order.supplier_id,
              productId: it.product_id,
              quantityChange: Math.round(qty),
              movementType: 'adjustment',
              referenceOrderId: order.id,
              referenceOrderItemId: it.id,
              notes: 'cancel_restock: inventory added back due to order cancellation',
              userId: req.userId
            });
          }
        }
      } catch (e) {
        logger.error('[Supplier Cancel] inventory restock failed:', e);
      }
    }
    
    logger.info(`Order status updated successfully: ${updatedOrder.order_number} to ${normalizedStatus}`);

    // Notify the buyer (service_provider / chain partner) so upstream orders are trackable from their portal.
    const buyerId = updatedOrder.service_provider_id;
    if (buyerId && buyerId !== req.userId) {
      try {
        await insertNotification({
          user_id: buyerId,
          type: 'order_status',
          title: `Order ${updatedOrder.order_number} — ${normalizedStatus}`,
          message: `Your supplier updated the order status to "${normalizedStatus}".`,
          related_order_id: updatedOrder.id,
          is_read: false,
          metadata: {
            orderNumber: updatedOrder.order_number,
            previousStatus: previousStatus,
            newStatus: normalizedStatus,
            supplierId: req.userId
          }
        }, supabase);
      } catch (notifErr) {
        logger.error('[Supplier Order Status] buyer notification error:', notifErr);
      }
    }
    
    res.json({ 
      status: 'success',
      message: 'Order status updated successfully',
      order: updatedOrder
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update order status error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: error.message 
    });
  }
});
}
