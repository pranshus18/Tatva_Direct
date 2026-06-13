import { normalizeBrandKey } from './supplyChainSharedService.js';

export function parseBrandTokens(str) {
  if (!str || !String(str).trim()) return [];
  return String(str)
    .split(/[,;\n]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function normalizeChainNameKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizeBrandKeyFromAttributes(value) {
  const tokens = parseBrandTokens(value);
  if (tokens.length > 0) return normalizeBrandKey(tokens[0]);
  return normalizeBrandKey(value);
}

/** Brand label for upstream routing — offer attributes plus catalog brand. */
export function resolveUpstreamBrandLabel(attributes, productBrand) {
  const fromAttrs =
    attributes?.brandModel != null && String(attributes.brandModel).trim() !== ''
      ? String(attributes.brandModel).trim()
      : attributes?.brand != null && String(attributes.brand).trim() !== ''
        ? String(attributes.brand).trim()
        : '';
  const fromProduct = productBrand != null && String(productBrand).trim() !== '' ? String(productBrand).trim() : '';
  return fromAttrs || fromProduct || '';
}

function brandTokenKeysMatch(a, b) {
  const keyA = normalizeBrandKey(String(a).replace(/-/g, ' '));
  const keyB = normalizeBrandKey(String(b).replace(/-/g, ' '));
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  const tokenA = keyA.split(' ')[0];
  const tokenB = keyB.split(' ')[0];
  if (tokenA.length >= 3 && tokenA === tokenB) return true;
  if (keyA.length >= 3 && keyB.includes(keyA)) return true;
  if (keyB.length >= 3 && keyA.includes(keyB)) return true;
  return false;
}

export function getViewerBrandTokensForRole(profile, myRole) {
  const tokens = new Set();
  if (!myRole) return tokens;
  const entries = Array.isArray(profile?.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile?.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];
  let roleEntryFound = false;
  for (const e of entries) {
    if (e?.role === myRole) {
      roleEntryFound = true;
      parseBrandTokens(e.brands).forEach((t) => tokens.add(t));
    }
  }
  if (entries.length === 0 && profile?.supplierRole === myRole) {
    parseBrandTokens(profile.brands).forEach((t) => tokens.add(t));
  } else if (roleEntryFound && tokens.size === 0) {
    parseBrandTokens(profile.brands).forEach((t) => tokens.add(t));
  }
  return tokens;
}

export function entryOverlapsViewerBrands(entry, viewerBrandTokens) {
  if (!viewerBrandTokens || viewerBrandTokens.size === 0) return true;
  const entryTokens = parseBrandTokens(entry?.brands);
  if (entryTokens.length === 0) return true;
  for (const entryToken of entryTokens) {
    for (const viewerToken of viewerBrandTokens) {
      if (entryToken === viewerToken || brandTokenKeysMatch(entryToken, viewerToken)) return true;
    }
  }
  return false;
}

export function getAllDeclaredBrandTokens(profile) {
  const tokens = new Set();
  const entries = Array.isArray(profile?.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile?.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];
  for (const e of entries) {
    parseBrandTokens(e?.brands).forEach((t) => tokens.add(t));
  }
  parseBrandTokens(profile?.brands).forEach((t) => tokens.add(t));
  return tokens;
}

export function brandIsAllowedForSupplier(profile, brandInput) {
  const declared = getAllDeclaredBrandTokens(profile);
  if (declared.size === 0) return { allowed: true, reason: 'no_brand_lock' };
  const b = String(brandInput || '').trim().toLowerCase();
  if (!b) return { allowed: false, reason: 'brand_required' };
  for (const t of declared) {
    if (t === b) return { allowed: true, reason: 'exact' };
    if (brandTokenKeysMatch(t, b)) return { allowed: true, reason: 'normalized' };
    if (t.length >= 2 && (b.includes(t) || t.includes(b))) return { allowed: true, reason: 'contains' };
  }
  return { allowed: false, reason: 'not_in_profile', declared: [...declared] };
}

/**
 * Product create/update may receive both the supplier-selected brand and a catalog canonical brand.
 * Allow when either matches the supplier's declared Select yourself brands.
 */
export function resolveSupplierProductBrandGuard(profile, { selectedBrand = '', catalogBrand = '' } = {}) {
  const candidates = [...new Set(
    [selectedBrand, catalogBrand]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];

  if (candidates.length === 0) {
    const guard = brandIsAllowedForSupplier(profile, '');
    return { allowed: guard.allowed, brand: '', guard };
  }

  for (const candidate of candidates) {
    const guard = brandIsAllowedForSupplier(profile, candidate);
    if (guard.allowed) {
      return { allowed: true, brand: candidate, guard };
    }
  }

  const guard = brandIsAllowedForSupplier(profile, candidates[0]);
  return { allowed: false, brand: '', guard };
}

/**
 * Strict visibility gate for supplier-facing product surfaces.
 * If profile has no declared brands, access is denied (show nothing) until profile brands are configured/approved.
 */
export function supplierCanAccessBrandStrict(profile, brandInput) {
  const declared = getAllDeclaredBrandTokens(profile);
  if (declared.size === 0) {
    return { allowed: false, reason: 'no_declared_brands' };
  }
  const result = brandIsAllowedForSupplier(profile, brandInput);
  if (!result.allowed) return result;
  if (result.reason === 'no_brand_lock') {
    return { allowed: false, reason: 'no_declared_brands' };
  }
  return result;
}
