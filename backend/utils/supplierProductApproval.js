function normalizeSpecKeyForComparison(key) {
  return String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeSpecValueForComparison(value) {
  if (value === null || value === undefined) return null;
  // Booleans / "true" / "yes" must compare equal (template parsing vs catalog strings).
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  if (typeof value === 'string') {
    // Collapse whitespace so "500 ML" and "500ML" compare as the same variant value.
    const trimmed = value.trim().toLowerCase().replace(/\s+/g, '');
    if (trimmed === 'true' || trimmed === 'yes') return 'true';
    if (trimmed === 'false' || trimmed === 'no') return 'false';
    // "57" (catalog string) and 57 (template number field) must not look like a change.
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const asNum = Number(trimmed);
      return Number.isFinite(asNum) ? String(asNum) : trimmed;
    }
    return trimmed;
  }
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
 * True when submitted specs are the same variant as an existing offer, allowing
 * extra filled template keys on the new submission (category template growth).
 * Every meaningful key on the existing variant must still be present with the same value.
 */
export function submittedSpecsCompatibleWithExistingVariant(
  submittedSpecs = {},
  existingSpecs = {}
) {
  const submitted = buildNormalizedMeaningfulSpecMap(submittedSpecs);
  const existing = buildNormalizedMeaningfulSpecMap(existingSpecs);
  if (existing.size === 0) return false;

  for (const [norm, existingValue] of existing) {
    if (!submitted.has(norm)) return false;
    if (JSON.stringify(submitted.get(norm)) !== JSON.stringify(existingValue)) {
      return false;
    }
  }
  return true;
}

/**
 * True when two spec maps share at least one meaningful key and every shared key agrees.
 * Used for catalog re-lists where template key sets differ between suppliers/offers.
 */
export function specificationsAgreeOnOverlappingKeys(leftSpecs = {}, rightSpecs = {}) {
  const left = buildNormalizedMeaningfulSpecMap(leftSpecs);
  const right = buildNormalizedMeaningfulSpecMap(rightSpecs);
  if (left.size === 0 || right.size === 0) return false;

  let shared = 0;
  for (const [norm, leftValue] of left) {
    if (!right.has(norm)) continue;
    shared += 1;
    if (JSON.stringify(leftValue) !== JSON.stringify(right.get(norm))) {
      return false;
    }
  }
  return shared > 0;
}

/**
 * When re-listing a catalog product, keep the catalog/offer identity keys and drop
 * unrelated category-template values (e.g. mouse defaults on headphones).
 * Overlapping submitted values win so intentional edits are preserved.
 */
export function retainCatalogCompatibleSpecifications(catalogSpecs = {}, submittedSpecs = {}) {
  const catalog =
    catalogSpecs && typeof catalogSpecs === 'object' && !Array.isArray(catalogSpecs)
      ? catalogSpecs
      : {};
  const submitted =
    submittedSpecs && typeof submittedSpecs === 'object' && !Array.isArray(submittedSpecs)
      ? submittedSpecs
      : {};

  const catalogMeaningful = buildNormalizedMeaningfulSpecMap(catalog);
  if (catalogMeaningful.size === 0) {
    return { ...submitted };
  }

  const submittedByNorm = new Map();
  Object.entries(submitted).forEach(([key, value]) => {
    const norm = normalizeSpecKeyForComparison(key);
    if (!norm) return;
    submittedByNorm.set(norm, { key, value });
  });

  const out = {};
  Object.entries(catalog).forEach(([key, catalogValue]) => {
    const norm = normalizeSpecKeyForComparison(key);
    if (!norm) return;
    if (!isMeaningfullyFilledSpecValue(catalogValue) && !submittedByNorm.has(norm)) {
      return;
    }
    const submittedHit = submittedByNorm.get(norm);
    if (submittedHit && isMeaningfullyFilledSpecValue(submittedHit.value)) {
      out[submittedHit.key] = submittedHit.value;
    } else if (isMeaningfullyFilledSpecValue(catalogValue)) {
      out[key] = catalogValue;
    }
  });
  return out;
}

/**
 * True when two spec maps describe the same catalog variant.
 * Empty offer specs inherit the catalog product (add-from-database).
 * Extra template keys and reverse subsets still count as the same variant.
 * Conflicting values (e.g. White vs Black) do not.
 */
export function specsRepresentSameCatalogVariant(
  submittedSpecs = {},
  existingSpecs = {},
  catalogSpecs = {}
) {
  const submitted = submittedSpecs && typeof submittedSpecs === 'object' ? submittedSpecs : {};
  const existing = existingSpecs && typeof existingSpecs === 'object' ? existingSpecs : {};
  const catalog = catalogSpecs && typeof catalogSpecs === 'object' ? catalogSpecs : {};

  if (areSpecificationsEqual(submitted, existing)) return true;
  if (submittedSpecsCompatibleWithExistingVariant(submitted, existing)) return true;
  if (submittedSpecsCompatibleWithExistingVariant(existing, submitted)) return true;

  const submittedMap = buildNormalizedMeaningfulSpecMap(submitted);
  const existingMap = buildNormalizedMeaningfulSpecMap(existing);
  const catalogMap = buildNormalizedMeaningfulSpecMap(catalog);
  const submittedEffective = submittedMap.size > 0 ? submitted : catalog;
  const existingEffective = existingMap.size > 0 ? existing : catalog;

  if (areSpecificationsEqual(submittedEffective, existingEffective)) return true;
  if (submittedSpecsCompatibleWithExistingVariant(submittedEffective, existingEffective)) return true;
  if (submittedSpecsCompatibleWithExistingVariant(existingEffective, submittedEffective)) return true;

  if (catalogMap.size > 0) {
    const submittedMatchesCatalog =
      submittedMap.size === 0 ||
      areSpecificationsEqual(submitted, catalog) ||
      submittedSpecsCompatibleWithExistingVariant(submitted, catalog) ||
      submittedSpecsCompatibleWithExistingVariant(catalog, submitted);
    const existingMatchesCatalog =
      existingMap.size === 0 ||
      areSpecificationsEqual(existing, catalog) ||
      submittedSpecsCompatibleWithExistingVariant(existing, catalog) ||
      submittedSpecsCompatibleWithExistingVariant(catalog, existing);
    if (
      submittedMatchesCatalog &&
      existingMatchesCatalog &&
      (submittedMap.size === 0 ||
        existingMap.size === 0 ||
        specificationsAgreeOnOverlappingKeys(submitted, existing))
    ) {
      return true;
    }
  }

  return specificationsAgreeOnOverlappingKeys(submittedEffective, existingEffective);
}

/**
 * Pick the approved offer whose specs best match the submission (no value conflicts).
 * Returns null when every candidate has at least one overlapping value conflict.
 */
export function findBestMatchingApprovedOfferForSpecs(offers = [], submittedSpecs = {}, catalogSpecs = {}) {
  let best = null;
  let bestScore = -1;
  const approvedRows = [];

  for (const row of offers || []) {
    if (String(row?.status || '').toLowerCase() !== 'approved') continue;
    if (row?.is_active === false) continue;
    approvedRows.push(row);

    const attrs =
      row?.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes)
        ? row.attributes
        : {};
    const existingSpecs =
      (attrs.specifications && typeof attrs.specifications === 'object'
        ? attrs.specifications
        : null) ||
      (attrs.specs && typeof attrs.specs === 'object' ? attrs.specs : null) ||
      {};

    const existingMap = buildNormalizedMeaningfulSpecMap(existingSpecs);
    // Legacy approved offers often store no nested specs — still reusable for re-lists.
    if (existingMap.size === 0) {
      if (bestScore < 0) {
        bestScore = 0;
        best = row;
      }
      continue;
    }

    if (specsRepresentSameCatalogVariant(submittedSpecs, existingSpecs, catalogSpecs)) {
      const score = Math.max(existingMap.size, 1) + 1000;
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
      continue;
    }

    if (!specificationsAgreeOnOverlappingKeys(submittedSpecs, existingSpecs)) continue;

    const submitted = buildNormalizedMeaningfulSpecMap(submittedSpecs);
    let score = 0;
    for (const [norm] of submitted) {
      if (existingMap.has(norm)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  // Single live offer for this catalog product: reuse it when there is no overlapping
  // value conflict (template key renames / extra keys must not force admin review).
  if (bestScore < 1000 && approvedRows.length === 1) {
    const only = approvedRows[0];
    const attrs =
      only?.attributes && typeof only.attributes === 'object' && !Array.isArray(only.attributes)
        ? only.attributes
        : {};
    const existingSpecs =
      (attrs.specifications && typeof attrs.specifications === 'object'
        ? attrs.specifications
        : null) ||
      (attrs.specs && typeof attrs.specs === 'object' ? attrs.specs : null) ||
      {};
    const existingMap = buildNormalizedMeaningfulSpecMap(existingSpecs);
    const submittedMap = buildNormalizedMeaningfulSpecMap(submittedSpecs);
    let conflict = false;
    for (const [norm, leftValue] of existingMap) {
      if (!submittedMap.has(norm)) continue;
      if (JSON.stringify(leftValue) !== JSON.stringify(submittedMap.get(norm))) {
        conflict = true;
        break;
      }
    }
    if (!conflict) return only;
  }

  return best;
}

/**
 * True when a supplier re-listing an existing catalog product changed any
 * meaningful specification *value* from the catalog baseline.
 * Extra template keys alone are not treated as a new variant (suppliers must
 * fill current category templates even when re-listing an unchanged SKU).
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
  submittedSpecsCompatibleWithExistingVariant,
  specsRepresentSameCatalogVariant,
  hasSupplierSpecificationChangesFromCatalog,
  shouldMoveToPendingForSpecChange,
  shouldAutoApproveSupplierOfferOnCreate,
  shouldRequireApprovalForVariantSpecChange,
  shouldRecomputeSupplierVariantKeyOnUpdate
};
