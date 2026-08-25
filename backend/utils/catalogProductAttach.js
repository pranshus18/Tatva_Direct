import { brandTokenKeysMatch } from '../services/supplierBrandGuardService.js';

export function normalizeCatalogLookupName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function catalogBrandsConflict(candidateBrand, existingBrand) {
  const left = normalizeCatalogLookupName(candidateBrand);
  const right = normalizeCatalogLookupName(existingBrand);
  if (!left || !right) return false;
  if (left === right) return false;
  return !brandTokenKeysMatch(left, right);
}

export function catalogBrandsCompatible(candidateBrand, existingBrand) {
  const left = normalizeCatalogLookupName(candidateBrand);
  const right = normalizeCatalogLookupName(existingBrand);
  if (!left && !right) return true;
  if (!left || !right) return false;
  if (left === right) return true;
  return brandTokenKeysMatch(left, right);
}

export function catalogCategoriesConflict(candidateCategory, existingCategory) {
  const left = normalizeCatalogLookupName(candidateCategory);
  const right = normalizeCatalogLookupName(existingCategory);
  if (!left || !right) return false;
  return left !== right;
}

export function catalogCategoriesCompatible(candidateCategory, existingCategory) {
  const left = normalizeCatalogLookupName(candidateCategory);
  const right = normalizeCatalogLookupName(existingCategory);
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left === right;
}

function tokenizeCatalogIdentity(value) {
  return normalizeCatalogLookupName(value)
    .replace(/[()[\]]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * When a product title starts with a declared brand ("Nothing Power (45W)"),
 * return that brand label. Longest match wins (Nothing Audio before Nothing).
 */
export function inferDeclaredBrandFromProductName(productName, declaredLabels = []) {
  const nameTokens = tokenizeCatalogIdentity(productName);
  if (nameTokens.length === 0) return null;
  let best = null;
  let bestTokenCount = 0;
  for (const label of Array.isArray(declaredLabels) ? declaredLabels : []) {
    const brandTokens = tokenizeCatalogIdentity(label);
    if (brandTokens.length === 0) continue;
    if (brandTokens.some((token) => token.length < 2)) continue;
    const matches = brandTokens.every((token, index) => nameTokens[index] === token);
    if (!matches) continue;
    if (brandTokens.length >= bestTokenCount) {
      best = String(label).trim();
      bestTokenCount = brandTokens.length;
    }
  }
  return best;
}

/**
 * Listing brand for create/navigation. A title that names a declared brand
 * (Nothing Power) must not stay mapped to a leftover catalog brand (JBL).
 */
export function resolveListingBrandIdentity({
  selectedBrand = '',
  catalogBrand = '',
  productName = '',
  declaredLabels = []
} = {}) {
  const inferred = inferDeclaredBrandFromProductName(productName, declaredLabels);
  const selected = String(selectedBrand || '').trim();
  const catalog = String(catalogBrand || '').trim();
  if (inferred) {
    if (!selected || catalogBrandsConflict(inferred, selected)) return inferred;
    return selected;
  }
  return selected || catalog || '';
}

/**
 * Catalog reuse must be the same product name (and brand when provided).
 * Never return the first fuzzy ILIKE hit — that attached Nothing chargers to JBL headphones.
 */
export function pickExactCatalogLookupProduct(candidates = [], { name, brand } = {}) {
  const needle = normalizeCatalogLookupName(name);
  if (!needle) return null;

  const exactNameMatches = (candidates || []).filter(
    (row) => normalizeCatalogLookupName(row?.name) === needle
  );
  if (exactNameMatches.length === 0) return null;

  const brandNeedle = normalizeCatalogLookupName(brand);
  // Name-only lookup must not attach to a sibling SKU (Nothing charger vs JBL headphones).
  if (!brandNeedle) return null;

  const brandMatches = exactNameMatches.filter((row) =>
    catalogBrandsCompatible(brandNeedle, row?.brand)
  );
  return brandMatches[0] || null;
}

/** True when an offer's name/category are not the shared catalog product's identity. */
export function catalogListingIdentityConflicts({
  catalogName = '',
  catalogCategory = '',
  listingName = '',
  listingCategory = ''
} = {}) {
  const cName = normalizeCatalogLookupName(catalogName);
  const lName = normalizeCatalogLookupName(listingName);
  const cCat = normalizeCatalogLookupName(catalogCategory);
  const lCat = normalizeCatalogLookupName(listingCategory);
  if (cName && lName && cName !== lName) return true;
  if (cCat && lCat && cCat !== lCat) return true;
  return false;
}

/**
 * True when a supplier offer is not the same product as the shared catalog row
 * (Nothing Power must not stay a variant of JBL headphones).
 */
export function catalogOfferIdentityConflicts(catalogProduct = {}, offerAttributes = {}) {
  const attrs = offerAttributes && typeof offerAttributes === 'object' ? offerAttributes : {};
  const listingName = attrs.listingName || attrs.name || '';
  const listingCategory = attrs.category || '';
  const listingBrand = attrs.brand || attrs.brandModel || '';
  return (
    catalogListingIdentityConflicts({
      catalogName: catalogProduct?.name,
      catalogCategory: catalogProduct?.category,
      listingName,
      listingCategory
    }) || catalogBrandsConflict(listingBrand, catalogProduct?.brand)
  );
}
