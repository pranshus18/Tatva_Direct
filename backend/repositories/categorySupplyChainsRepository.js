import { supabase } from '../config/supabase.js';

export async function listCategorySupplyChainsMeta(dbClient = supabase) {
  return dbClient
    .from('category_supply_chains')
    .select('category_name, id, updated_at');
}

export async function listCategorySupplyChainDefinitions(dbClient = supabase) {
  return dbClient
    .from('category_supply_chains')
    .select('id, category_name, stages, summary, ai_suggested_at, updated_at, updated_by')
    .order('category_name');
}

export async function findCategorySupplyChainsByNameIlike(pattern, dbClient = supabase) {
  return dbClient
    .from('category_supply_chains')
    .select('*')
    .ilike('category_name', pattern);
}

export async function listCategorySupplyChainsNameAndId(dbClient = supabase) {
  return dbClient
    .from('category_supply_chains')
    .select('id, category_name');
}

export async function updateCategorySupplyChainById(id, payload, dbClient = supabase) {
  return dbClient
    .from('category_supply_chains')
    .update(payload)
    .eq('id', id)
    .select()
    .single();
}

export async function createCategorySupplyChain(payload, dbClient = supabase) {
  return dbClient
    .from('category_supply_chains')
    .insert(payload)
    .select()
    .single();
}

export async function deleteCategorySupplyChainById(id, dbClient = supabase) {
  return dbClient
    .from('category_supply_chains')
    .delete()
    .eq('id', id);
}

