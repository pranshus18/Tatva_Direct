/**
 * Build a UPI deep link for order payment (scannable QR payload).
 * Prefer seller VPA from supplier profile; else VITE_ORDER_PAYMENT_UPI_VPA; else platform test VPA.
 */
export function buildOrderUpiPayUri({
  amountRupees,
  orderNumber,
  payeeName,
  payeeVpa
}) {
  const vpa = String(
    payeeVpa ||
      import.meta.env.VITE_ORDER_PAYMENT_UPI_VPA ||
      import.meta.env.VITE_PLATFORM_UPI_VPA ||
      'pranshu.platform@upi'
  )
    .trim()
    .toLowerCase();
  const pn = String(payeeName || import.meta.env.VITE_PLATFORM_UPI_PAYEE_NAME || 'Tatva Direct').trim();
  const am = Math.max(0, Number(amountRupees) || 0).toFixed(2);
  const tn = `B2B Order ${orderNumber || ''}`.slice(0, 90);
  return `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(pn)}&am=${am}&cu=INR&tn=${encodeURIComponent(tn)}`;
}

export function qrServerImageUrl(text, size = 220) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
}
