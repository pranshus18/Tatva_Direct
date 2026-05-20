import { supabase } from '../config/supabase.js';

export async function upsertPaymentTransaction(txn) {
  const { data, error } = await supabase
    .from('payment_transactions')
    .upsert(txn, { onConflict: 'provider,provider_payment_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}
