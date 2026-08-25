function normalizeStatusToken(value) {
  return String(value || '').trim().toLowerCase();
}

function asOrder(orderOrStatus) {
  if (orderOrStatus && typeof orderOrStatus === 'object') return orderOrStatus;
  return { paymentStatus: orderOrStatus };
}

/**
 * Same paid/pending token used on receipts, invoices, and every portal surface.
 * Vault debit (held/released, receipt, verified_at) is paid even if the row is still pending.
 */
export function resolveEffectivePaymentStatus(orderOrStatus) {
  const order = asOrder(orderOrStatus);
  const orderStatus = normalizeStatusToken(order.paymentStatus || order.payment_status);
  if (orderStatus === 'refunded') return 'refunded';
  if (orderStatus === 'partial') return 'partial';
  if (['paid', 'captured', 'success', 'completed'].includes(orderStatus)) return 'paid';

  const receipt = order.receipt && typeof order.receipt === 'object' ? order.receipt : null;
  if (receipt?.paid_at || receipt?.paidAt) return 'paid';
  if (String(receipt?.payment_reference || receipt?.paymentReference || '').trim()) return 'paid';
  if (String(order.paymentVerifiedAt || order.payment_verified_at || '').trim()) return 'paid';

  const walletStatus = normalizeStatusToken(order.walletPaymentStatus || order.wallet_payment_status);
  if (['held', 'released', 'paid'].includes(walletStatus)) return 'paid';

  if (
    receipt?.id ||
    receipt?.receipt_number ||
    receipt?.receiptNumber ||
    order.receiptNumber ||
    order.receipt_number ||
    order.receiptPdfUrl
  ) {
    return 'paid';
  }

  const providerRef = String(
    order.paymentProviderPaymentId || order.payment_provider_payment_id || ''
  ).trim();
  if (providerRef) return 'paid';

  return orderStatus || 'pending';
}

export function isOrderPaid(orderOrStatus) {
  return resolveEffectivePaymentStatus(orderOrStatus) === 'paid';
}

export function orderStatusBadgeVariant(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'delivered') return 'success';
  if (s === 'cancelled') return 'destructive';
  if (s === 'pending') return 'warning';
  return 'secondary';
}

export function paymentStatusBadgeVariant(orderOrStatus) {
  const p = resolveEffectivePaymentStatus(orderOrStatus);
  if (p === 'paid') return 'success';
  if (p === 'refunded') return 'secondary';
  return 'warning';
}

export function formatOrderStatusLabel(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'delivered') return 'Delivered';
  if (s === 'pending') return 'Pending';
  if (s === 'confirmed') return 'Confirmed';
  if (s === 'processing') return 'Processing';
  if (s === 'shipped') return 'Shipped';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'returned') return 'Returned';
  return status || 'Pending';
}

export function formatPaymentStatusLabel(orderOrStatus) {
  const p = resolveEffectivePaymentStatus(orderOrStatus);
  if (p === 'paid') return 'Paid';
  if (p === 'partial') return 'Partially paid';
  if (p === 'refunded') return 'Refunded';
  if (p === 'pending') return 'Pending';
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** Legacy yo-badge classes for SP portal (sp-portal-theme.css). */
export function spStatusBadgeClass(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'delivered') return 'sp-badge sp-badge--delivered';
  if (s === 'cancelled') return 'sp-badge sp-badge--cancelled';
  if (s === 'pending') return 'sp-badge sp-badge--pending';
  if (['confirmed', 'processing', 'shipped'].includes(s)) return 'sp-badge sp-badge--confirmed';
  return 'sp-badge sp-badge--pending';
}

export function spPaymentBadgeClass(orderOrStatus) {
  const p = resolveEffectivePaymentStatus(orderOrStatus);
  if (p === 'paid') return 'sp-badge sp-badge--paid';
  return 'sp-badge sp-badge--payment-pending';
}
