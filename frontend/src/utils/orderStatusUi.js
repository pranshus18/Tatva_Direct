export function orderStatusBadgeVariant(status) {
  const s = String(status || 'pending').toLowerCase();
  if (s === 'delivered') return 'success';
  if (s === 'cancelled') return 'destructive';
  if (s === 'pending') return 'warning';
  return 'secondary';
}

export function paymentStatusBadgeVariant(paymentStatus) {
  const p = String(paymentStatus || 'pending').toLowerCase();
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

export function formatPaymentStatusLabel(paymentStatus) {
  const p = String(paymentStatus || 'pending').toLowerCase();
  if (p === 'paid') return 'Paid';
  if (p === 'partial') return 'Partially paid';
  if (p === 'refunded') return 'Refunded';
  return 'Payment pending';
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

export function spPaymentBadgeClass(paymentStatus) {
  const p = String(paymentStatus || 'pending').toLowerCase();
  if (p === 'paid') return 'sp-badge sp-badge--paid';
  return 'sp-badge sp-badge--payment-pending';
}
