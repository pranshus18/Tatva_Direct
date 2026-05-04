import { supabase } from '../config/supabase.js';
import { sendEmail } from '../services/emailService.js';

function isNotificationEmailEnabled() {
  const raw = String(process.env.NOTIFICATION_EMAILS_ENABLED ?? 'true').trim().toLowerCase();
  return !['false', '0', 'off', 'no'].includes(raw);
}

async function sendNotificationEmails(notifications = [], dbClient = supabase) {
  if (!isNotificationEmailEnabled()) return;
  const rows = (notifications || []).filter((n) => n && n.user_id);
  if (rows.length === 0) return;

  const userIds = [...new Set(rows.map((n) => n.user_id).filter(Boolean))];
  if (userIds.length === 0) return;

  const { data: users, error } = await dbClient
    .from('users')
    .select('id, email, name, is_active')
    .in('id', userIds);

  if (error) {
    console.error('[notificationsRepository] Failed to load users for notification emails:', error);
    return;
  }

  const usersById = new Map((users || []).map((u) => [u.id, u]));
  const portalUrl = process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:8080';

  await Promise.all(
    rows.map(async (notification) => {
      try {
        const user = usersById.get(notification.user_id);
        const to = String(user?.email || '').trim();
        if (!to || user?.is_active === false) return;

        const userName = String(user?.name || 'User').trim();
        const title = String(notification.title || 'New Notification');
        const message = String(notification.message || '').trim();
        const subject = `[Tatva Direct] ${title}`;
        const text = [
          `Hi ${userName},`,
          '',
          title,
          message,
          '',
          `Check portal: ${portalUrl}`,
          '',
          'This is an automated notification email from Tatva Direct.'
        ].join('\n');
        const html = `
          <div style="font-family: Arial, sans-serif; color: #1f2937; line-height: 1.5;">
            <p>Hi ${userName},</p>
            <p><strong>${title}</strong></p>
            <p>${message}</p>
            <p><a href="${portalUrl}" target="_blank" rel="noopener noreferrer">Open Tatva Direct Portal</a></p>
            <p style="color:#6b7280; font-size:12px;">This is an automated notification email from Tatva Direct.</p>
          </div>
        `;

        await sendEmail({ to, subject, text, html });
      } catch (emailErr) {
        console.error('[notificationsRepository] Failed sending notification email:', emailErr);
      }
    })
  );
}

export async function insertNotification(notification, dbClient = supabase) {
  const result = await dbClient
    .from('notifications')
    .insert(notification);

  if (!result?.error) {
    await sendNotificationEmails([notification], dbClient);
  }
  return result;
}

export async function insertNotifications(notifications, dbClient = supabase) {
  const result = await dbClient
    .from('notifications')
    .insert(notifications);

  if (!result?.error) {
    await sendNotificationEmails(notifications, dbClient);
  }
  return result;
}

