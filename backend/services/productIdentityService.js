import crypto from 'crypto';

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

function toShortAlphaNum(seed, length = 2) {
  const hashHex = stableHash(seed);
  const chunk = hashHex.slice(0, 12); // enough entropy for short codes
  const num = parseInt(chunk, 16);
  const base36 = Number.isFinite(num) ? num.toString(36).toUpperCase() : '0';
  return base36.padStart(length, '0').slice(0, length);
}

/**
 * TSIN deterministic ID format:
 * TS + 2 alphanumeric characters (e.g. TSA7).
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
  return `TS${toShortAlphaNum(seed, 2)}`;
}

/**
 * Variant TSIN deterministic ID format:
 * TS + productCode(2) + variantCode(2) (e.g. TSA7K3).
 * Same parent TSIN + same variant key => same variant TSIN.
 */
export function buildVariantAsinLikeId(parentAsin, variantKey) {
  const normalizedParent = normalizeIdentifierField(parentAsin).toUpperCase();
  const productCode = normalizedParent.startsWith('TS') && normalizedParent.length >= 4
    ? normalizedParent.slice(2, 4)
    : toShortAlphaNum(normalizedParent || 'TS', 2);
  const seed = `${normalizedParent}|${normalizeIdentifierField(variantKey)}`;
  const variantCode = toShortAlphaNum(seed, 2);
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

export default {
  normalizeTextField,
  normalizeIdentifierField,
  normalizeUnitField,
  normalizeCatalogIdentity,
  normalizeVariantIdentity,
  normalizeVariantAttributes,
  buildAsinLikeId,
  buildVariantAsinLikeId,
  buildCatalogKey,
  buildVariantKey,
  buildIdentityBundle
};
