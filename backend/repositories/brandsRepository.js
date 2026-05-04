import { supabase } from '../config/supabase.js';

export async function findBrandByNormalizedName(normalizedName, dbClient = supabase) {
  return dbClient
    .from('brands')
    .select('*')
    .eq('normalized_name', normalizedName)
    .maybeSingle();
}

export async function createBrand(payload, dbClient = supabase) {
  return dbClient
    .from('brands')
    .insert(payload)
    .select()
    .single();
}

export async function updateBrandById(brandId, payload, dbClient = supabase) {
  return dbClient
    .from('brands')
    .update(payload)
    .eq('id', brandId)
    .select()
    .single();
}

