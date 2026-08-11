/** Vault is the only funded checkout payment mode (legacy DB alias: wallet). */
export function isVaultPaymentMethod(value) {
  const method = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
  return method === 'vault' || method === 'wallet';
}

export function formatVaultPaymentMethodLabel(value) {
  if (isVaultPaymentMethod(value)) return 'Vault balance (direct supplier settlement)';
  const method = String(value || '').trim();
  if (!method) return '—';
  return method.replace(/_/g, ' ');
}

/**
 * Human-readable payment method for order details / lists.
 * Checkout "Pay later" is stored as `credit` in the DB.
 */
export function formatPaymentMethodLabel(value) {
  const pm = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
  if (!pm) return '—';
  if (isVaultPaymentMethod(pm)) return formatVaultPaymentMethodLabel(pm);
  if (pm === 'credit' || pm === 'pay_later' || pm === 'paylater') return 'Pay later';
  if (pm === 'cash') return 'Cash on delivery';
  if (pm === 'online') return 'Pay online';
  if (pm === 'upi') return 'UPI';
  if (pm === 'bank_transfer') return 'Bank transfer';
  if (pm === 'card') return 'Credit / Debit Card';
  return pm.replace(/_/g, ' ');
}

export const VAULT_PAYMENT_METHOD = 'vault';
export const VAULT_PAGE_PATH = '/vault';
