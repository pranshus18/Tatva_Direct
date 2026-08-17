export function getNotificationMetadata(notification) {
  const meta = notification?.metadata;
  return meta && typeof meta === 'object' ? meta : {};
}

export function isBrandRejectedNotification(notification) {
  if (String(notification?.type || '') === 'brand_rejected') return true;
  return getNotificationMetadata(notification).event === 'brand_rejected';
}

export function getBrandRejectionReason(notification) {
  const meta = getNotificationMetadata(notification);
  return String(meta.rejectionReason || meta.reason || '').trim();
}

export function getSupplierNotificationMessage(notification) {
  const message = String(notification?.message || '').trim();
  const rejectionReason = getBrandRejectionReason(notification);
  if (!rejectionReason || message.includes(rejectionReason)) {
    return message;
  }
  return message ? `${message} Reason: ${rejectionReason}` : `Reason: ${rejectionReason}`;
}

export function isLowStockAlertNotification(notification) {
  const meta = getNotificationMetadata(notification);
  if (
    meta.kind === 'inventory_below_lsa' ||
    meta.event === 'inventory_below_lsa' ||
    meta.source === 'low_inventory'
  ) {
    return true;
  }
  const title = String(notification?.title || '').toLowerCase();
  return title.includes('low stock alert') || title.includes('reached lsa');
}

export function getSupplierNotificationTargetPath(notification) {
  if (isBrandRejectedNotification(notification)) {
    return '/supplier-select-yourself';
  }
  if (isLowStockAlertNotification(notification)) {
    return '/supplier-dashboard';
  }
  return null;
}
