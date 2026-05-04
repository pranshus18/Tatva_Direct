import { supabase } from '../config/supabase.js';

export async function insertAuditLog(entry, dbClient = supabase) {
  return dbClient
    .from('audit_log_entries')
    .insert(entry);
}

