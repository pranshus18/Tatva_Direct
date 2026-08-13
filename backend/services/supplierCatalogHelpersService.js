export const normalizeText = (text) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s\d-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeGtin = (value) => String(value || '').replace(/\s+/g, '').trim();

export const isValidGtin = (value) => /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(value);

export const isCatalogGuardrailsEnabled = () => (process.env.CATALOG_GUARDRAILS_ENABLED || 'true') !== 'false';

export const onboardingAutoApproveThreshold = Number(process.env.ONBOARDING_AUTO_APPROVE_THRESHOLD || '0.8');

export const normalizeModelIdentifier = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const sanitizeSpecifications = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const cleaned = {};
  Object.entries(input).forEach(([key, value]) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;
    if (value === undefined) return;
    cleaned[normalizedKey] = value;
  });
  return cleaned;
};

export const isMeaningfullyFilledSpecValue = (value) => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return String(value).trim() !== '';
};

export const countMeaningfulSpecValues = (specsObj) =>
  Object.values(specsObj || {}).filter(isMeaningfullyFilledSpecValue).length;

/** Normalize specifications stored as object, JSON string, or legacy array rows. */
export const parseSpecificationsObject = (value) => {
  if (!value) return null;

  const arrayToObject = (arr) => {
    const out = {};
    for (const item of arr || []) {
      if (!item) continue;
      if (Array.isArray(item) && item.length >= 2) {
        const key = String(item[0] ?? '').trim();
        if (!key) continue;
        out[key] = item[1];
        continue;
      }
      if (typeof item === 'object') {
        const key = String(item.key ?? item.name ?? '').trim();
        if (!key) continue;
        out[key] = item.value;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  };

  if (typeof value === 'object' && !Array.isArray(value)) {
    if (
      value.snapshot &&
      typeof value.snapshot === 'object' &&
      !Array.isArray(value.snapshot)
    ) {
      return value.snapshot;
    }
    return value;
  }
  if (Array.isArray(value)) return arrayToObject(value);

  if (typeof value === 'string') {
    try {
      let parsed = JSON.parse(value);
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          // keep as-is
        }
      }
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed)) return arrayToObject(parsed);
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
};

/** Immutable order / PO snapshot fields — not merged from live catalog rows. */
export const ORDER_SNAPSHOT_META_KEYS = new Set([
  'parentAsin',
  'variantAsin',
  'variantKey',
  'brandModel',
  'variantAttributes',
  'snapshotAt',
  'productIdentification',
  'bcov',
  'gst',
  'identity',
  'catalogKey',
  'matchSignals',
  'asinLikeId',
  'variantAsinLikeId'
]);

const stripOrderSnapshotMetaKeys = (specs = {}) =>
  Object.fromEntries(
    Object.entries(specs).filter(([key]) => !ORDER_SNAPSHOT_META_KEYS.has(String(key || '').trim()))
  );

/**
 * Merge catalog + order snapshot specs for display without overwriting
 * frozen identity fields captured at order placement.
 */
export const mergeOrderItemSpecificationsForDisplay = (productSpecs, snapshot) => {
  const productParsed = parseSpecificationsObject(productSpecs) || {};
  const snapshotParsed = parseSpecificationsObject(snapshot) || {};
  const merged = mergeSpecificationMaps(
    stripOrderSnapshotMetaKeys(productParsed),
    stripOrderSnapshotMetaKeys(snapshotParsed)
  );
  for (const key of ORDER_SNAPSHOT_META_KEYS) {
    if (
      snapshotParsed[key] !== undefined &&
      snapshotParsed[key] !== null &&
      snapshotParsed[key] !== ''
    ) {
      merged[key] = snapshotParsed[key];
    }
  }
  return merged;
};

/** Merge spec maps; prefer meaningful values over empty placeholders. */
export const mergeSpecificationMaps = (...sources) => {
  const merged = {};
  for (const source of sources) {
    const parsed = parseSpecificationsObject(source);
    if (!parsed) continue;
    Object.entries(parsed).forEach(([key, value]) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return;
      const hasKey = Object.prototype.hasOwnProperty.call(merged, normalizedKey);
      const existingFilled = isMeaningfullyFilledSpecValue(merged[normalizedKey]);
      const incomingFilled = isMeaningfullyFilledSpecValue(value);
      if (!hasKey) {
        merged[normalizedKey] = value;
        return;
      }
      if (incomingFilled && !existingFilled) {
        merged[normalizedKey] = value;
      }
    });
  }
  return merged;
};

/** Normalize spec keys so "B P A Free", "bpa-free", and "Bpa free" dedupe together. */
export const normalizeSpecKeyForDedup = (key) =>
  String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Merge spec maps while collapsing keys that differ only by casing/spacing/punctuation. */
export const mergeSpecificationMapsByNormalizedKey = (...sources) => {
  const byNorm = new Map();

  for (const source of sources) {
    const parsed = parseSpecificationsObject(source);
    if (!parsed) continue;

    for (const [key, value] of Object.entries(parsed)) {
      const norm = normalizeSpecKeyForDedup(key);
      if (!norm) continue;

      const existing = byNorm.get(norm);
      if (!existing) {
        byNorm.set(norm, { key, value });
        continue;
      }

      const existingFilled = isMeaningfullyFilledSpecValue(existing.value);
      const incomingFilled = isMeaningfullyFilledSpecValue(value);
      if (incomingFilled || !existingFilled) {
        byNorm.set(norm, { key, value });
      }
    }
  }

  const merged = {};
  for (const { key, value } of byNorm.values()) {
    merged[key] = value;
  }
  return merged;
};

/** Prefer meaningful variant/offer values; fill remaining keys from shared catalog/admin specs. */
export const mergeCatalogAndOfferSpecificationsForDisplay = (catalogSpecs = {}, offerSpecs = {}) =>
  mergeSpecificationMapsByNormalizedKey(catalogSpecs, offerSpecs);

/**
 * Shared catalog rows may carry filled values from an older single-variant flow.
 * For variant-level offers, only template keys may contribute to merge — never filled values.
 */
export const catalogSpecificationTemplateForVariantMerge = (catalogSpecs = {}) =>
  specificationTemplateKeysOnly(parseSpecificationsObject(catalogSpecs) || {});

export const extractOfferSpecificationsFromRow = (row = {}) => {
  const attributesObj = parseSupplierOfferAttributes(row?.attributes);
  let specs = parseSpecificationsObject(
    attributesObj?.specifications ?? attributesObj?.specs ?? attributesObj?.specification
  );

  if (!specs && attributesObj && typeof attributesObj === 'object' && !Array.isArray(attributesObj)) {
    const direct = {};
    Object.keys(attributesObj || {}).forEach((key) => {
      if (OFFER_NON_SPEC_ATTRIBUTE_KEYS.has(key)) return;
      direct[key] = attributesObj[key];
    });
    if (Object.keys(direct).length > 0) specs = direct;
  }

  return specs || {};
};

/**
 * Specs for Add Product when the supplier picks a catalog row from the dropdown.
 * Source of truth = that product's catalog specs; same-product approved offers only
 * fill empty keys on that product (never import another product / category example values).
 */
export function mergeSelectedCatalogProductSpecifications(
  catalogSpecs = {},
  sameProductOfferRows = []
) {
  let merged = parseSpecificationsObject(catalogSpecs) || {};
  const catalogHasMeaningfulValues = countMeaningfulSpecValues(merged) > 0;
  const catalogKeyNorms = new Set(
    Object.keys(merged)
      .map((key) => normalizeSpecKeyForDedup(key))
      .filter(Boolean)
  );

  const rankedOffers = [...(sameProductOfferRows || [])].sort((a, b) => {
    const aTime = Date.parse(String(a?.updated_at || '')) || 0;
    const bTime = Date.parse(String(b?.updated_at || '')) || 0;
    return bTime - aTime;
  });

  for (const row of rankedOffers) {
    const status = String(row?.status || '').trim().toLowerCase();
    if (status && status !== 'approved') continue;
    const offerSpecs = extractOfferSpecificationsFromRow(row);
    if (!offerSpecs || Object.keys(offerSpecs).length === 0) continue;

    if (catalogHasMeaningfulValues) {
      // Keep this product's identity: only fill blanks for keys the catalog already has.
      const fillOnly = {};
      Object.entries(offerSpecs).forEach(([key, value]) => {
        const norm = normalizeSpecKeyForDedup(key);
        if (norm && catalogKeyNorms.has(norm)) fillOnly[key] = value;
      });
      merged = mergeSpecificationMaps(merged, fillOnly);
    } else {
      merged = mergeSpecificationMaps(merged, offerSpecs);
    }
  }

  return merged;
}

/**
 * Load specifications for one catalog product id (dropdown selection / lookup by id).
 */
export async function resolveSelectedCatalogProductSpecifications(supabase, productId) {
  const id = String(productId || '').trim();
  if (!id || !supabase) return {};

  const { data: product, error } = await supabase
    .from('products')
    .select('id, specifications')
    .eq('id', id)
    .maybeSingle();
  if (error || !product) return {};

  const { data: offerRows } = await supabase
    .from('supplier_products')
    .select('attributes, updated_at, status')
    .eq('product_id', id)
    .eq('status', 'approved')
    .order('updated_at', { ascending: false })
    .limit(50);

  return mergeSelectedCatalogProductSpecifications(product.specifications, offerRows || []);
}

/**
 * Build the specification baseline for comparing a supplier listing against catalog truth.
 * Starts with the catalog's filled values so first re-lists of admin-filled products
 * still detect divergent specs. Overlay the same variant's approved offer when present
 * (never other variants' offer rows).
 */
export async function resolveCatalogBaselineSpecifications(
  supabase,
  {
    productId = null,
    catalogSpecs = {},
    variantKey = null,
    variantAsin = null,
    supplierProductId = null
  } = {}
) {
  // Keep meaningfully filled catalog values for create-time change detection.
  // Display-time merges still blank via catalogSpecificationTemplateForVariantMerge.
  let merged = parseSpecificationsObject(catalogSpecs) || {};

  if (!productId || !supabase) return merged;

  const scopedSupplierProductId = String(supplierProductId || '').trim();
  const scopedVariantKey = String(variantKey || '').trim();
  const scopedVariantAsin = String(variantAsin || '').trim();
  const hasVariantScope = Boolean(scopedSupplierProductId || scopedVariantKey || scopedVariantAsin);
  if (!hasVariantScope) return merged;

  const { data: offerRows } = await supabase
    .from('supplier_products')
    .select('id, attributes, updated_at, status, variant_key, variant_asin')
    .eq('product_id', productId)
    .eq('status', 'approved')
    .order('updated_at', { ascending: false })
    .limit(200);

  for (const row of offerRows || []) {
    const matchesId = scopedSupplierProductId && String(row.id) === scopedSupplierProductId;
    const matchesAsin = scopedVariantAsin && String(row.variant_asin || '').trim() === scopedVariantAsin;
    const matchesKey = scopedVariantKey && String(row.variant_key || '').trim() === scopedVariantKey;
    if (!matchesId && !matchesAsin && !matchesKey) continue;

    // Same-variant offer is authoritative — replace catalog defaults for that variant.
    merged = mergeSpecificationMapsByNormalizedKey(
      catalogSpecificationTemplateForVariantMerge(catalogSpecs),
      extractOfferSpecificationsFromRow(row)
    );
    break;
  }

  return merged;
}

const OFFER_NON_SPEC_ATTRIBUTE_KEYS = new Set([
  'description',
  'name',
  'images',
  'brandModel',
  'lsa',
  'hsnCode',
  'hsn_code',
  'specifications',
  'specs',
  'specification',
  'listingName',
  'supplierDescription',
  'category',
  'Category',
  'variantAttributes',
  'unit',
  'tags',
  'igstRate',
  'cgstRate',
  'sgstRate',
  'packSize',
  'sku'
]);

export const parseCanonicalAttributes = (raw) => {
  if (!raw) return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
};

/** Parse supplier_products.attributes whether stored as JSONB or a legacy JSON string. */
export const parseSupplierOfferAttributes = (raw) => parseCanonicalAttributes(raw);

export const buildVariantMetaByKey = (variantRows = []) => {
  const variantMetaByKey = new Map();
  for (const row of variantRows || []) {
    const variantKey = String(row?.variant_key || '').trim();
    const variantAsin = String(row?.variant_asin || '').trim();
    if (variantKey) variantMetaByKey.set(variantKey, row);
    if (variantAsin) variantMetaByKey.set(`asin:${variantAsin}`, row);
  }
  return variantMetaByKey;
};

/** Prefer the catalog product linked to product_variants for this offer row. */
export const resolveOfferCatalogProductId = (offerRow = {}, variantMetaByKey = new Map()) => {
  const fallbackProductId = String(offerRow?.product_id || '').trim();
  const variantAsin = String(offerRow?.variant_asin || '').trim();
  const variantKey = String(offerRow?.variant_key || '').trim();
  if (variantAsin && variantMetaByKey.has(`asin:${variantAsin}`)) {
    return String(variantMetaByKey.get(`asin:${variantAsin}`)?.product_id || fallbackProductId);
  }
  if (variantKey && variantMetaByKey.has(variantKey)) {
    return String(variantMetaByKey.get(variantKey)?.product_id || fallbackProductId);
  }
  return fallbackProductId;
};

/**
 * Merge shared catalog template keys with a supplier offer for buyer-facing display.
 * Each variant offer owns its values; filled catalog defaults must not bleed across variants.
 */
export const mergeOfferSpecifications = (productSpecs, offer, variantMeta = null) => {
  const base = catalogSpecificationTemplateForVariantMerge(productSpecs);
  const attrs = parseSupplierOfferAttributes(offer?.attributes);
  const fromAttrs =
    parseSpecificationsObject(attrs.specifications) ||
    parseSpecificationsObject(attrs.specs) ||
    parseSpecificationsObject(attrs.specification) ||
    {};
  const variantAttributeMap = parseCanonicalAttributes(attrs.variantAttributes);
  const variantCanonicalMap = parseCanonicalAttributes(variantMeta?.canonical_attributes);
  const direct = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (OFFER_NON_SPEC_ATTRIBUTE_KEYS.has(key)) continue;
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      direct[key] = value;
    }
  }
  const offerSpecs = mergeSpecificationMapsByNormalizedKey(
    variantCanonicalMap,
    variantAttributeMap,
    direct,
    fromAttrs
  );
  return mergeCatalogAndOfferSpecificationsForDisplay(base, offerSpecs);
};

/** Canonical buyer/supplier display merge — use this instead of ad-hoc catalog+offer spreads. */
export const resolveSupplierOfferDisplaySpecifications = (
  catalogSpecifications,
  offerAttributes,
  variantMeta = null
) => mergeOfferSpecifications(catalogSpecifications, { attributes: offerAttributes }, variantMeta);

/** Union template field keys with variant specs; variant values win (including empty). */
export const mergeVariantSpecificationTemplate = (templateSpecs = {}, variantSpecs = {}) => {
  const template = parseSpecificationsObject(templateSpecs) || {};
  const variant = parseSpecificationsObject(variantSpecs) || {};
  const merged = {};

  Object.keys(template).forEach((key) => {
    merged[key] = Object.prototype.hasOwnProperty.call(variant, key) ? variant[key] : '';
  });

  Object.keys(variant).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(merged, key)) {
      merged[key] = variant[key];
    }
  });

  return merged;
};

/**
 * Admin catalog save: push admin-edited specification values onto the supplier offer.
 * - Filled admin values overwrite the offer (so suppliers see the change).
 * - Empty admin values keep existing offer values (template keys must not wipe supplier data).
 * - New admin-only keys are added as empty placeholders when not yet on the offer.
 */
export const mergeAdminEditedSpecificationsOntoOffer = (adminSpecs = {}, offerSpecs = {}) => {
  const admin = parseSpecificationsObject(adminSpecs) || {};
  const offer = parseSpecificationsObject(offerSpecs) || {};
  const merged = { ...offer };

  Object.keys(admin).forEach((key) => {
    const adminValue = admin[key];
    if (isMeaningfullyFilledSpecValue(adminValue)) {
      merged[key] = adminValue;
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(merged, key)) {
      merged[key] = adminValue == null ? '' : adminValue;
    }
  });

  return merged;
};

export const buildSpecificationTemplateFromFields = (fields = []) => {
  const template = {};
  for (const field of fields) {
    const key = String(field?.field_key || field?.key || '').trim();
    if (!key) continue;
    template[key] = null;
  }
  return template;
};

/** Keep specification keys from a map but clear all values (for supplier data entry). */
export const specificationTemplateKeysOnly = (specs = {}) => {
  const parsed = parseSpecificationsObject(specs) || {};
  const result = {};
  Object.keys(parsed).forEach((key) => {
    const normalizedKey = String(key || '').trim();
    if (normalizedKey) result[normalizedKey] = '';
  });
  return result;
};

export const normalizeBcovBrand = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const toFiniteNumber = (value) => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

export const parseBcovNotes = (rawNotes) => {
  const raw = String(rawNotes || '').trim();
  if (!raw) return { levelName: null, buyerBcov: null, supplierProductId: null, rawNotes: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        levelName: String(parsed.levelName || '').trim() || null,
        buyerBcov: String(parsed.buyerBcov || '').trim() || null,
        supplierProductId: String(parsed.supplierProductId || '').trim() || null,
        rawNotes: raw
      };
    }
  } catch (_) {
    // legacy non-JSON notes
  }
  return { levelName: null, buyerBcov: raw, supplierProductId: null, rawNotes: raw };
};

export const composeBcovNotes = ({ levelName, buyerBcov, supplierProductId = null }) => {
  const payload = {
    levelName: String(levelName || '').trim() || null,
    buyerBcov: String(buyerBcov || '').trim() || null
  };
  const offerId = String(supplierProductId || '').trim();
  if (offerId) payload.supplierProductId = offerId;
  if (!payload.levelName && !payload.buyerBcov && !payload.supplierProductId) return null;
  return JSON.stringify(payload);
};
