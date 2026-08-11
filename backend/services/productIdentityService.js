import crypto from 'crypto';
import {
  catalogSpecificationTemplateForVariantMerge,
  mergeCatalogAndOfferSpecificationsForDisplay,
  parseSpecificationsObject,
  parseSupplierOfferAttributes
} from './supplierCatalogHelpersService.js';
import { areSpecificationsEqual } from '../utils/supplierProductApproval.js';

/**
 * Product Identity Service (Phase 1)
 * Centralized identity rules to support catalog dedupe + variant uniqueness.
 */

function cleanString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function collapseSpaces(value) {
  return cleanString(value).replace(/\s+/g, ' ').trim();
}

/**
 * Text normalization for human-readable fields (name/brand/category/model).
 * Keeps alphanumeric content and separators stable across casing/spacing noise.
 */
export function normalizeTextField(value) {
  return collapseSpaces(value).toLowerCase();
}

/**
 * Identifier normalization for SKU-like values.
 * We preserve punctuation because many IDs are punctuation-sensitive.
 */
export function normalizeIdentifierField(value) {
  return collapseSpaces(value);
}

export function normalizeUnitField(value) {
  const v = normalizeTextField(value);
  if (!v) return '';
  const map = {
    kilograms: 'kg',
    kilogram: 'kg',
    kgs: 'kg',
    grams: 'g',
    gram: 'g',
    litres: 'l',
    liter: 'l',
    litre: 'l',
    millilitre: 'ml',
    milliliter: 'ml',
    pieces: 'pc',
    piece: 'pc',
    nos: 'pc'
  };
  return map[v] || v;
}

function normalizeSpecKey(key) {
  return normalizeTextField(key).replace(/\s+/g, '_');
}

function normalizeSpecValue(value) {
  if (Array.isArray(value)) {
    return value.map((v) => normalizeTextField(v)).filter(Boolean).sort();
  }
  if (value && typeof value === 'object') {
    const out = {};
    Object.keys(value)
      .sort()
      .forEach((k) => {
        const nk = normalizeSpecKey(k);
        if (!nk) return;
        out[nk] = normalizeSpecValue(value[k]);
      });
    return out;
  }
  return normalizeTextField(value);
}

/**
 * Normalized variation attributes from admin-defined specifications.
 * Any non-empty spec value can distinguish variants (color, ram, storage, etc.).
 */
export function normalizeVariantAttributes(specifications = {}) {
  const specs = specifications && typeof specifications === 'object' ? specifications : {};
  const out = {};
  Object.keys(specs)
    .sort()
    .forEach((key) => {
      const normalizedKey = normalizeSpecKey(key);
      if (!normalizedKey) return;
      const normalizedValue = normalizeSpecValue(specs[key]);
      if (
        normalizedValue === '' ||
        normalizedValue === null ||
        normalizedValue === undefined ||
        (Array.isArray(normalizedValue) && normalizedValue.length === 0)
      ) {
        return;
      }
      out[normalizedKey] = normalizedValue;
    });
  return out;
}

function stableHash(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Total catalog TSIN length including `TS` prefix (e.g. TSA7K = 5 chars). */
export const CATALOG_TSIN_TOTAL_LENGTH = 5;
/** Total variant TSIN length including `TS` prefix (e.g. TSA7K3M = 7 chars). */
export const VARIANT_TSIN_TOTAL_LENGTH = 7;
/** Legacy catalog TSINs are `TS` + 2 base36 chars (4 chars total). */
export const LEGACY_CATALOG_TSIN_BODY_LENGTH = 2;
/** New catalog body after `TS` — 3 chars so total catalog TSIN is 5. */
export const CATALOG_TSIN_BODY_LENGTH = CATALOG_TSIN_TOTAL_LENGTH - 2;
/** Variant suffix for new 5-char catalog parents (7 total − TS − 3 product). */
export const VARIANT_TSIN_BODY_LENGTH = VARIANT_TSIN_TOTAL_LENGTH - 2 - CATALOG_TSIN_BODY_LENGTH;
/** Variant suffix for legacy 4-char catalog parents (7 total − TS − 2 product). */
export const LEGACY_VARIANT_TSIN_BODY_LENGTH =
  VARIANT_TSIN_TOTAL_LENGTH - 2 - LEGACY_CATALOG_TSIN_BODY_LENGTH;

const TSIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Derive a fixed-length base36 code from a seed using hash bytes (uniform spread).
 */
function toShortAlphaNum(seed, length = CATALOG_TSIN_BODY_LENGTH) {
  const digest = crypto.createHash('sha256').update(String(seed)).digest();
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const mixed =
      digest[i] ^
      digest[(i + length) % digest.length] ^
      digest[(i + length * 2) % digest.length] ^
      digest[(i + length * 3) % digest.length];
    out += TSIN_ALPHABET[mixed % TSIN_ALPHABET.length];
  }
  return out;
}

export function isLegacyCatalogTsin(value) {
  const normalized = normalizeIdentifierField(value).toUpperCase();
  return (
    normalized.startsWith('TS') &&
    normalized.length === 2 + LEGACY_CATALOG_TSIN_BODY_LENGTH &&
    /^TS[A-Z0-9]{2}$/.test(normalized)
  );
}

function extractCatalogBodyFromParent(parentAsin, bodyLength) {
  const normalizedParent = normalizeIdentifierField(parentAsin).toUpperCase();
  if (normalizedParent.startsWith('TS')) {
    const body = normalizedParent.slice(2);
    if (body.length >= bodyLength) {
      return body.slice(0, bodyLength);
    }
    if (body.length > 0) {
      return toShortAlphaNum(normalizedParent, bodyLength);
    }
  }
  return toShortAlphaNum(normalizedParent || 'TS', bodyLength);
}

/**
 * TSIN deterministic ID format: exactly 5 characters — `TS` + 3 base36 (e.g. TSA7K).
 * Legacy rows may still store 4-char `TS` + 2 codes (e.g. TS22).
 */
export function buildAsinLikeId(catalog = {}) {
  const seed = JSON.stringify({
    gtin: catalog.gtin || '',
    mpn: catalog.mpn || '',
    brand: catalog.brand || '',
    name: catalog.name || '',
    category: catalog.category || '',
    unit: catalog.unit || '',
    packSize: catalog.packSize || ''
  });
  return `TS${toShortAlphaNum(seed, CATALOG_TSIN_BODY_LENGTH)}`;
}

/**
 * Variant TSIN deterministic ID format: exactly 7 characters total.
 * - Legacy parent (4 chars): TS + product(2) + variant(3) => 7 chars (e.g. TSA7K3M)
 * - New parent (5 chars):    TS + product(3) + variant(2) => 7 chars (e.g. TSA7K3M)
 * Same parent TSIN + same variant key => same variant TSIN within each format generation.
 */
export function buildVariantAsinLikeId(parentAsin, variantKey) {
  const normalizedParent = normalizeIdentifierField(parentAsin).toUpperCase();
  const legacyParent = isLegacyCatalogTsin(normalizedParent);
  const catalogBodyLength = legacyParent
    ? LEGACY_CATALOG_TSIN_BODY_LENGTH
    : CATALOG_TSIN_BODY_LENGTH;
  const variantBodyLength = legacyParent
    ? LEGACY_VARIANT_TSIN_BODY_LENGTH
    : VARIANT_TSIN_BODY_LENGTH;

  const productCode = extractCatalogBodyFromParent(normalizedParent, catalogBodyLength);
  const seed = `${normalizedParent}|${normalizeIdentifierField(variantKey)}`;
  const variantCode = toShortAlphaNum(seed, variantBodyLength);
  return `TS${productCode}${variantCode}`;
}

/**
 * Canonical catalog identity fields (shared product / parent).
 */
export function normalizeCatalogIdentity(input = {}) {
  return {
    name: normalizeTextField(input.name),
    category: normalizeTextField(input.category),
    brand: normalizeTextField(input.brand || input.brandModel),
    gtin: normalizeIdentifierField(input.gtin),
    mpn: normalizeIdentifierField(input.mpn || input.modelNumber),
    unit: normalizeUnitField(input.unit),
    packSize: normalizeTextField(input.packSize)
  };
}

/**
 * Canonical variant identity fields (supplier offer / child).
 */
export function normalizeVariantIdentity(input = {}) {
  const variantAttributes = normalizeVariantAttributes(input.specifications || input.variantAttributes || {});
  return {
    brandModel: normalizeTextField(input.brandModel),
    gtin: normalizeIdentifierField(input.gtin),
    mpn: normalizeIdentifierField(input.mpn || input.modelNumber || input.model_no),
    sku: normalizeIdentifierField(input.sku || input.skuNo || input.gsku),
    unit: normalizeUnitField(input.unit),
    packSize: normalizeTextField(input.packSize),
    variantAttributes
  };
}

/**
 * Build catalog key (fallback identity when GTIN/MPN are unavailable).
 */
export function buildCatalogKey(catalog = {}) {
  const payload = {
    name: catalog.name || '',
    category: catalog.category || '',
    brand: catalog.brand || '',
    unit: catalog.unit || '',
    packSize: catalog.packSize || ''
  };
  return stableHash(JSON.stringify(payload));
}

/**
 * Build variant key (exact offer/variation uniqueness key).
 */
export function buildVariantKey(variant = {}) {
  const payload = {
    brandModel: variant.brandModel || '',
    gtin: variant.gtin || '',
    mpn: variant.mpn || '',
    sku: variant.sku || '',
    unit: variant.unit || '',
    packSize: variant.packSize || '',
    variantAttributes: variant.variantAttributes || {}
  };
  return stableHash(JSON.stringify(payload));
}

/**
 * Ranking-ready identity object.
 */
export function buildIdentityBundle(input = {}) {
  const catalog = normalizeCatalogIdentity(input);
  const variant = normalizeVariantIdentity(input);
  return {
    catalog,
    variant,
    catalogKey: buildCatalogKey(catalog),
    variantKey: buildVariantKey(variant),
    asinLikeId: buildAsinLikeId(catalog),
    variantAsinLikeId: buildVariantAsinLikeId(buildAsinLikeId(catalog), buildVariantKey(variant)),
    matchSignals: {
      hasGtin: Boolean(catalog.gtin),
      hasMpn: Boolean(catalog.mpn),
      hasSku: Boolean(variant.sku)
    }
  };
}

/** Supplier-page variant key already chosen (cart / listing) — wins over recomputation. */
export function extractExplicitVariantKey(source = {}) {
  return String(source.variantKey || source.variant_key || '').trim();
}

/**
 * PO / cart line → same variant identity rules as supplier product create/update.
 */
export function buildSupplierVariantIdentityFromPoItem(item = {}, parentProduct = null) {
  const itemSpecs =
    item.specifications && typeof item.specifications === 'object' && !Array.isArray(item.specifications)
      ? item.specifications
      : {};
  return buildSupplierVariantIdentity(
    {
      unit: item.unit,
      brandModel: item.brandModel || item.modelBrand,
      gtin: item.gtin,
      mpn: item.mpn,
      sku: item.sku || item.skuNo || item.gsku || itemSpecs.sku || itemSpecs.skuNo || itemSpecs.gsku,
      packSize: item.packSize || item.pack_size || itemSpecs.packSize || itemSpecs.pack_size,
      specifications: itemSpecs
    },
    parentProduct
  );
}

/**
 * Resolve variant_key for DB matching: use supplier-page value when present, else compute.
 */
export function resolveSupplierVariantKeyForItem(item = {}, parentProduct = null) {
  const explicit = extractExplicitVariantKey(item);
  if (explicit) return explicit;
  return buildSupplierVariantIdentityFromPoItem(item, parentProduct).variantKey;
}

/** Whether PO queries should filter supplier_products.variant_key (not pick arbitrary variant). */
export function hasSupplierVariantSignals(item = {}, variantIdentity = null) {
  if (extractExplicitVariantKey(item)) return true;
  if (String(item?.supplierProductId || '').trim()) return true;
  const attrs = variantIdentity?.variant?.variantAttributes;
  if (attrs && typeof attrs === 'object' && Object.keys(attrs).length > 0) return true;
  return Boolean(
    variantIdentity?.matchSignals?.hasSku ||
    variantIdentity?.variant?.brandModel ||
    variantIdentity?.variant?.packSize
  );
}

/**
 * Variant identity for a supplier offer.
 *
 * Shared catalog rows may carry filled values from an older single-variant flow or another
 * offer. Those filled values must NOT enter the variant_key hash — only template keys — or
 * re-listing the same offer specs produces a new Variant TSIN whenever the catalog drifts.
 * Offer-filled values alone distinguish variants (COLOR/SIZE/etc.).
 */
export function buildSupplierVariantIdentity(offerInput = {}, parentProduct = null) {
  const catalogSpecs =
    parentProduct?.specifications &&
    typeof parentProduct.specifications === 'object' &&
    !Array.isArray(parentProduct.specifications)
      ? parentProduct.specifications
      : {};
  const offerSpecs =
    offerInput.specifications &&
    typeof offerInput.specifications === 'object' &&
    !Array.isArray(offerInput.specifications)
      ? offerInput.specifications
      : offerInput.variantAttributes &&
          typeof offerInput.variantAttributes === 'object' &&
          !Array.isArray(offerInput.variantAttributes)
        ? offerInput.variantAttributes
        : {};
  const mergedSpecifications = mergeCatalogAndOfferSpecificationsForDisplay(
    catalogSpecificationTemplateForVariantMerge(catalogSpecs),
    offerSpecs
  );
  return buildIdentityBundle({
    ...offerInput,
    specifications: mergedSpecifications
  });
}

/**
 * Keep variantAttributes aligned with the supplier-editable specifications object.
 * variantAttributes is used for variant_key hashing; it must not drift from specifications
 * or buyer-facing merges will show stale catalog values over saved offer specs.
 */
export function syncOfferAttributesWithSpecifications(attributes = {}) {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return {};
  }
  const specs = parseSpecificationsObject(attributes.specifications) || {};
  return {
    ...attributes,
    specifications: specs,
    variantAttributes: normalizeVariantAttributes(specs)
  };
}

function offerInputFromSupplierProductRow(row = {}) {
  const attrs = parseSupplierOfferAttributes(row?.attributes);
  const specs =
    parseSpecificationsObject(attrs.specifications) ||
    parseSpecificationsObject(attrs.specs) ||
    parseSpecificationsObject(attrs.specification) ||
    {};
  return {
    unit: attrs.unit || row.unit,
    brandModel: attrs.brandModel,
    gtin: attrs.gtin,
    mpn: attrs.mpn,
    sku: attrs.sku || attrs.skuNo || attrs.gsku || specs.sku || specs.skuNo || specs.gsku || '',
    packSize: attrs.packSize || specs.packSize || specs.pack_size || '',
    specifications: specs
  };
}

function extractSpecsFromOfferRow(row = {}) {
  return offerInputFromSupplierProductRow(row).specifications || {};
}

function extractSpecsFromProductVariantRow(row = {}) {
  const attrs =
    row?.canonical_attributes &&
    typeof row.canonical_attributes === 'object' &&
    !Array.isArray(row.canonical_attributes)
      ? row.canonical_attributes
      : {};
  return (
    parseSpecificationsObject(attrs.specifications) ||
    parseSpecificationsObject(attrs.specs) ||
    parseSpecificationsObject(attrs) ||
    {}
  );
}

function rankOfferForVariantReuse(row = {}) {
  const status = String(row?.status || '').toLowerCase();
  if (status === 'approved' && row?.is_active !== false) return 0;
  if (status === 'approved') return 1;
  if (status === 'pending') return 2;
  return 3;
}

function pickStableIdentityFromRow(row = {}, reason = 'reuse') {
  const variantKey = String(row?.variant_key || '').trim();
  const variantAsin = String(row?.variant_asin || '').trim();
  if (!variantKey || !variantAsin) return null;
  return {
    variantKey,
    variantAsin,
    reused: true,
    reason
  };
}

/**
 * Keep Variant TSIN stable when a supplier re-lists from the catalog with the same specs.
 * Matching is by meaningful specifications (not supplier SKU), so inventory/SKU differences
 * do not mint a new variant number for an already-stored variant.
 */
export function resolveStableVariantIdentityFromExistingOffers({
  parentAsin = '',
  parentProduct = null,
  computedIdentity = null,
  existingOffers = [],
  existingProductVariants = [],
  offerSpecifications = null,
  catalogSpecifications = null,
  specsUnchangedFromCatalog = false
} = {}) {
  const computedKey = String(computedIdentity?.variantKey || '').trim();
  const deterministicAsin = computedKey
    ? buildVariantAsinLikeId(parentAsin, computedKey)
    : '';
  const submittedSpecs =
    offerSpecifications && typeof offerSpecifications === 'object' && !Array.isArray(offerSpecifications)
      ? offerSpecifications
      : computedIdentity?.variant?.variantAttributes || {};
  const catalogSpecs =
    catalogSpecifications && typeof catalogSpecifications === 'object' && !Array.isArray(catalogSpecifications)
      ? catalogSpecifications
      : parentProduct?.specifications &&
          typeof parentProduct.specifications === 'object' &&
          !Array.isArray(parentProduct.specifications)
        ? parentProduct.specifications
        : {};

  if (!computedKey) {
    return {
      variantKey: '',
      variantAsin: deterministicAsin,
      reused: false,
      reason: 'missing_computed_key'
    };
  }

  const rankedOffers = [...(existingOffers || [])]
    .filter((row) => String(row?.status || '').toLowerCase() !== 'rejected')
    .sort((a, b) => rankOfferForVariantReuse(a) - rankOfferForVariantReuse(b));

  // 1) Exact stored key match
  for (const row of rankedOffers) {
    const storedKey = String(row?.variant_key || '').trim();
    if (storedKey === computedKey) {
      const picked = pickStableIdentityFromRow(row, 'exact_key');
      if (picked) return picked;
    }
  }

  // 2) Same meaningful offer specs as an existing supplier_products row (ignore SKU drift)
  for (const row of rankedOffers) {
    const existingSpecs = extractSpecsFromOfferRow(row);
    if (!areSpecificationsEqual(submittedSpecs, existingSpecs)) continue;
    const picked = pickStableIdentityFromRow(row, 'same_offer_specs');
    if (picked) return picked;
  }

  // 3) Same specs as a canonical product_variants row already stored for this catalog product
  const rankedVariants = [...(existingProductVariants || [])].filter((row) => {
    const status = String(row?.status || '').toLowerCase();
    return status !== 'rejected' && status !== 'retired';
  });
  for (const row of rankedVariants) {
    const existingSpecs = extractSpecsFromProductVariantRow(row);
    if (!areSpecificationsEqual(submittedSpecs, existingSpecs)) continue;
    const picked = pickStableIdentityFromRow(row, 'same_product_variant_specs');
    if (picked) return picked;
  }

  // 4) Catalog re-list with no spec changes: reuse the stored variant already tied to this product
  const unchangedFromCatalog =
    specsUnchangedFromCatalog ||
    (Object.keys(buildNormalizedSpecProbe(catalogSpecs)).length > 0 &&
      areSpecificationsEqual(submittedSpecs, catalogSpecs));

  if (unchangedFromCatalog) {
    for (const row of rankedOffers) {
      const existingSpecs = extractSpecsFromOfferRow(row);
      const legacyEmptyOfferSpecs = Object.keys(buildNormalizedSpecProbe(existingSpecs)).length === 0;
      if (
        legacyEmptyOfferSpecs ||
        areSpecificationsEqual(existingSpecs, catalogSpecs) ||
        areSpecificationsEqual(existingSpecs, submittedSpecs)
      ) {
        const picked = pickStableIdentityFromRow(row, 'catalog_unchanged_offer');
        if (picked) return picked;
      }
    }

    for (const row of rankedVariants) {
      const existingSpecs = extractSpecsFromProductVariantRow(row);
      const legacyEmptyVariantSpecs = Object.keys(buildNormalizedSpecProbe(existingSpecs)).length === 0;
      if (
        legacyEmptyVariantSpecs ||
        areSpecificationsEqual(existingSpecs, catalogSpecs) ||
        areSpecificationsEqual(existingSpecs, submittedSpecs)
      ) {
        const picked = pickStableIdentityFromRow(row, 'catalog_unchanged_product_variant');
        if (picked) return picked;
      }
    }

    // Single stored variant on this product → safe to reuse for an unchanged catalog re-list
    const distinctOfferAsins = [
      ...new Set(
        rankedOffers
          .map((row) => String(row?.variant_asin || '').trim())
          .filter(Boolean)
      )
    ];
    if (distinctOfferAsins.length === 1) {
      const row = rankedOffers.find(
        (candidate) => String(candidate?.variant_asin || '').trim() === distinctOfferAsins[0]
      );
      const picked = pickStableIdentityFromRow(row, 'catalog_unchanged_single_offer');
      if (picked) return picked;
    }

    const distinctVariantAsins = [
      ...new Set(
        rankedVariants
          .map((row) => String(row?.variant_asin || '').trim())
          .filter(Boolean)
      )
    ];
    if (distinctVariantAsins.length === 1) {
      const row = rankedVariants.find(
        (candidate) => String(candidate?.variant_asin || '').trim() === distinctVariantAsins[0]
      );
      const picked = pickStableIdentityFromRow(row, 'catalog_unchanged_single_product_variant');
      if (picked) return picked;
    }
  }

  return {
    variantKey: computedKey,
    variantAsin: deterministicAsin,
    reused: false,
    reason: 'computed'
  };
}

/** Lightweight non-empty probe used only to detect "empty specs" without importing private helpers. */
function buildNormalizedSpecProbe(specs = {}) {
  const parsed = specs && typeof specs === 'object' && !Array.isArray(specs) ? specs : {};
  const out = {};
  Object.entries(parsed).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value) && value.length === 0) return;
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0) return;
    if (typeof value === 'string' && value.trim() === '') return;
    out[String(key)] = value;
  });
  return out;
}

export default {
  normalizeTextField,
  normalizeIdentifierField,
  normalizeUnitField,
  normalizeCatalogIdentity,
  normalizeVariantIdentity,
  normalizeVariantAttributes,
  buildAsinLikeId,
  buildVariantAsinLikeId,
  isLegacyCatalogTsin,
  CATALOG_TSIN_TOTAL_LENGTH,
  VARIANT_TSIN_TOTAL_LENGTH,
  CATALOG_TSIN_BODY_LENGTH,
  LEGACY_CATALOG_TSIN_BODY_LENGTH,
  VARIANT_TSIN_BODY_LENGTH,
  LEGACY_VARIANT_TSIN_BODY_LENGTH,
  buildCatalogKey,
  buildVariantKey,
  buildIdentityBundle,
  buildSupplierVariantIdentity,
  syncOfferAttributesWithSpecifications,
  resolveStableVariantIdentityFromExistingOffers,
  extractExplicitVariantKey,
  buildSupplierVariantIdentityFromPoItem,
  resolveSupplierVariantKeyForItem,
  hasSupplierVariantSignals
};
