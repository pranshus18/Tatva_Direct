import { normalizeBrandIdentity } from './supplierChainEntryValidation';

function tokenizeBrandIdentity(value) {
  return normalizeBrandIdentity(value)
    .split(/\s+/)
    .filter(Boolean);
}

export function listingBrandsConflict(left, right) {
  const a = normalizeBrandIdentity(left);
  const b = normalizeBrandIdentity(right);
  if (!a || !b) return false;
  if (a === b) return false;
  const tokensA = a.split(/\s+/).filter(Boolean);
  const tokensB = b.split(/\s+/).filter(Boolean);
  const prefix = (shorter, longer) =>
    shorter.length > 0 &&
    shorter.every((token, index) => token === longer[index]);
  return !(prefix(tokensA, tokensB) || prefix(tokensB, tokensA));
}

/**
 * When a product title starts with a declared brand ("Nothing Power (45W)"),
 * return that brand label. Longest match wins.
 */
export function inferDeclaredBrandFromProductName(productName, declaredLabels = []) {
  const nameTokens = tokenizeBrandIdentity(productName);
  if (nameTokens.length === 0) return null;
  let best = null;
  let bestTokenCount = 0;
  for (const label of Array.isArray(declaredLabels) ? declaredLabels : []) {
    const brandTokens = tokenizeBrandIdentity(label);
    if (brandTokens.length === 0 || brandTokens.some((token) => token.length < 2)) continue;
    const matches = brandTokens.every((token, index) => nameTokens[index] === token);
    if (!matches) continue;
    if (brandTokens.length >= bestTokenCount) {
      best = String(label).trim();
      bestTokenCount = brandTokens.length;
    }
  }
  return best;
}

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
    if (!selected || listingBrandsConflict(inferred, selected)) return inferred;
    return selected;
  }
  return selected || catalog || '';
}

export function buildManageInventorySearchParams({
  brand = '',
  productName = '',
  supplierProductId = '',
  from = 'product-management'
} = {}) {
  const params = new URLSearchParams();
  if (brand) params.set('brand', brand);
  if (productName) params.set('productName', productName);
  if (supplierProductId) params.set('supplierProductId', supplierProductId);
  if (from) params.set('from', from);
  return params;
}

function offerRowId(row) {
  return String(row?.supplier_product_id || row?.supplierProductId || row?.id || '').trim();
}

/**
 * Open the listing that was just created, even when the URL still has a stale
 * leftover brand (brand=jbl with productName=Nothing Power (45W)).
 */
export function pickInventoryDeepLinkMatch(
  products,
  { productName = '', brand = '', supplierProductId = '' } = {},
  matchOfferId
) {
  const rows = Array.isArray(products) ? products : [];
  const offerId = String(supplierProductId || '').trim();
  if (offerId) {
    const byId = matchOfferId
      ? rows.find((row) => matchOfferId(row, offerId))
      : rows.find((row) => offerRowId(row) === offerId);
    if (byId) return byId;
  }

  const nameNeedle = String(productName || '').trim().toLowerCase();
  if (!nameNeedle) return null;
  const nameMatches = rows.filter(
    (row) => String(row?.name || '').trim().toLowerCase() === nameNeedle
  );
  if (nameMatches.length === 0) return null;

  const brandNeedle = String(brand || '').trim().toLowerCase();
  if (!brandNeedle) return nameMatches[0];
  const brandMatch = nameMatches.find((row) => {
    const rowBrand = String(row?.brand || row?.brandModel || '').trim().toLowerCase();
    return !rowBrand || rowBrand === brandNeedle;
  });
  return brandMatch || nameMatches[0];
}

/** Brand is locked after create unless the title names a different declared brand. */
export function isListingBrandLocked({ product, selectedBrand, productName, declaredLabels = [] } = {}) {
  if (!product) return false;
  const selected = String(selectedBrand || '').trim();
  if (!selected) return false;
  const inferred = inferDeclaredBrandFromProductName(productName, declaredLabels);
  if (inferred && listingBrandsConflict(inferred, selected)) return false;
  return true;
}
