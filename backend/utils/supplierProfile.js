/** Matches profile logic used in supplier/boq routes (supplierRole + companyInfoEntries). */
export function userHasSupplierRole(profile, role) {
  if (!profile || !role) return false;
  if (profile.supplierRole === role) return true;
  const entries = Array.isArray(profile.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];
  return entries.some((e) => e && e.role === role);
}

export function supplierIsRetailer(profile) {
  return userHasSupplierRole(profile, 'retailer');
}

const normalizeBrandKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function parseBrandTokens(str) {
  if (!str || !String(str).trim()) return [];
  return String(str)
    .split(/[,;\n/|]+/)
    .map((s) => normalizeBrandKey(s))
    .filter(Boolean);
}

/**
 * True when supplier profile is retailer and explicitly carries the given brand
 * in retailer companyInfoEntries (preferred) or legacy profile.brands fallback.
 */
export function supplierIsRetailerForBrand(profile, brandName) {
  if (!supplierIsRetailer(profile)) return false;

  const brand = normalizeBrandKey(brandName);
  if (!brand) return true; // No brand context: retain retailer-only behavior.

  const entries = Array.isArray(profile?.companyInfoEntries) ? profile.companyInfoEntries : [];
  const retailerEntries = entries.filter((e) => e && String(e.role || '').trim() === 'retailer');
  const retailerBrandSet = new Set(
    retailerEntries.flatMap((e) => parseBrandTokens(e?.brands))
  );
  if (retailerBrandSet.size > 0) {
    return retailerBrandSet.has(brand);
  }

  // Legacy fallback where supplier stored single brands string on profile.
  const legacyBrandSet = new Set(parseBrandTokens(profile?.brands));
  return legacyBrandSet.size > 0 ? legacyBrandSet.has(brand) : false;
}

/**
 * Minimum order value (INR) for upstream B2B sales when this supplier operates as `sellerRole`.
 * Not used for retailer (always 0). Set per companyInfoEntries[].minimumOrderValue or legacy profile.minimumOrderValue.
 */
export function getMinimumOrderValueInrForSellerRole(profile, sellerRole) {
  if (!profile || !sellerRole || sellerRole === 'retailer') return 0;
  const entries = profile.companyInfoEntries || [];
  const match = entries.find((e) => e && e.role === sellerRole);
  if (match && match.minimumOrderValue != null && match.minimumOrderValue !== '') {
    const v = parseFloat(match.minimumOrderValue);
    if (Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100;
  }
  if (String(profile.supplierRole || '').trim() === sellerRole) {
    const v = parseFloat(profile.minimumOrderValue);
    if (Number.isFinite(v) && v > 0) return Math.round(v * 100) / 100;
  }
  return 0;
}

/**
 * Highest minimum order value (INR) across non-retailer company lines + legacy profile MOV.
 * Used for alerts when inventory value at list price falls below this threshold.
 */
export function getMaxMinimumOrderValueInrForSupplierProfile(profile) {
  if (!profile) return 0;
  let max = 0;
  const entries = Array.isArray(profile.companyInfoEntries)
    ? profile.companyInfoEntries
    : profile.companyInfoEntries && typeof profile.companyInfoEntries === 'object'
      ? [profile.companyInfoEntries]
      : [];
  for (const e of entries) {
    if (!e || e.role === 'retailer') continue;
    const v = parseFloat(e.minimumOrderValue);
    if (Number.isFinite(v) && v > 0) max = Math.max(max, Math.round(v * 100) / 100);
  }
  const sr = String(profile.supplierRole || '').trim();
  if (sr && sr !== 'retailer') {
    const legacy = parseFloat(profile.minimumOrderValue);
    if (Number.isFinite(legacy) && legacy > 0) {
      max = Math.max(max, Math.round(legacy * 100) / 100);
    }
  }
  return max;
}
