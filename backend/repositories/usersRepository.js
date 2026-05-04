import { supabase } from '../config/supabase.js';

export async function findUserBasicById(userId, dbClient = supabase) {
  return dbClient
    .from('users')
    .select('id,name,company,email,phone,address,profile,user_type')
    .eq('id', userId)
    .single();
}

export async function findAdmins(adminEmail, dbClient = supabase) {
  const email = String(adminEmail || '').toLowerCase();
  return dbClient
    .from('users')
    .select('id')
    .or(`email.eq.${email},user_type.eq.admin`);
}

