/**
 * Role-aware notification visibility.
 * Notifications are keyed by user_id only; list endpoints must filter by role
 * so Service Providers do not see supplier/admin product-management alerts.
 */

const SUPPLIER_ONLY_NOTIFICATION_TYPES = new Set([
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

const SERVICE_PROVIDER_ALLOWED_TYPES = new Set([
  'order_status',
  'payment_receipt',
  'order_return_status_updated',
  'order_return_requested',
  'system'
]);

const SERVICE_PROVIDER_SYSTEM_SOURCES = new Set([
  'service_provider_request_approved',
  'service_provider_request_fulfilled',
  'service_provider_request_rejected',
  'service_provider_product_request',
  'procurement'
]);

const SUPPLIER_ONLY_SYSTEM_SOURCES = new Set([
  'service_provider_request',
  'service_provider_boq_customer_lookup',
  'low_inventory',
  'mov_alert',
  'brand_rejected'
]);

function normalizeUserType(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

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

function isServiceProviderSystemNotification(notification) {
  const meta = getMetadata(notification);
  const source = String(meta.source || meta.event || '').trim();
  if (SERVICE_PROVIDER_SYSTEM_SOURCES.has(source)) return true;

  const title = getTitle(notification).toLowerCase();
  if (title.startsWith('your requested product')) return true;
  if (title.startsWith('supplier added your requested product')) return true;
  if (title.includes('product request')) return true;
  if (title.includes('request status')) return true;
  // Unknown system alerts that landed on an SP user_id: keep if not clearly supplier-only.
  return !isSupplierOnlySystemNotification(notification);
}

/**
 * Whether a notification should appear in the given role's inbox.
 * @param {object} notification
 * @param {string} userType
 * @returns {boolean}
 */
export function isNotificationVisibleToRole(notification, userType) {
  const role = normalizeUserType(userType);
  const type = String(notification?.type || '').trim().toLowerCase();

  if (role === 'service_provider') {
    if (SUPPLIER_ONLY_NOTIFICATION_TYPES.has(type)) return false;
    if (!SERVICE_PROVIDER_ALLOWED_TYPES.has(type)) return false;
    if (type === 'system') return isServiceProviderSystemNotification(notification);
    return true;
  }

  if (role === 'supplier') {
    // Suppliers keep a broad inbox; hide SP-only request-lifecycle sources if present.
    if (type === 'system') {
      const source = String(getMetadata(notification).source || '').trim();
      if (
        source === 'service_provider_request_approved' ||
        source === 'service_provider_request_fulfilled' ||
        source === 'service_provider_request_rejected'
      ) {
        return false;
      }
    }
    return true;
  }

  return true;
}

/**
 * Filter a notification list for a role and recompute unread count.
 * @param {object[]} notifications
 * @param {string} userType
 * @returns {{ notifications: object[], unreadCount: number }}
 */
export function filterNotificationsForRole(notifications, userType) {
  const list = Array.isArray(notifications) ? notifications : [];
  const filtered = list.filter((n) => isNotificationVisibleToRole(n, userType));
  const unreadCount = filtered.reduce((count, n) => {
    const isRead = n?.is_read === true || n?.isRead === true;
    return isRead ? count : count + 1;
  }, 0);
  return { notifications: filtered, unreadCount };
}

export function getSupplierOnlyNotificationTypes() {
  return [...SUPPLIER_ONLY_NOTIFICATION_TYPES];
}

export function isSupplierUserType(userType) {
  return normalizeUserType(userType) === 'supplier';
}

export function normalizeNotificationUserType(userType) {
  return normalizeUserType(userType);
}
