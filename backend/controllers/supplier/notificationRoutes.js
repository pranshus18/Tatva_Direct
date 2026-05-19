import { supplierNotificationReadSchema } from '../../contracts/supplierContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';

export function registerSupplierNotificationRoutes({ router, authenticateToken, supabase }) {
  router.get('/notifications', authenticateToken, async (req, res) => {
    try {
      const { limit = 50, unreadOnly = false } = req.query;

      let query = supabase
        .from('notifications')
        .select(`
        *,
        related_order:orders!notifications_related_order_id_fkey (order_number, total_amount)
      `)
        .eq('user_id', req.userId);

      if (unreadOnly === 'true') {
        query = query.eq('is_read', false);
      }

      query = query.order('created_at', { ascending: false }).limit(parseInt(limit));

      const { data: notifications, error } = await query;

      if (error) {
        throw error;
      }

      const { count: unreadCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.userId)
        .eq('is_read', false);

      res.json({
        status: 'success',
        notifications: notifications || [],
        unreadCount: unreadCount || 0
      });
    } catch (error) {
      console.error('Get notifications error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  router.patch('/notifications/:id/read', authenticateToken, async (req, res) => {
    try {
      parseWithSchema(supplierNotificationReadSchema, req.body || {});
      const { data: notification, error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('id', req.params.id)
        .eq('user_id', req.userId)
        .select()
        .single();

      if (error || !notification) {
        return res.status(404).json({
          status: 'error',
          message: 'Notification not found'
        });
      }

      res.json({
        status: 'success',
        message: 'Notification marked as read',
        notification
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Mark notification as read error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  router.patch('/notifications/read-all', authenticateToken, async (req, res) => {
    try {
      parseWithSchema(supplierNotificationReadSchema, req.body || {});
      const { error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('user_id', req.userId)
        .eq('is_read', false);

      if (error) {
        throw error;
      }

      res.json({
        status: 'success',
        message: 'All notifications marked as read'
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Mark all notifications as read error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });
}
