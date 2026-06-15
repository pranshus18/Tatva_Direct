import { catalogBrandDedupKey, normalizeBrandKey } from './supplyChainSharedService.js';
import { brandIsAllowedForSupplier, getDeclaredBrandLabels } from './supplierBrandGuardService.js';

function upsertCatalogBrand(brands, name, extra = {}) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return;
  const dedupKey = catalogBrandDedupKey(trimmed);
  if (!dedupKey) return;

  const existingIdx = brands.findIndex((row) => catalogBrandDedupKey(row.name) === dedupKey);
  if (existingIdx >= 0) {
    const existing = brands[existingIdx];
    const nextName =
      trimmed.length < String(existing.name || '').length ? trimmed : String(existing.name || '').trim();
    brands[existingIdx] = {
      ...existing,
      name: nextName,
      normalizedName: normalizeBrandKey(nextName),
      status: 'approved',
      source: extra.source || existing.source || 'catalog',
      fromProfile: extra.fromProfile === true || existing.fromProfile === true
    };
    return;
  }

  brands.push({
    name: trimmed,
    normalizedName: normalizeBrandKey(trimmed),
    status: 'approved',
    source: extra.source || 'catalog',
    ...(extra.fromProfile ? { fromProfile: true } : {})
  });
}

function upsertApprovedCatalogRow(brands, row) {
  const name = String(row?.name || '').trim();
  if (!name) return;
  const dedupKey = catalogBrandDedupKey(name);
  if (!dedupKey) return;

  const existingIdx = brands.findIndex((item) => catalogBrandDedupKey(item.name) === dedupKey);
  if (existingIdx >= 0) {
    const existing = brands[existingIdx];
    const nextName =
      name.length < String(existing.name || '').length ? name : String(existing.name || '').trim();
    brands[existingIdx] = {
      ...existing,
      name: nextName,
      normalizedName: normalizeBrandKey(nextName),
      status: 'approved',
      source: 'catalog'
    };
    return;
  }

  brands.push({
    id: row.id,
    name,
    normalizedName: String(row?.normalized_name || '').trim() || normalizeBrandKey(name),
    status: 'approved',
    source: 'catalog'
  });
}

/**
 * All admin-approved brands in the platform catalog.
 * Used on Select yourself (Step 1) so suppliers can pick an existing approved brand.
 * Spelling variants (e.g. Philips / Phillips) are merged into one catalog entry.
 */
export async function listApprovedCatalogBrands(supabase) {
  const { data: approvedRows, error } = await supabase
    .from('brands')
    .select('id, name, normalized_name, status')
    .eq('status', 'approved')
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  const brands = [];
  for (const row of approvedRows || []) {
    upsertApprovedCatalogRow(brands, row);
  }

  return brands.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
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

  for (const row of approvedRows || []) {
    const name = String(row?.name || '').trim();
    if (!name) continue;
    const guard = brandIsAllowedForSupplier(profile, name);
    if (!guard.allowed) continue;
    upsertCatalogBrand(brands, guard.matchedBrand || name, { source: 'profile', fromProfile: true });
  }

  for (const label of declaredLabels) {
    const guard = brandIsAllowedForSupplier(profile, label);
    if (!guard.allowed) continue;
    upsertCatalogBrand(brands, guard.matchedBrand || label, { source: 'profile', fromProfile: true });
  }

  return brands.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
