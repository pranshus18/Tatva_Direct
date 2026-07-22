export function normalizePaymentMethodForOrder(method) {
  const normalized = String(method || '').toLowerCase();
  if (!normalized) return 'online';
  if (normalized === 'vault' || normalized === 'wallet') return 'vault';
  if (['upi', 'card', 'netbanking', 'bank_transfer', 'cash', 'credit', 'online'].includes(normalized)) {
    return normalized === 'netbanking' ? 'online' : normalized;
  }
  return 'online';
}

export function httpStatusForUpstreamError(err) {
  if (err?.code === 'ETIMEDOUT' || err?.statusCode === 504) return 504;
  return 500;
}
