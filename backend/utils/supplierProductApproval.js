function normalizeSpecShape(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeSpecShape(item));
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        out[key] = normalizeSpecShape(value[key]);
      });
    return out;
  }
  return value;
}

export function areSpecificationsEqual(currentSpecs = {}, nextSpecs = {}) {
  return JSON.stringify(normalizeSpecShape(currentSpecs || {})) === JSON.stringify(normalizeSpecShape(nextSpecs || {}));
}

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
 * Only re-hash variant_key when the client explicitly sent specification changes.
 * Inventory-only saves (price/stock/location/tax) must not migrate an offer onto
 * another variant's identity key.
 */
export function shouldRecomputeSupplierVariantKeyOnUpdate({
  specificationsProvided = false,
  specificationsChanged = false,
  computedVariantKey = '',
  storedVariantKey = ''
} = {}) {
  if (!specificationsProvided) return false;
  if (specificationsChanged) return true;
  return String(computedVariantKey || '') !== String(storedVariantKey || '');
}

export default {
  areSpecificationsEqual,
  hasSupplierSpecificationChangesFromCatalog,
  shouldMoveToPendingForSpecChange,
  shouldAutoApproveSupplierOfferOnCreate,
  shouldRequireApprovalForVariantSpecChange,
  shouldRecomputeSupplierVariantKeyOnUpdate
};
