/**
 * Service Provider notification visibility (client-side defense in depth).
 * Mirrors backend/utils/notificationAudience.js for the SP portal.
 */

const SUPPLIER_ONLY_TYPES = new Set([
  'product_approval',
  'supplier_edit',
  'product_update',
  'credit_limit',
  'payment_received',
  'supplier_chain_profile_pending',
  'supplier_chain_profile_approved',
  'supplier_chain_profile_rejected',
  'portal_activity',
  'brand_rejected'
]);

const SP_ALLOWED_TYPES = new Set([
  'order_status',
  'payment_receipt',
  'order_return_status_updated',
  'order_return_requested',
  'system'
]);

const SP_SYSTEM_SOURCES = new Set([
  'service_provider_request_approved',
  'service_provider_request_fulfilled',
  'service_provider_request_rejected',
  'service_provider_product_request',
  'procurement'
]);

const SUPPLIER_ONLY_SYSTEM_SOURCES = new Set([
  'service_provider_request',
  'low_inventory',
  'mov_alert',
  'brand_rejected'
]);

function getMetadata(notification) {
  const meta = notification?.metadata;
  return meta && typeof meta === 'object' ? meta : {};
}

function getTitle(notification) {
  return String(notification?.title || '').trim();
}

function isSupplierOnlySystemNotification(notification) {
  const meta = getMetadata(notification);
  const source = String(meta.source || meta.event || '').trim();
  if (SUPPLIER_ONLY_SYSTEM_SOURCES.has(source)) return true;

  const title = getTitle(notification).toLowerCase();
  if (title.startsWith('customer looking for')) return true;
  if (title.startsWith('new product available')) return true;
  if (title.startsWith('product rejected:')) return true;
  if (title.startsWith('product approved:')) return true;
  if (title.includes('low stock') || title.includes('inventory alert')) return true;
  if (title.includes('below mov') || title.includes('minimum order')) return true;
  return false;
}

function isSpSystemNotification(notification) {
  const meta = getMetadata(notification);
  const source = String(meta.source || meta.event || '').trim();
  if (SP_SYSTEM_SOURCES.has(source)) return true;

  const title = getTitle(notification).toLowerCase();
  if (title.startsWith('your requested product')) return true;
  if (title.startsWith('supplier added your requested product')) return true;
  if (title.includes('product request')) return true;
  if (title.includes('request status')) return true;
  return !isSupplierOnlySystemNotification(notification);
}

export function isSpVisibleNotification(notification) {
  const type = String(notification?.type || '').trim().toLowerCase();
  if (SUPPLIER_ONLY_TYPES.has(type)) return false;
  if (!SP_ALLOWED_TYPES.has(type)) return false;
  if (type === 'system') return isSpSystemNotification(notification);
  return true;
}

export function filterSpNotifications(notifications) {
  const list = Array.isArray(notifications) ? notifications : [];
  const filtered = list.filter(isSpVisibleNotification);
  const unreadCount = filtered.reduce((count, n) => {
    const isRead = n?.is_read === true || n?.isRead === true;
    return isRead ? count : count + 1;
  }, 0);
  return { notifications: filtered, unreadCount };
}
