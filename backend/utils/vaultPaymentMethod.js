/**
 * Customer/SP checkout payment mode is PM vault only.
 * Legacy `wallet` values are normalized to `vault` on read/write.
 */

export function normalizePaymentMethodToken(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
}

/** True for vault checkout (also treats legacy `wallet` rows as vault). */
export function isVaultPaymentMethod(value) {
  const method = normalizePaymentMethodToken(value);
  return method === 'vault' || method === 'wallet';
}

/** Canonical value stored on orders.payment_method / receipts. */
export function toDbVaultPaymentMethod() {
  return 'vault';
}

/** API / UI facing payment method for vault orders. */
export function toApiVaultPaymentMethod(value) {
  return isVaultPaymentMethod(value) ? 'vault' : normalizePaymentMethodToken(value);
}

/** Normalize inbound client payment method tokens before validation/persist. */
export function coerceInboundPaymentMethod(value) {
  const method = normalizePaymentMethodToken(value);
  if (!method) return 'vault';
  if (method === 'wallet') return 'vault';
  if (method === 'pay_later' || method === 'paylater') return 'credit';
  return method;
}
