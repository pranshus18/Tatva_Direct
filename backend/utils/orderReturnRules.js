import { normalizeOrderStatus } from './orderLifecycle.js';

export const SUPPLIER_RETURN_TRANSITIONS = {
  requested: ['approved', 'rejected'],
  approved: ['picked_up', 'received'],
  picked_up: ['received'],
  received: ['refunded', 'replaced'],
  refunded: ['closed'],
  replaced: ['closed']
};

export function canRequestReturnForOrder({ status }) {
  const normalized = normalizeOrderStatus(status);
  return normalized === 'delivered';
}

export function getReturnRequestBlockReason({ status }) {
  const normalized = normalizeOrderStatus(status);
  if (normalized === 'cancelled') {
    return 'Cancelled orders cannot be returned.';
  }
  if (normalized !== 'delivered') {
    return 'Returns can only be requested after the order is delivered.';
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

export function getRemainingReturnableQuantity(orderedQty, existingReturns = []) {
  const ordered = Number(orderedQty) || 0;
  const reserved = (existingReturns || [])
    .filter((row) => normalizeOrderStatus(row?.status) !== 'rejected')
    .reduce((sum, row) => sum + (Number(row?.quantity) || 0), 0);
  return Math.max(0, ordered - reserved);
}
