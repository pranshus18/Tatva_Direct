import { normalizeOrderStatus, toPrimaryStatusFromLifecycle } from './orderLifecycle.js';

export function normalizeStatus(value) {
  const normalized = normalizeOrderStatus(value);
  return toPrimaryStatusFromLifecycle(normalized);
}

export function canSelfServeEditOrder({ status, paymentStatus }) {
  const normalizedStatus = normalizeStatus(status);
  const normalizedPayment = normalizeStatus(paymentStatus);
  return (normalizedStatus === 'pending' || normalizedStatus === 'confirmed') && normalizedPayment !== 'paid';
}

export function canSelfServeCancelOrder({ status, paymentStatus }) {
  return canSelfServeEditOrder({ status, paymentStatus });
}

export function canRateSupplierForOrder({ status, paymentStatus }) {
  return normalizeStatus(status) === 'delivered' && normalizeStatus(paymentStatus) === 'paid';
}

export function getSelfServeLockReason({ status, paymentStatus }) {
  const normalizedStatus = normalizeStatus(status);
  const normalizedPayment = normalizeStatus(paymentStatus);
  if (normalizedPayment === 'paid') {
    return 'Order is already paid';
  }
  if (!['pending', 'confirmed'].includes(normalizedStatus)) {
    return 'Order has already entered fulfillment';
  }
  return '';
}

/**
 * Only fully settled fulfilled orders may be deleted.
 * Anything else (pending payment, in-progress, etc.) must stay.
 */
export function canDeleteOrder({ paymentStatus, status } = {}) {
  const normalizedPayment = String(paymentStatus || '')
    .trim()
    .toLowerCase();
  const normalizedStatus = normalizeStatus(status);
  return normalizedStatus === 'delivered' && normalizedPayment === 'paid';
}

export function getOrderDeleteBlockReason({ paymentStatus, status } = {}) {
  if (canDeleteOrder({ paymentStatus, status })) return '';
  const normalizedPayment = String(paymentStatus || '')
    .trim()
    .toLowerCase();
  const normalizedStatus = normalizeStatus(status);
  if (normalizedPayment === 'pending' || normalizedPayment === 'partial') {
    return 'Cannot delete an order while payment is pending. Settle payment first.';
  }
  if (normalizedStatus !== 'delivered') {
    return 'Only delivered and paid orders can be deleted.';
  }
  if (normalizedPayment !== 'paid') {
    return 'Only delivered and paid orders can be deleted.';
  }
  return 'Only delivered and paid orders can be deleted.';
}
