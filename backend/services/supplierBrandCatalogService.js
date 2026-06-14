import { normalizeBrandKey } from './supplyChainSharedService.js';
import { brandIsAllowedForSupplier, getDeclaredBrandLabels } from './supplierBrandGuardService.js';

/**
 * All admin-approved brands in the platform catalog.
 * Used on Select yourself (Step 1) so suppliers can pick an existing approved brand.
 */
export async function listApprovedCatalogBrands(supabase) {
  const { data: approvedRows, error } = await supabase
    .from('brands')
    .select('name, normalized_name, status')
    .eq('status', 'approved')
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  const brands = [];
  const seen = new Set();

  for (const row of approvedRows || []) {
    const name = String(row?.name || '').trim();
    if (!name) continue;
    const key = normalizeBrandKey(row?.normalized_name || name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    brands.push({
      name,
      normalizedName: key,
      status: 'approved',
      source: 'catalog'
    });
  }

  return brands;
}

/**
 * Approved brand names suppliers can pick when adding products.
 * Only brands declared on Select yourself (and admin-approved) are returned.
 */
export async function listSupplierSelectableBrands(supabase, { profile } = {}) {
  const declaredLabels = getDeclaredBrandLabels(profile);
  if (declaredLabels.length === 0) {
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
      name: guard.matchedBrand || name,
      normalizedName: key,
      status: row.status || 'approved',
      source: 'profile',
      fromProfile: true
    });
  }

  for (const label of declaredLabels) {
    const guard = brandIsAllowedForSupplier(profile, label);
    if (!guard.allowed) continue;
    const key = normalizeBrandKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    brands.push({
      name: guard.matchedBrand || label,
      normalizedName: key,
      status: 'approved',
      source: 'profile',
      fromProfile: true
    });
  }

  return brands.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
