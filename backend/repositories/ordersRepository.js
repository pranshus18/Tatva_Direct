import { supabase } from '../config/supabase.js';

export async function findOrderByOrderNumber(orderNumber, dbClient = supabase) {
  return dbClient
    .from('orders')
    .select('*')
    .eq('order_number', orderNumber)
    .single();
}

export async function findOrderById(orderId, dbClient = supabase) {
  return dbClient
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();
}

export async function deleteOrderById(orderId, dbClient = supabase) {
  return dbClient
    .from('orders')
    .delete()
    .eq('id', orderId);
}

