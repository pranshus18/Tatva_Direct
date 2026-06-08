import { normalizeBrandKey } from './supplyChainSharedService.js';
import { getAllDeclaredBrandTokens } from './supplierBrandGuardService.js';

/**
 * Approved brand names suppliers can pick when adding products (identity only — no catalog row).
 */
export async function listSupplierSelectableBrands(supabase, { profile } = {}) {
  const byKey = new Map();

  const addName = (name, meta = {}) => {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    const key = normalizeBrandKey(trimmed);
    if (!key) return;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        name: trimmed,
        normalizedName: key,
        status: meta.status || 'approved',
        source: meta.source || 'catalog'
      });
      return;
    }
    if (meta.fromProfile) existing.fromProfile = true;
    if (meta.source === 'profile' && existing.source !== 'profile') {
      existing.source = 'profile';
    }
  };

  const { data: approvedRows, error: approvedErr } = await supabase
    .from('brands')
    .select('name, normalized_name, status')
    .eq('status', 'approved')
    .order('name', { ascending: true });

  if (approvedErr) {
    throw approvedErr;
  }

  (approvedRows || []).forEach((row) => {
    addName(row.name, { status: row.status || 'approved', source: 'brands' });
  });

  const declaredTokens = getAllDeclaredBrandTokens(profile);
  if (declaredTokens.size > 0) {
    const keys = [...declaredTokens];
    const { data: declaredRows } = await supabase
      .from('brands')
      .select('name, normalized_name, status')
      .in('normalized_name', keys)
      .eq('status', 'approved');

    (declaredRows || []).forEach((row) => {
      addName(row.name, { status: 'approved', source: 'profile', fromProfile: true });
    });
  }

  for (const token of declaredTokens) {
    const key = normalizeBrandKey(token);
    if (key && byKey.has(key)) {
      byKey.get(key).fromProfile = true;
    }
  }

  const brands = [...byKey.values()].sort((a, b) => {
    if (a.fromProfile !== b.fromProfile) return a.fromProfile ? -1 : 1;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });

  return brands;
}
