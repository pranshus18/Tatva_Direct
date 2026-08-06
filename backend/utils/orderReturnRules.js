import { normalizeOrderStatus } from './orderLifecycle.js';

export const SUPPLIER_RETURN_TRANSITIONS = {
  requested: ['approved', 'rejected'],
  approved: ['picked_up', 'received'],
  picked_up: ['received'],
  received: ['refunded', 'replaced'],
  refunded: ['closed'],
  replaced: ['closed']
};

export function getRemainingReturnableQuantity(orderedQty, existingReturns = []) {
  const ordered = Number(orderedQty) || 0;
  const reserved = (existingReturns || [])
    .filter((row) => normalizeOrderStatus(row?.status) !== 'rejected')
    .reduce((sum, row) => sum + (Number(row?.quantity) || 0), 0);
  return Math.max(0, ordered - reserved);
}

function getReturnsForItem(returns, itemId) {
  return (returns || []).filter((row) => {
    const rowItemId = row?.order_item_id ?? row?.orderItemId;
    return rowItemId === itemId;
  });
}

export function getTotalRemainingReturnableQuantity(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const returns = Array.isArray(order?.returns) ? order.returns : [];
  return items.reduce((sum, item) => {
    const itemId = item?.id ?? item?.order_item_id ?? item?.orderItemId;
    if (!itemId) return sum;
    const itemReturns = getReturnsForItem(returns, itemId);
    return sum + getRemainingReturnableQuantity(item.quantity, itemReturns);
  }, 0);
}

export function canRequestReturnForOrder(order) {
  const normalized = normalizeOrderStatus(order?.status);
  if (normalized !== 'delivered') return false;
  if (Array.isArray(order?.items) && order.items.length > 0) {
    return getTotalRemainingReturnableQuantity(order) > 0;
  }
  return true;
}

export function getReturnRequestBlockReason(order) {
  const normalized = normalizeOrderStatus(order?.status);
  if (normalized === 'cancelled') {
    return 'Cancelled orders cannot be returned.';
  }
  if (normalized !== 'delivered') {
    return 'Returns can only be requested after the order is delivered.';
  }
  if (Array.isArray(order?.items) && order.items.length > 0) {
    const remaining = getTotalRemainingReturnableQuantity(order);
    if (remaining <= 0) {
      const returns = Array.isArray(order?.returns) ? order.returns : [];
      const activeReturns = returns.filter(
        (row) => !['rejected'].includes(normalizeOrderStatus(row?.status))
      );
      const allClosed =
        activeReturns.length > 0 &&
        activeReturns.every((row) => normalizeOrderStatus(row?.status) === 'closed');
      if (allClosed) {
        return 'All return requests for this order have been closed. No further returns can be requested.';
      }
      return 'All units for this order have already been requested for return.';
    }
  }
  return '';
}

export function isValidSupplierReturnTransition(fromStatus, toStatus) {
  const from = normalizeOrderStatus(fromStatus);
  const to = normalizeOrderStatus(toStatus);
  const allowed = SUPPLIER_RETURN_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export function isSupplierBuyerUser(userType) {
  return String(userType || '').trim().toLowerCase().replace(/[\s-]+/g, '_') === 'supplier';
}
