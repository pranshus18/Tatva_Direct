/**
 * Shared delete rules for buyer/supplier order lists.
 * Only delivered + paid orders may be deleted. All others stay.
 */

export function canDeleteOrder({ paymentStatus, status } = {}) {
  const normalizedPayment = String(paymentStatus || '')
    .trim()
    .toLowerCase();
  const normalizedStatus = String(status || '')
    .trim()
    .toLowerCase();
  return normalizedStatus === 'delivered' && normalizedPayment === 'paid';
}

export function getOrderDeleteBlockReason({ paymentStatus, status } = {}) {
  if (canDeleteOrder({ paymentStatus, status })) return '';
  const normalizedPayment = String(paymentStatus || '')
    .trim()
    .toLowerCase();
  if (normalizedPayment === 'pending' || normalizedPayment === 'partial') {
    return 'Cannot delete an order while payment is pending. Settle payment first.';
  }
  return 'Only delivered and paid orders can be deleted.';
}
