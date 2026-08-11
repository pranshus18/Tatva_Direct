function normalizeSpecKeyForComparison(key) {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeSpecValueForComparison(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalizeSpecValueForComparison);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        out[key] = normalizeSpecValueForComparison(value[key]);
      });
    return out;
  }
  return value;
}

function isMeaningfullyFilledSpecValue(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return String(value).trim() !== '';
}

function buildNormalizedMeaningfulSpecMap(specs = {}) {
  const parsed =
    specs && typeof specs === 'object' && !Array.isArray(specs) ? specs : {};
  const out = new Map();
  Object.entries(parsed).forEach(([key, value]) => {
    const norm = normalizeSpecKeyForComparison(key);
    if (!norm || !isMeaningfullyFilledSpecValue(value)) return;
    out.set(norm, normalizeSpecValueForComparison(value));
  });
  return out;
}

function serializeMeaningfulSpecMap(map) {
  return JSON.stringify([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/**
 * Spec equality for update gating: ignore empty slots and key casing/spacing so
 * inventory saves that echo the same values never look like a variant change.
 */
export function areSpecificationsEqual(currentSpecs = {}, nextSpecs = {}) {
  const currentMap = buildNormalizedMeaningfulSpecMap(currentSpecs);
  const nextMap = buildNormalizedMeaningfulSpecMap(nextSpecs);
  return serializeMeaningfulSpecMap(currentMap) === serializeMeaningfulSpecMap(nextMap);
}

/**
 * True when a supplier re-listing an existing catalog product changed any
 * meaningful specification value from the catalog baseline.
 */
export function hasSupplierSpecificationChangesFromCatalog({
  catalogSpecs = {},
  supplierSpecs = {}
} = {}) {
  const baseline = buildNormalizedMeaningfulSpecMap(catalogSpecs);
  const submitted = buildNormalizedMeaningfulSpecMap(supplierSpecs);

  if (baseline.size === 0) return false;

  for (const [norm, baselineValue] of baseline) {
    const submittedValue = submitted.get(norm);
    if (submittedValue === undefined) continue;
    if (JSON.stringify(baselineValue) !== JSON.stringify(submittedValue)) {
      return true;
    }
  }

  for (const norm of submitted.keys()) {
    if (!baseline.has(norm)) return true;
  }

  return false;
}

export function shouldMoveToPendingForSpecChange({ specificationsProvided, currentSpecs, nextSpecs }) {
  if (!specificationsProvided) return false;
  return !areSpecificationsEqual(currentSpecs, nextSpecs);
}

function isApprovedStatus(status) {
  return String(status || '').toLowerCase() === 'approved';
}

/**
 * Auto-approve a new supplier offer only when the attach is a clear re-list of a product
 * that is already live — not when a weak name-only match or a brand-new catalog row is used.
 *
 * matchStrength:
 * - explicit: supplier picked an existing catalog product in the UI
 * - strong: GTIN / brand+MPN / identifier / exact catalog_key match
 * - weak: name+category only — always needs admin approval for the new offer
 * - none: brand-new catalog product
 */
export function shouldAutoApproveSupplierOfferOnCreate({
  hasApprovedSameVariantOffer = false,
  catalogProductStatus = '',
  hasAnyApprovedOfferForProduct = false,
  matchStrength = 'none',
  hasSpecificationChanges = false
} = {}) {
  if (hasApprovedSameVariantOffer) return true;

  const strength = String(matchStrength || 'none').trim().toLowerCase();
  const isConfirmedReList = strength === 'explicit' || strength === 'strong';
  if (!isConfirmedReList) return false;

  // Changed spec values on an existing catalog product need the same admin review as a new product.
  if (hasSpecificationChanges) return false;

  // Confirmed re-lists of a live marketplace product skip another admin gate.
  if (isApprovedStatus(catalogProductStatus)) return true;
  if (hasAnyApprovedOfferForProduct) return true;
  return false;
}

/**
 * Spec / variant-identity edits should not demote an offer back to pending when the
 * catalog product (or any offer for it) is already approved.
 */
export function shouldRequireApprovalForVariantSpecChange({
  catalogProductStatus = '',
  hasAnyApprovedOfferForProduct = false,
  currentOfferStatus = ''
} = {}) {
  if (isApprovedStatus(catalogProductStatus)) return false;
  if (hasAnyApprovedOfferForProduct) return false;
  if (isApprovedStatus(currentOfferStatus)) return false;
  return true;
}

/**
 * Variant TSIN rules on supplier offer update:
 * - Inventory-only (price/stock/location/tax/images): never mint a new variant id
 * - Specs unchanged (even if the client re-sends them): keep the existing variant id
 * - Specs meaningfully changed: recompute variant_key + variant_asin (new variant id)
 */
export function shouldRecomputeSupplierVariantKeyOnUpdate({
  specificationsProvided = false,
  specificationsChanged = false
} = {}) {
  if (!specificationsProvided) return false;
  return Boolean(specificationsChanged);
}

export default {
  areSpecificationsEqual,
  hasSupplierSpecificationChangesFromCatalog,
  shouldMoveToPendingForSpecChange,
  shouldAutoApproveSupplierOfferOnCreate,
  shouldRequireApprovalForVariantSpecChange,
  shouldRecomputeSupplierVariantKeyOnUpdate
};
