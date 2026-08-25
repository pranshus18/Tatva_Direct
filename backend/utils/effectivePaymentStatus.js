function normalizeStatusToken(value) {
  return String(value || '').trim().toLowerCase();
}

function asResolverArgs(input) {
  if (input == null || typeof input === 'string') {
    return { order: { payment_status: input }, receipt: null };
  }
  if (input.order || input.receipt) {
    return { order: input.order || {}, receipt: input.receipt || null };
  }
  return { order: input, receipt: input.receipt || null };
}

/**
 * Canonical payment status for APIs, receipts, invoices, and UI.
 * Vault debit counts as paid even if the order row is still pending
 * (held escrow, receipt, or payment_verified_at).
 */
export function resolveEffectivePaymentStatus(input = {}) {
  const { order = {}, receipt = null } = asResolverArgs(input);
  const orderStatus = normalizeStatusToken(order.payment_status || order.paymentStatus);
  if (orderStatus === 'refunded') return 'refunded';
  if (orderStatus === 'partial') return 'partial';
  if (['paid', 'captured', 'success', 'completed'].includes(orderStatus)) return 'paid';

  if (receipt?.paid_at || receipt?.paidAt) return 'paid';
  if (String(receipt?.payment_reference || receipt?.paymentReference || '').trim()) return 'paid';
  if (String(order.payment_verified_at || order.paymentVerifiedAt || '').trim()) return 'paid';

  const walletStatus = normalizeStatusToken(
    order.wallet_payment_status || order.walletPaymentStatus
  );
  if (['held', 'released', 'paid'].includes(walletStatus)) return 'paid';

  if (receipt?.id || receipt?.receipt_number || receipt?.receiptNumber) return 'paid';

  const providerRef = String(
    order.payment_provider_payment_id || order.paymentProviderPaymentId || ''
  ).trim();
  if (providerRef) return 'paid';

  return orderStatus || 'pending';
}

export function isEffectivePaymentPaid(input) {
  return resolveEffectivePaymentStatus(input) === 'paid';
}

export function formatEffectivePaymentStatusLabel(input) {
  const token = resolveEffectivePaymentStatus(input);
  if (token === 'paid') return 'Paid';
  if (token === 'partial') return 'Partially paid';
  if (token === 'refunded') return 'Refunded';
  if (token === 'pending') return 'Pending';
  return token.charAt(0).toUpperCase() + token.slice(1);
}

/** Persist paid when vault/receipt evidence exists but the order row is still pending. */
export async function healOrderPaymentStatusIfPaid(supabase, order, receipt = null) {
  if (!supabase || !order?.id) return order;
  const effective = resolveEffectivePaymentStatus({ order, receipt });
  if (effective !== 'paid') return order;
  if (normalizeStatusToken(order.payment_status || order.paymentStatus) === 'paid') return order;
  const { data } = await supabase
    .from('orders')
    .update({ payment_status: 'paid' })
    .eq('id', order.id)
    .select('payment_status')
    .maybeSingle();
  return { ...order, payment_status: data?.payment_status || 'paid' };
}
