import { normalizeBrandKey } from './supplyChainSharedService.js';
import { brandIsAllowedForSupplier, getAllDeclaredBrandTokens } from './supplierBrandGuardService.js';

/**
 * Approved brand names suppliers can pick when adding products.
 * Only brands declared on Select yourself (and admin-approved) are returned.
 */
export async function listSupplierSelectableBrands(supabase, { profile } = {}) {
  const declaredTokens = getAllDeclaredBrandTokens(profile);
  if (declaredTokens.size === 0) {
    return [];
  }

  const { data: approvedRows, error: approvedErr } = await supabase
    .from('brands')
    .select('name, normalized_name, status')
    .eq('status', 'approved')
    .order('name', { ascending: true });

  if (approvedErr) {
    throw approvedErr;
  }

  const brands = [];
  const seen = new Set();

  for (const row of approvedRows || []) {
    const name = String(row?.name || '').trim();
    if (!name) continue;
    const guard = brandIsAllowedForSupplier(profile, name);
    if (!guard.allowed) continue;
    const key = normalizeBrandKey(row?.normalized_name || name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    brands.push({
      name,
      normalizedName: key,
      status: row.status || 'approved',
      source: 'profile',
      fromProfile: true
    });
  }

  return brands.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
