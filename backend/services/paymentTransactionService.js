import { supabase } from '../config/supabase.js';

export function mapOrderMethodToTxnMethod(paymentMethod) {
  const method = String(paymentMethod || '').toLowerCase();
  if (method === 'wallet') return 'wallet';
  if (method === 'upi') return 'upi';
  if (method === 'card') return 'card';
  if (method === 'netbanking' || method === 'online') return 'netbanking';
  if (method === 'credit' || method === 'credit_line') return 'credit_line';
  if (method === 'bank_transfer' || method === 'cash' || method === 'cheque') return 'bank_transfer';
  return 'bank_transfer';
}

export async function upsertPaymentTransaction(txn) {
  const { data, error } = await supabase
    .from('payment_transactions')
    .upsert(txn, { onConflict: 'provider,provider_payment_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function ensurePaymentTransactionForPaidOrder({
  order,
  method = null,
  paymentReference = null,
  paidAt = null,
  actorUserId = null,
  provider = null,
  status = 'captured'
}) {
  if (!order?.id) return null;

  const { data: existingRows, error: existingError } = await supabase
    .from('payment_transactions')
    .select('id, status, method, amount')
    .eq('order_id', order.id)
    .order('created_at', { ascending: false })
    .limit(1);
  if (existingError) throw existingError;
  if (existingRows?.length) {
    return { transaction: existingRows[0], created: false };
  }

  const txnProvider = provider || order.payment_provider || 'manual';
  const providerPaymentId =
    paymentReference ||
    order.payment_provider_payment_id ||
    `${txnProvider}-${order.id}`;
  const txnMethod = mapOrderMethodToTxnMethod(method || order.payment_method);

  const transaction = await upsertPaymentTransaction({
    order_id: order.id,
    service_provider_id: order.service_provider_id,
    supplier_id: order.supplier_id,
    provider: txnProvider === 'razorpay' ? 'razorpay' : 'manual',
    method: txnMethod,
    transaction_type: 'payment',
    amount: order.total_amount,
    provider_order_id: order.payment_provider_order_id || null,
    provider_payment_id: providerPaymentId,
    status,
    metadata: {
      backfilled: true,
      paidAt: paidAt || order.payment_verified_at || new Date().toISOString(),
      actorUserId: actorUserId || null
    }
  });
  return { transaction, created: true };
}
