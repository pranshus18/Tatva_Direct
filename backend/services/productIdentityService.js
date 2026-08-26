import crypto from 'crypto';
import {
  catalogSpecificationTemplateForVariantMerge,
  mergeCatalogAndOfferSpecificationsForDisplay,
  parseSpecificationsObject,
  parseSupplierOfferAttributes
} from './supplierCatalogHelpersService.js';
import { areSpecificationsEqual, submittedSpecsCompatibleWithExistingVariant } from '../utils/supplierProductApproval.js';

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

/**
 * Prose / identity fields must not enter variant_key. A description that starts
 * with the product name is normal copy — not a second catalog identity.
 */
const VARIANT_IDENTITY_EXCLUDED_SPEC_KEYS = new Set([
  'description',
  'supplier_description',
  'supplierdescription',
  'published_description',
  'publisheddescription',
  'product_description',
  'productdescription',
  'about',
  'about_this_item',
  'overview',
  'details',
  'name',
  'product_name',
  'productname',
  'listing_name',
  'listingname',
  'barcode',
  'gtin',
  'upc',
  'ean',
  'images',
  'image',
  'category',
  'brand'
]);

export function isVariantIdentityExcludedSpecKey(key) {
  return VARIANT_IDENTITY_EXCLUDED_SPEC_KEYS.has(normalizeSpecKey(key));
}

/**
 * POS/catalog barcode must be a real scan code — never the product title or
 * the description (including when description starts with the product name).
 */
export function isPersistableProductBarcode(value, { name = '', description = '' } = {}) {
  const barcode = collapseSpaces(value);
  if (!barcode) return false;
  const barcodeNorm = barcode.toLowerCase();
  const barcodeCompact = barcodeNorm.replace(/\s+/g, '');
  const nameNorm = collapseSpaces(name).toLowerCase();
  const nameCompact = nameNorm.replace(/\s+/g, '');
  const descriptionNorm = collapseSpaces(description).toLowerCase();
  const descriptionCompact = descriptionNorm.replace(/\s+/g, '');
  if (nameCompact && barcodeCompact === nameCompact) return false;
  if (descriptionCompact && barcodeCompact === descriptionCompact) return false;
  const isGtin = /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(barcode);
  if (
    !isGtin &&
    nameCompact &&
    descriptionNorm &&
    (descriptionNorm === nameNorm || descriptionNorm.startsWith(`${nameNorm} `)) &&
    (barcodeCompact === nameCompact || descriptionCompact.startsWith(barcodeCompact))
  ) {
    return false;
  }
  return true;
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
      if (!normalizedKey || VARIANT_IDENTITY_EXCLUDED_SPEC_KEYS.has(normalizedKey)) return;
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

/** Product body after `TS` — 5 alphanumeric chars (e.g. TS + A7K3M). */
export const CATALOG_TSIN_BODY_LENGTH = 5;
/** Product TSIN total: `TS` + 5 alphanumeric chars = 7 (e.g. TSA7K3M). */
export const CATALOG_TSIN_TOTAL_LENGTH = 2 + CATALOG_TSIN_BODY_LENGTH;
/** Legacy catalog TSINs are `TS` + 2 alphanumeric chars (4 chars total). */
export const LEGACY_CATALOG_TSIN_BODY_LENGTH = 2;
/** Variant suffix: last 2 alphanumeric chars identify the variant. */
export const VARIANT_TSIN_SUFFIX_LENGTH = 2;
/** Legacy variant TSIN total: product(4) + variant(2) = 6. */
export const LEGACY_VARIANT_TSIN_TOTAL_LENGTH =
  2 + LEGACY_CATALOG_TSIN_BODY_LENGTH + VARIANT_TSIN_SUFFIX_LENGTH;
/** Current variant TSIN total: TS + product(5) + variant(2) = 9. */
export const NEW_VARIANT_TSIN_TOTAL_LENGTH =
  CATALOG_TSIN_TOTAL_LENGTH + VARIANT_TSIN_SUFFIX_LENGTH;
export const VARIANT_TSIN_TOTAL_LENGTH = NEW_VARIANT_TSIN_TOTAL_LENGTH;
/** Variant suffix for current product TSINs. */
export const VARIANT_TSIN_BODY_LENGTH = VARIANT_TSIN_SUFFIX_LENGTH;
/** Variant suffix for legacy product TSINs. */
export const LEGACY_VARIANT_TSIN_BODY_LENGTH = VARIANT_TSIN_SUFFIX_LENGTH;

/** Alphanumeric alphabet for product and variant codes (0-9, A-Z). */
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

/** Current product TSIN: `TS` + 5 alphanumeric chars. */
export function isCurrentCatalogTsin(value) {
  const normalized = normalizeIdentifierField(value).toUpperCase();
  return normalized.length === CATALOG_TSIN_TOTAL_LENGTH && /^TS[A-Z0-9]{5}$/.test(normalized);
}

/** Current variant TSIN: current product TSIN + 2 alphanumeric chars. */
export function isCurrentVariantTsin(parentAsin, variantAsin) {
  const parent = normalizeIdentifierField(parentAsin).toUpperCase();
  const variant = normalizeIdentifierField(variantAsin).toUpperCase();
  if (!isCurrentCatalogTsin(parent) || !variant) return false;
  return (
    variant.length === parent.length + VARIANT_TSIN_SUFFIX_LENGTH &&
    variant.startsWith(parent) &&
    /^[A-Z0-9]{2}$/.test(variant.slice(-VARIANT_TSIN_SUFFIX_LENGTH))
  );
}

/**
 * Product TSIN: `TS` + 5 alphanumeric characters (e.g. TSA7K3M).
 * Legacy rows may still store shorter codes (e.g. TS22, TSA7K).
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

/** New 7-char product TSIN when the deterministic catalog code collides with an unrelated row. */
export function buildDisambiguatedAsinLikeId(baseAsin, salt = '') {
  return `TS${toShortAlphaNum(
    `asin-retry:${String(baseAsin || '').trim()}:${String(salt || '').trim()}`,
    CATALOG_TSIN_BODY_LENGTH
  )}`;
}

/**
 * Variant TSIN: product TSIN + 2 alphanumeric variant chars.
 * Current format: TS + product(5) + variant(2) => 9 chars (e.g. TSA7K3M9K).
 * Older parents keep their prefix and still append 2 variant chars.
 * Codes are A-Z0-9 only. Same parent + same variant key => same variant TSIN.
 */
export function buildVariantAsinLikeId(parentAsin, variantKey) {
  const normalizedParent = normalizeIdentifierField(parentAsin).toUpperCase();
  const seed = `${normalizedParent}|${normalizeIdentifierField(variantKey)}`;
  const variantCode = toShortAlphaNum(seed, VARIANT_TSIN_SUFFIX_LENGTH);
  return `${normalizedParent}${variantCode}`;
}

export function getVariantTsinTotalLength(parentAsin) {
  const normalizedParent = normalizeIdentifierField(parentAsin).toUpperCase();
  if (!normalizedParent) return NEW_VARIANT_TSIN_TOTAL_LENGTH;
  return normalizedParent.length + VARIANT_TSIN_SUFFIX_LENGTH;
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

function pickStableIdentityFromRow(row = {}, reason = 'reuse', parentAsin = '') {
  const variantKey = String(row?.variant_key || '').trim();
  if (!variantKey) return null;
  const storedAsin = String(row?.variant_asin || '').trim();
  const rebuiltAsin = parentAsin ? buildVariantAsinLikeId(parentAsin, variantKey) : '';
  const variantAsin = isCurrentVariantTsin(parentAsin, storedAsin)
    ? storedAsin.toUpperCase()
    : rebuiltAsin || storedAsin || variantKey;
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

  const parentAsinForReuse = String(parentAsin || parentProduct?.asin || '').trim();

  // 1) Exact stored key match
  for (const row of rankedOffers) {
    const storedKey = String(row?.variant_key || '').trim();
    if (storedKey === computedKey) {
      const picked = pickStableIdentityFromRow(row, 'exact_key', parentAsinForReuse);
      if (picked) return picked;
    }
  }

  // 2) Same meaningful offer specs as an existing supplier_products row
  //    (submitted may include extra category-template keys; core variant values must match).
  for (const row of rankedOffers) {
    const existingSpecs = extractSpecsFromOfferRow(row);
    if (
      !areSpecificationsEqual(submittedSpecs, existingSpecs) &&
      !submittedSpecsCompatibleWithExistingVariant(submittedSpecs, existingSpecs)
    ) {
      continue;
    }
    const picked = pickStableIdentityFromRow(row, 'same_offer_specs', parentAsinForReuse);
    if (picked) return picked;
  }

  // 3) Same specs as a canonical product_variants row already stored for this catalog product
  const rankedVariants = [...(existingProductVariants || [])].filter((row) => {
    const status = String(row?.status || '').toLowerCase();
    return status !== 'rejected' && status !== 'retired';
  });
  for (const row of rankedVariants) {
    const existingSpecs = extractSpecsFromProductVariantRow(row);
    if (
      !areSpecificationsEqual(submittedSpecs, existingSpecs) &&
      !submittedSpecsCompatibleWithExistingVariant(submittedSpecs, existingSpecs)
    ) {
      continue;
    }
    const picked = pickStableIdentityFromRow(row, 'same_product_variant_specs', parentAsinForReuse);
    if (picked) return picked;
  }

  // 4) Catalog re-list with no spec changes: reuse the stored variant already tied to this product
  const unchangedFromCatalog =
    specsUnchangedFromCatalog ||
    (Object.keys(buildNormalizedSpecProbe(catalogSpecs)).length > 0 &&
      (areSpecificationsEqual(submittedSpecs, catalogSpecs) ||
        submittedSpecsCompatibleWithExistingVariant(submittedSpecs, catalogSpecs)));

  if (unchangedFromCatalog) {
    for (const row of rankedOffers) {
      const existingSpecs = extractSpecsFromOfferRow(row);
      if (!canReuseUnchangedCatalogRow(submittedSpecs, existingSpecs, catalogSpecs)) {
        continue;
      }
      const picked = pickStableIdentityFromRow(row, 'catalog_unchanged_offer', parentAsinForReuse);
      if (picked) return picked;
    }

    for (const row of rankedVariants) {
      const existingSpecs = extractSpecsFromProductVariantRow(row);
      if (!canReuseUnchangedCatalogRow(submittedSpecs, existingSpecs, catalogSpecs)) {
        continue;
      }
      const picked = pickStableIdentityFromRow(
        row,
        'catalog_unchanged_product_variant',
        parentAsinForReuse
      );
      if (picked) return picked;
    }

    // Single stored variant on this product → reuse only when submitted specs
    // are empty or compatible. A different filled variant must keep its own key.
    const distinctOfferKeys = [
      ...new Set(
        rankedOffers
          .map((row) => String(row?.variant_key || '').trim())
          .filter(Boolean)
      )
    ];
    if (distinctOfferKeys.length === 1) {
      const row = rankedOffers.find(
        (candidate) => String(candidate?.variant_key || '').trim() === distinctOfferKeys[0]
      );
      if (canReuseUnchangedCatalogRow(submittedSpecs, extractSpecsFromOfferRow(row), catalogSpecs)) {
        const picked = pickStableIdentityFromRow(
          row,
          'catalog_unchanged_single_offer',
          parentAsinForReuse
        );
        if (picked) return picked;
      }
    }

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
      if (canReuseUnchangedCatalogRow(submittedSpecs, extractSpecsFromOfferRow(row), catalogSpecs)) {
        const picked = pickStableIdentityFromRow(
          row,
          'catalog_unchanged_single_offer',
          parentAsinForReuse
        );
        if (picked) return picked;
      }
    }

    const distinctVariantKeys = [
      ...new Set(
        rankedVariants
          .map((row) => String(row?.variant_key || '').trim())
          .filter(Boolean)
      )
    ];
    if (distinctVariantKeys.length === 1) {
      const row = rankedVariants.find(
        (candidate) => String(candidate?.variant_key || '').trim() === distinctVariantKeys[0]
      );
      if (
        canReuseUnchangedCatalogRow(
          submittedSpecs,
          extractSpecsFromProductVariantRow(row),
          catalogSpecs
        )
      ) {
        const picked = pickStableIdentityFromRow(
          row,
          'catalog_unchanged_single_product_variant',
          parentAsinForReuse
        );
        if (picked) return picked;
      }
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
      if (
        canReuseUnchangedCatalogRow(
          submittedSpecs,
          extractSpecsFromProductVariantRow(row),
          catalogSpecs
        )
      ) {
        const picked = pickStableIdentityFromRow(
          row,
          'catalog_unchanged_single_product_variant',
          parentAsinForReuse
        );
        if (picked) return picked;
      }
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

function hasMeaningfulSpecs(specs = {}) {
  return Object.keys(buildNormalizedSpecProbe(specs)).length > 0;
}

/**
 * Reuse a stored variant on an "unchanged catalog" re-list only when the submitted
 * specs are empty, match that row, or match the catalog baseline.
 * A different filled variant must not inherit the only existing variant_key —
 * that collision is what surfaces as supplier_products unique-constraint errors.
 */
function canReuseUnchangedCatalogRow(submittedSpecs = {}, existingSpecs = {}, catalogSpecs = {}) {
  if (
    areSpecificationsEqual(submittedSpecs, existingSpecs) ||
    submittedSpecsCompatibleWithExistingVariant(submittedSpecs, existingSpecs)
  ) {
    return true;
  }
  if (!hasMeaningfulSpecs(submittedSpecs)) {
    return !hasMeaningfulSpecs(existingSpecs) || areSpecificationsEqual(existingSpecs, catalogSpecs);
  }
  if (!hasMeaningfulSpecs(existingSpecs)) {
    return false;
  }
  return (
    areSpecificationsEqual(existingSpecs, catalogSpecs) &&
    (areSpecificationsEqual(submittedSpecs, catalogSpecs) ||
      submittedSpecsCompatibleWithExistingVariant(submittedSpecs, catalogSpecs))
  );
}

export default {
  normalizeTextField,
  normalizeIdentifierField,
  normalizeUnitField,
  normalizeCatalogIdentity,
  normalizeVariantIdentity,
  normalizeVariantAttributes,
  isPersistableProductBarcode,
  isVariantIdentityExcludedSpecKey,
  buildAsinLikeId,
  buildDisambiguatedAsinLikeId,
  buildVariantAsinLikeId,
  isLegacyCatalogTsin,
  isCurrentCatalogTsin,
  isCurrentVariantTsin,
  CATALOG_TSIN_TOTAL_LENGTH,
  VARIANT_TSIN_TOTAL_LENGTH,
  LEGACY_VARIANT_TSIN_TOTAL_LENGTH,
  NEW_VARIANT_TSIN_TOTAL_LENGTH,
  VARIANT_TSIN_SUFFIX_LENGTH,
  CATALOG_TSIN_BODY_LENGTH,
  LEGACY_CATALOG_TSIN_BODY_LENGTH,
  VARIANT_TSIN_BODY_LENGTH,
  LEGACY_VARIANT_TSIN_BODY_LENGTH,
  getVariantTsinTotalLength,
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
