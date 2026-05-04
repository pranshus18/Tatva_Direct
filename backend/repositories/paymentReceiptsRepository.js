import { supabase } from '../config/supabase.js';

export async function findReceiptByOrderId(orderId, dbClient = supabase) {
  return dbClient
    .from('payment_receipts')
    .select('*')
    .eq('order_id', orderId)
    .single();
}

export async function insertPaymentReceipt(payload, dbClient = supabase) {
  return dbClient
    .from('payment_receipts')
    .insert(payload)
    .select('*')
    .single();
}

