import {
  catalogBrandDedupKey,
  normalizeBrandKey,
  normalizeChainRolesFromStages
} from './supplyChainSharedService.js';
import { brandIsAllowedForSupplier, getDeclaredBrandLabels } from './supplierBrandGuardService.js';

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
      source: 'catalog',
      hasAdminSupplyChain: existing.hasAdminSupplyChain === true
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
 * All brands available for Select yourself Layer 1 (catalog dropdown):
 * - admin-approved brands in the brands table only (same source as Admin → Brand Approvals)
 *
 * Supply-chain definitions (Layer 3) do NOT make a brand "approved". They only set
 * hasAdminSupplyChain on brands that are already approved in the brands table.
 *
 * Note: catalog membership ≠ supplier access ≠ role eligibility.
 * See supplierBrandLayerContract.js.
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

  const { data: chainRows, error: chainError } = await supabase
    .from('category_supply_chains')
    .select('category_name, stages')
    .order('category_name', { ascending: true });

  if (!chainError) {
    const chainReadyKeys = new Set();
    for (const row of chainRows || []) {
      const name = String(row?.category_name || '').trim();
      const roles = normalizeChainRolesFromStages(row?.stages);
      if (!name || roles.length === 0) continue;
      const key = catalogBrandDedupKey(name);
      if (key) chainReadyKeys.add(key);
    }

    for (const brand of brands) {
      const key = catalogBrandDedupKey(brand.name);
      if (key && chainReadyKeys.has(key)) {
        brand.hasAdminSupplyChain = true;
      }
    }
  }

  return brands.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

/**
 * Approved brand names suppliers can pick when adding products.
 * Declared profile brands that are still pending/rejected are included with their real status
 * so the UI can warn before product submission.
 */
export async function listSupplierSelectableBrands(supabase, { profile } = {}) {
  const declaredLabels = getDeclaredBrandLabels(profile);
  if (declaredLabels.length === 0) {
    return [];
  }

  const { data: brandRows, error: brandErr } = await supabase
    .from('brands')
    .select('id, name, normalized_name, status, rejection_reason')
    .order('name', { ascending: true });

  if (brandErr) {
    throw brandErr;
  }

  const brandsByKey = new Map();
  for (const row of brandRows || []) {
    const name = String(row?.name || '').trim();
    if (!name) continue;
    const key = catalogBrandDedupKey(name) || normalizeBrandKey(name);
    if (!key) continue;
    brandsByKey.set(key, row);
  }

  const brands = [];
  const seen = new Set();

  const pushBrand = (displayName, row = null, extra = {}) => {
    const trimmed = String(displayName || '').trim();
    if (!trimmed) return;
    const key = catalogBrandDedupKey(trimmed) || normalizeBrandKey(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const status = String(row?.status || extra.status || 'unregistered').trim().toLowerCase() || 'unregistered';
    brands.push({
      id: row?.id || null,
      name: trimmed,
      normalizedName: String(row?.normalized_name || '').trim() || normalizeBrandKey(trimmed),
      status,
      rejectionReason: row?.rejection_reason || null,
      source: extra.source || 'profile',
      fromProfile: extra.fromProfile === true
    });
  };

  for (const row of brandRows || []) {
    if (String(row?.status || '').toLowerCase() !== 'approved') continue;
    const name = String(row?.name || '').trim();
    if (!name) continue;
    const guard = brandIsAllowedForSupplier(profile, name, { requireRole: true });
    if (!guard.allowed) continue;
    pushBrand(guard.matchedBrand || name, row, { source: 'profile', fromProfile: true });
  }

  for (const label of declaredLabels) {
    const guard = brandIsAllowedForSupplier(profile, label, { requireRole: true });
    if (!guard.allowed) continue;
    const display = guard.matchedBrand || label;
    const key = catalogBrandDedupKey(display) || normalizeBrandKey(display);
    const row = key ? brandsByKey.get(key) : null;
    if (row && String(row.status || '').toLowerCase() === 'approved') {
      pushBrand(display, row, { source: 'profile', fromProfile: true });
      continue;
    }
    // Surface pending/rejected/unregistered declared brands with truthful status.
    pushBrand(display, row, {
      source: 'profile',
      fromProfile: true,
      status: row ? String(row.status || 'pending').toLowerCase() : 'unregistered'
    });
  }

  return brands.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}
