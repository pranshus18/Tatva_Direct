import { findAdmins } from '../repositories/usersRepository.js';
import { insertNotifications } from '../repositories/notificationsRepository.js';

export async function notifyAdminsForPortalAction({ supabase, actorUserId, action, metadata = {} }) {
  if (!actorUserId) return;
  try {
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
    const { data: admins } = await findAdmins(adminEmail, supabase);

    if (!admins || admins.length === 0) return;

    const notifications = admins.map((admin) => ({
      user_id: admin.id,
      type: 'portal_activity',
      title: 'Portal activity update',
      message: action,
      is_read: false,
      metadata: {
        actorUserId,
        ...metadata
      }
    }));
    await insertNotifications(notifications, supabase);
  } catch (e) {
    console.error('[Admin Notify] Failed to notify admins for portal activity:', e);
  }
}
