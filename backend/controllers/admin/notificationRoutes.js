export function registerAdminNotificationRoutes({ router, authenticateToken, isAdmin, supabase }) {
  // Get admin notifications
  router.get('/notifications', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { limit = 50, unreadOnly = false } = req.query;

      let query = supabase
        .from('notifications')
        .select(`
        *,
        related_product:products!notifications_related_product_id_fkey (id, name, description, category, price, stock, unit, location, min_order_quantity, specifications, status, is_active),
        related_supplier:users!notifications_related_supplier_id_fkey (id, name, email, company)
      `)
        .eq('user_id', req.userId)
        .in('type', ['supplier_edit', 'product_update', 'product_approval'])
        .order('created_at', { ascending: false })
        .limit(parseInt(limit));

      if (unreadOnly === 'true') {
        query = query.eq('is_read', false);
      }

      const { data: notifications } = await query;

      // Get unread count
      const { count: unreadCount } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', req.userId)
        .eq('is_read', false)
        .in('type', ['supplier_edit', 'product_update', 'product_approval']);

      res.json({
        status: 'success',
        notifications: notifications || [],
        unreadCount: unreadCount || 0
      });
    } catch (error) {
      console.error('Get admin notifications error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Mark notification as read
  router.patch('/notifications/:id/read', authenticateToken, isAdmin, async (req, res) => {
    try {
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
      console.error('Mark notification as read error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });

  // Mark all notifications as read
  router.patch('/notifications/read-all', authenticateToken, isAdmin, async (req, res) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('user_id', req.userId)
        .eq('is_read', false)
        .in('type', ['supplier_edit', 'product_update', 'product_approval']);

      if (error) {
        throw error;
      }

      res.json({
        status: 'success',
        message: 'All notifications marked as read'
      });
    } catch (error) {
      console.error('Mark all notifications as read error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });
}
