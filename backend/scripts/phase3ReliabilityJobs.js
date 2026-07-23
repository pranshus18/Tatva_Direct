import { supabase } from '../config/supabase.js';
import { fetchRazorpayPayment } from '../services/razorpayService.js';

async function retryStuckTransactions() {
  const threshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: stuck, error } = await supabase
    .from('payment_transactions')
    .select('*')
    .in('status', ['created', 'pending', 'authorized'])
    .lte('created_at', threshold)
    .lt('retries', 5)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;

  let retried = 0;
  for (const tx of (stuck || [])) {
    try {
      if (tx.provider === 'razorpay' && tx.provider_payment_id) {
        const payment = await fetchRazorpayPayment(tx.provider_payment_id);
        const nextStatus = payment?.status === 'captured' ? 'captured' : (payment?.status || tx.status);
        await supabase
          .from('payment_transactions')
          .update({
            status: nextStatus,
            retries: (Number(tx.retries) || 0) + 1,
            metadata: { ...(tx.metadata || {}), lastRetryAt: new Date().toISOString() }
          })
          .eq('id', tx.id);
      } else {
        await supabase
          .from('payment_transactions')
          .update({ retries: (Number(tx.retries) || 0) + 1 })
          .eq('id', tx.id);
      }
      retried += 1;
    } catch (e) {
      console.error('[Phase3 jobs] Retry failed for txn', tx.id, e?.message || e);
    }
  }
  return retried;
}

async function main() {
  const retried = await retryStuckTransactions();
  console.log('[Phase3 jobs] completed', { retried });
}

main().catch((e) => {
  console.error('[Phase3 jobs] failed:', e);
  process.exit(1);
});
