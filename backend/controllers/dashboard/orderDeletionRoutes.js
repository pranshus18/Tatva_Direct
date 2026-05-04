import { deleteOrderRequestSchema } from '../../contracts/dashboardContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';

function registerDeleteOrderRoute({
  router,
  authenticateToken,
  supabase,
  restockInventoryForCancelledOrder,
  userRolePath,
  userColumn,
  actorLabel
}) {
  router.delete(`/${userRolePath}/orders/:id`, authenticateToken, async (req, res) => {
    try {
      parseWithSchema(deleteOrderRequestSchema, req.body || {});
      const { id } = req.params;
      const decodedId = decodeURIComponent(id);

      console.log(`Deleting order for ${actorLabel}: ${decodedId}, User: ${req.userId}`);

      // Try to find by orderNumber first
      let { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('order_number', decodedId)
        .eq(userColumn, req.userId)
        .single();

      // If not found by orderNumber, try id
      if (orderError || !order) {
        const { data: orderById, error: orderByIdError } = await supabase
          .from('orders')
          .select('*')
          .eq('id', decodedId)
          .eq(userColumn, req.userId)
          .single();

        if (!orderByIdError && orderById) {
          order = orderById;
          orderError = null;
        }
      }

      if (orderError || !order) {
        console.log(`Order not found for deletion: ${decodedId} for ${actorLabel} ${req.userId}`);
        return res.status(404).json({
          status: 'error',
          message: 'Order not found or you do not have permission to delete this order'
        });
      }

      // Prevent deletion of orders that are already delivered or paid
      if (order.status === 'delivered' && order.payment_status === 'paid') {
        return res.status(400).json({
          status: 'error',
          message: 'Cannot delete an order that has been delivered and paid. Please contact support if you need to cancel this order.'
        });
      }

      // If order is cancelled, restore supplier inventory before deleting.
      try {
        await restockInventoryForCancelledOrder({ orderId: order.id, actorUserId: req.userId });
      } catch (e) {
        console.error(`[Delete Order] Cancel restock failed (${actorLabel} delete):`, e);
        // Do not block delete; but log it.
      }

      // Delete the order
      const { error: deleteError } = await supabase
        .from('orders')
        .delete()
        .eq('id', order.id);

      if (deleteError) {
        console.error('Delete error:', deleteError);
        return res.status(500).json({
          status: 'error',
          message: 'Failed to delete order'
        });
      }

      console.log(`Order ${order.order_number} deleted successfully by ${actorLabel} ${req.userId}`);

      res.json({
        status: 'success',
        message: 'Order deleted successfully',
        orderNumber: order.order_number
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Delete order error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error',
        error: error.message
      });
    }
  });
}

export function registerDashboardOrderDeletionRoutes({
  router,
  authenticateToken,
  supabase,
  restockInventoryForCancelledOrder
}) {
  registerDeleteOrderRoute({
    router,
    authenticateToken,
    supabase,
    restockInventoryForCancelledOrder,
    userRolePath: 'service-provider',
    userColumn: 'service_provider_id',
    actorLabel: 'service provider'
  });

  registerDeleteOrderRoute({
    router,
    authenticateToken,
    supabase,
    restockInventoryForCancelledOrder,
    userRolePath: 'supplier',
    userColumn: 'supplier_id',
    actorLabel: 'supplier'
  });
}
