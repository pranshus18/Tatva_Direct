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
