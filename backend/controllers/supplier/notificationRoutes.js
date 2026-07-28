import { supplierNotificationReadSchema } from '../../contracts/supplierContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import {
  filterNotificationsForRole,
  getSupplierOnlyNotificationTypes,
  normalizeNotificationUserType
} from '../../utils/notificationAudience.js';

function resolveUserType(req) {
  return normalizeNotificationUserType(req.user?.user_type || req.user?.userType || '');
}

export function registerSupplierNotificationRoutes({ router, authenticateToken, supabase }) {
  router.get('/notifications', authenticateToken, async (req, res) => {
    try {
      const { limit = 50, unreadOnly = false } = req.query;
      const userType = resolveUserType(req);
      // Fetch extra rows when filtering for service providers so the limit still
      // yields a useful page after supplier-only alerts are removed.
      const requestedLimit = Math.max(1, parseInt(limit, 10) || 50);
      const fetchLimit =
        userType === 'service_provider'
          ? Math.min(requestedLimit * 3, 150)
          : requestedLimit;

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

      query = query.order('created_at', { ascending: false }).limit(fetchLimit);

      const { data: notifications, error } = await query;

      if (error) {
        throw error;
      }

      const { notifications: visibleNotifications, unreadCount: filteredUnread } =
        filterNotificationsForRole(notifications || [], userType);

      const limited =
        userType === 'service_provider'
          ? visibleNotifications.slice(0, requestedLimit)
          : visibleNotifications;

      // Prefer a DB unread count for suppliers; for SPs recompute after role filter.
      let unreadCount = filteredUnread;
      if (userType !== 'service_provider') {
        const { count } = await supabase
          .from('notifications')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', req.userId)
          .eq('is_read', false);
        unreadCount = count || 0;
      } else {
        // Accurate unread for SP: count only role-visible unread rows (fetch recent unread set).
        const { data: unreadRows } = await supabase
          .from('notifications')
          .select('id, type, title, message, metadata, is_read')
          .eq('user_id', req.userId)
          .eq('is_read', false)
          .order('created_at', { ascending: false })
          .limit(200);
        unreadCount = filterNotificationsForRole(unreadRows || [], userType).unreadCount;
      }

      res.json({
        status: 'success',
        notifications: limited,
        unreadCount
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

      const userType = resolveUserType(req);
      if (!filterNotificationsForRole([notification], userType).notifications.length) {
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
      const userType = resolveUserType(req);

      let updateQuery = supabase
        .from('notifications')
        .update({
          is_read: true,
          read_at: new Date().toISOString()
        })
        .eq('user_id', req.userId)
        .eq('is_read', false);

      // Service providers should not bulk-mark supplier-only product-management alerts.
      if (userType === 'service_provider') {
        const supplierOnlyTypes = getSupplierOnlyNotificationTypes();
        // Supabase `.not('type', 'in', ...)` expects `(a,b,c)` filter syntax.
        updateQuery = updateQuery.not(
          'type',
          'in',
          `(${supplierOnlyTypes.map((t) => `"${t}"`).join(',')})`
        );
      }

      const { error } = await updateQuery;

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
