/** Vault is the only funded checkout payment mode (legacy DB alias: wallet). */
export function isVaultPaymentMethod(value) {
  const method = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[\s-]+/g, '_');
  return method === 'vault' || method === 'wallet';
}

export function formatVaultPaymentMethodLabel(value) {
  if (isVaultPaymentMethod(value)) return 'Vault balance (platform escrow)';
  const method = String(value || '').trim();
  if (!method) return '—';
  return method.replace(/_/g, ' ');
}

export const VAULT_PAYMENT_METHOD = 'vault';
export const VAULT_PAGE_PATH = '/vault';
