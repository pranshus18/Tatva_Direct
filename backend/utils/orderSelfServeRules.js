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
