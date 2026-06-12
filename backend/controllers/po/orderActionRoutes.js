/** PO routes: orderAction */
import {
  PAYMENT_METHODS_ALLOWED,
  canRateSupplierForOrder,
  canSelfServeCancelOrder,
  canSelfServeEditOrder,
  cancelOrderWithAtomicRestock,
  findServiceProviderOrderByIdentifier,
  getContractErrorMessage,
  logger,
  parseWithSchema,
  poCancelSchema,
  poRatingSchema,
  poSelfServePatchSchema,
  restockInventoryForCancelledOrder,
  toLifecycleStateFromStatus
} from './poImports.js';

export function registerPoOrderActionRoutes(ctx) {
  const {
    router,
    authenticateToken,
    isServiceProvider,
    isServiceProviderOrSupplier,
    supabase
  } = ctx;

router.post('/:id/rating', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(poRatingSchema, req.body || {});
    const { id } = req.params;
    const decodedId = decodeURIComponent(id);
    const { rating, feedback } = payload;

    // Basic validation
    const numericRating = parseInt(rating, 10);
    if (!numericRating || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({
        status: 'error',
        message: 'Rating must be a number between 1 and 5'
      });
    }

    // Find order by order_number first, then by id
    let { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_number', decodedId)
      .eq('service_provider_id', req.userId)
      .single();

    if (orderError || !order) {
      const { data: orderById, error: orderByIdError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', decodedId)
        .eq('service_provider_id', req.userId)
        .single();

      if (!orderByIdError && orderById) {
        order = orderById;
        orderError = null;
      }
    }

    if (orderError || !order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to rate this order'
      });
    }

    // Only allow rating after payment is completed and order delivered
    if (!canRateSupplierForOrder({ status: order.status, paymentStatus: order.payment_status })) {
      return res.status(400).json({
        status: 'error',
        message: 'You can only rate a supplier after the order is delivered and payment is marked as paid'
      });
    }

    const supplierId = order.supplier_id;
    if (!supplierId) {
      return res.status(400).json({
        status: 'error',
        message: 'This order does not have a linked supplier'
      });
    }

    // Check if a rating already exists for this order + service provider
    const { data: existingRating } = await supabase
      .from('supplier_ratings')
      .select('*')
      .eq('order_id', order.id)
      .eq('service_provider_id', req.userId)
      .single();

    let savedRating;
    if (existingRating) {
      const { data, error } = await supabase
        .from('supplier_ratings')
        .update({
          rating: numericRating,
          feedback: feedback || existingRating.feedback || null
        })
        .eq('id', existingRating.id)
        .select()
        .single();

      if (error) {
        throw error;
      }
      savedRating = data;
    } else {
      const { data, error } = await supabase
        .from('supplier_ratings')
        .insert({
          order_id: order.id,
          supplier_id: supplierId,
          service_provider_id: req.userId,
          rating: numericRating,
          feedback: feedback || null
        })
        .select()
        .single();

      if (error) {
        throw error;
      }
      savedRating = data;
    }

    return res.json({
      status: 'success',
      message: 'Thank you for your feedback! Your rating has been recorded.',
      rating: savedRating
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.error('Supplier rating error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to submit rating. Please try again later.',
      error: error.message
    });
  }
});

router.get('/:id/rating', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const decodedId = decodeURIComponent(req.params.id);
    const { order, orderError } = await findServiceProviderOrderByIdentifier(decodedId, req.userId);
    if (orderError || !order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to view this rating'
      });
    }

    const { data: ratingRow } = await supabase
      .from('supplier_ratings')
      .select('*')
      .eq('order_id', order.id)
      .eq('service_provider_id', req.userId)
      .maybeSingle();

    return res.json({
      status: 'success',
      rating: ratingRow || null
    });
  } catch (error) {
    logger.error('Get supplier rating error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to load rating',
      error: error.message
    });
  }
});

router.patch('/:id/self-serve', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const decodedId = decodeURIComponent(req.params.id);
    const { order, orderError } = await findServiceProviderOrderByIdentifier(decodedId, req.userId);
    if (orderError || !order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to edit this order'
      });
    }

    if (!canSelfServeEditOrder({ status: order.status, paymentStatus: order.payment_status })) {
      return res.status(400).json({
        status: 'error',
        message: 'This order can only be edited while it is pending/confirmed and unpaid'
      });
    }

    const payload = parseWithSchema(poSelfServePatchSchema, req.body || {});
    const { expectedDeliveryDate, paymentMethod, notes, deliveryAddress } = payload;
    const updateData = {};

    if (typeof expectedDeliveryDate !== 'undefined') {
      if (!expectedDeliveryDate) {
        updateData.expected_delivery_date = null;
      } else {
        const parsed = new Date(expectedDeliveryDate);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ status: 'error', message: 'Invalid expectedDeliveryDate' });
        }
        updateData.expected_delivery_date = parsed.toISOString();
      }
    }

    if (typeof paymentMethod !== 'undefined') {
      const normalized = String(paymentMethod || '').trim().toLowerCase();
      if (!PAYMENT_METHODS_ALLOWED.has(normalized)) {
        return res.status(400).json({
          status: 'error',
          message: `Invalid paymentMethod. Allowed values: ${Array.from(PAYMENT_METHODS_ALLOWED).join(', ')}`
        });
      }
      updateData.payment_method = normalized;
    }

    if (typeof notes !== 'undefined') {
      updateData.notes = String(notes || '').trim() || null;
    }

    if (deliveryAddress && typeof deliveryAddress === 'object') {
      const nextAddress = {
        ...(order.delivery_address || {}),
        ...deliveryAddress
      };
      updateData.delivery_address = nextAddress;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No editable fields provided'
      });
    }

    const currentStatusHistory = Array.isArray(order.status_history) ? order.status_history : [];
    currentStatusHistory.push({
      status: order.status || 'pending',
      timestamp: new Date().toISOString(),
      updatedBy: req.userId,
      notes: 'Self-serve order edit by service provider'
    });
    updateData.status_history = currentStatusHistory;

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', order.id)
      .select('*')
      .single();

    if (updateError || !updatedOrder) {
      throw updateError || new Error('Failed to update order');
    }

    return res.json({
      status: 'success',
      message: 'Order updated successfully',
      order: updatedOrder
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.error('Self-serve order edit error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to update order',
      error: error.message
    });
  }
});

router.post('/:id/cancel', authenticateToken, isServiceProviderOrSupplier, async (req, res) => {
  try {
    const decodedId = decodeURIComponent(req.params.id);
    const payload = parseWithSchema(poCancelSchema, req.body || {});
    const reason = String(payload.reason || '').trim();
    const { order, orderError } = await findServiceProviderOrderByIdentifier(decodedId, req.userId);
    if (orderError || !order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to cancel this order'
      });
    }

    if (!canSelfServeCancelOrder({ status: order.status, paymentStatus: order.payment_status })) {
      return res.status(400).json({
        status: 'error',
        message: 'This order cannot be cancelled after processing/shipping/delivery or once paid'
      });
    }

    let updatedOrder = null;
    try {
      const atomicResult = await cancelOrderWithAtomicRestock({
        orderId: order.id,
        actorUserId: req.userId,
        cancelReason: reason || null
      });
      if (atomicResult?.id) {
        const lifecycleState = toLifecycleStateFromStatus('cancelled');
        const { data: refreshedOrder } = await supabase
          .from('orders')
          .update({ lifecycle_state: lifecycleState })
          .eq('id', atomicResult.id)
          .select('*')
          .single();
        updatedOrder = refreshedOrder || null;
      }
    } catch (atomicError) {
      logger.warn('Atomic cancel RPC unavailable, using fallback cancellation path:', atomicError.message);
      const nextStatusHistory = Array.isArray(order.status_history) ? order.status_history : [];
      nextStatusHistory.push({
        status: 'cancelled',
        timestamp: new Date().toISOString(),
        updatedBy: req.userId,
        notes: reason || 'Cancelled by service provider'
      });

      const { data: fallbackUpdatedOrder, error: updateError } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          lifecycle_state: toLifecycleStateFromStatus('cancelled'),
          notes: reason ? `${order.notes ? `${order.notes}\n` : ''}Cancellation reason: ${reason}` : order.notes,
          status_history: nextStatusHistory
        })
        .eq('id', order.id)
        .select('*')
        .single();
      if (updateError || !fallbackUpdatedOrder) {
        throw updateError || new Error('Failed to cancel order');
      }
      updatedOrder = fallbackUpdatedOrder;

      try {
        await restockInventoryForCancelledOrder({
          orderId: updatedOrder.id,
          actorUserId: req.userId
        });
      } catch (restockError) {
        logger.error('Cancel restock error:', restockError);
      }
    }

    if (!updatedOrder) {
      throw new Error('Failed to cancel order');
    }

    return res.json({
      status: 'success',
      message: 'Order cancelled successfully',
      order: updatedOrder
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.error('Cancel order error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to cancel order',
      error: error.message
    });
  }
});
}
