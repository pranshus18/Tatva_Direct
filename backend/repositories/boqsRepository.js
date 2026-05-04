import { supabase } from '../config/supabase.js';

export async function deleteBoqById(boqId, dbClient = supabase) {
  return dbClient
    .from('boqs')
    .delete()
    .eq('id', boqId);
}

