/** Canonical HSN + GST per catalog product — reused when attaching an existing listing. */

import { extractOfferSpecificationsFromRow } from './supplierCatalogHelpersService.js';
import { specsRepresentSameCatalogVariant } from '../utils/supplierProductApproval.js';
import { validateAndNormalizeTaxRates } from '../controllers/supplier/shared/productHelpers.js';
import { buildVariantMrpMapKey } from './variantMrpService.js';

export function emptyCanonicalHsnGst() {
  return { hsnCode: null, igstRate: null, cgstRate: null, sgstRate: null };
}

export function normalizeHsnCode(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits || null;
}

function extractHsnFromOffer(row = {}) {
  const attrs =
    row?.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes)
      ? row.attributes
      : {};
  const specs =
    attrs.specifications && typeof attrs.specifications === 'object' && !Array.isArray(attrs.specifications)
      ? attrs.specifications
      : {};
  return normalizeHsnCode(
    row.hsnCode ||
      row.hsn_code ||
      attrs.hsnCode ||
      attrs.hsn_code ||
      specs.hsnCode ||
      specs.hsn_code
  );
}

function extractGstFromOffer(row = {}) {
  const attrs =
    row?.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes)
      ? row.attributes
      : {};
  const taxValidation = validateAndNormalizeTaxRates({
    igst_rate: row.igst_rate ?? row.igstRate ?? attrs.igstRate ?? attrs.igst_rate,
    cgst_rate: row.cgst_rate ?? row.cgstRate ?? attrs.cgstRate ?? attrs.cgst_rate,
    sgst_rate: row.sgst_rate ?? row.sgstRate ?? attrs.sgstRate ?? attrs.sgst_rate
  });
  if (!taxValidation.ok || taxValidation.data.igstRate === null) return null;
  return taxValidation.data;
}

function offerSortScore(row = {}) {
  const status = String(row.status || '').trim().toLowerCase();
  if (status === 'approved' && row.is_active === true) return 0;
  if (status === 'approved') return 1;
  return 2;
}

function sortOffers(rows = []) {
  return [...rows].sort((a, b) => {
    const scoreDiff = offerSortScore(a) - offerSortScore(b);
    if (scoreDiff !== 0) return scoreDiff;
    const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
    const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
    return aTime - bTime;
  });
}

function uniqueValues(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function gstKey(gst) {
  if (!gst || gst.igstRate == null) return '';
  return `${gst.igstRate}|${gst.cgstRate}|${gst.sgstRate}`;
}

function filterSameCatalogVariant(
  rows = [],
  { variantKey = '', specifications = null, catalogSpecs = null } = {}
) {
  const vk = String(variantKey || '').trim();
  const submitted =
    specifications && typeof specifications === 'object' && !Array.isArray(specifications)
      ? specifications
      : {};
  const catalog =
    catalogSpecs && typeof catalogSpecs === 'object' && !Array.isArray(catalogSpecs)
      ? catalogSpecs
      : {};
  return rows.filter((row) => {
    if (vk && String(row.variant_key || '').trim() === vk) return true;
    const offerSpecs = extractOfferSpecificationsFromRow(row);
    return specsRepresentSameCatalogVariant(submitted, offerSpecs, catalog);
  });
}

function pickHsnFromRows(rows = []) {
  const withHsn = sortOffers(rows.filter((row) => extractHsnFromOffer(row)));
  if (!withHsn.length) return null;
  const unique = uniqueValues(withHsn.map((row) => extractHsnFromOffer(row)));
  if (unique.length === 1) return unique[0];
  return extractHsnFromOffer(withHsn[0]);
}

function pickGstFromRows(rows = []) {
  const withGst = sortOffers(rows.filter((row) => extractGstFromOffer(row)));
  if (!withGst.length) return null;
  const unique = uniqueValues(withGst.map((row) => gstKey(extractGstFromOffer(row))));
  if (unique.length === 1) return extractGstFromOffer(withGst[0]);
  return extractGstFromOffer(withGst[0]);
}

/**
 * Pick HSN + GST already stored on offers for this catalog product.
 * Exact variant_key wins; otherwise same-catalog-variant specs; otherwise the
 * unique filled values on the product. Never falls back to another category.
 */
export function pickCanonicalHsnAndGstFromOffers(
  offers = [],
  { variantKey = '', specifications = null, catalogSpecs = null } = {}
) {
  const rows = (offers || []).filter((row) => {
    const status = String(row?.status || '').trim().toLowerCase();
    return status !== 'rejected';
  });
  const result = emptyCanonicalHsnGst();
  if (!rows.length) return result;

  const vk = String(variantKey || '').trim();
  const exact = vk
    ? rows.filter((row) => String(row.variant_key || '').trim() === vk)
    : [];
  const sameVariant = filterSameCatalogVariant(rows, {
    variantKey,
    specifications,
    catalogSpecs
  });

  const uniqueProductHsn = uniqueValues(rows.map((row) => extractHsnFromOffer(row)));
  const uniqueProductGst = uniqueValues(
    rows.map((row) => gstKey(extractGstFromOffer(row))).filter(Boolean)
  );
  const productWideHsn = uniqueProductHsn.length === 1 ? uniqueProductHsn[0] : null;
  const productWideGst =
    uniqueProductGst.length === 1
      ? extractGstFromOffer(
          rows.find((row) => gstKey(extractGstFromOffer(row)) === uniqueProductGst[0])
        )
      : null;

  const hsn = pickHsnFromRows(exact) || pickHsnFromRows(sameVariant) || productWideHsn;
  const gst = pickGstFromRows(exact) || pickGstFromRows(sameVariant) || productWideGst;

  if (hsn) result.hsnCode = hsn;
  if (gst) {
    result.igstRate = gst.igstRate;
    result.cgstRate = gst.cgstRate;
    result.sgstRate = gst.sgstRate;
  }
  return result;
}

export function canonicalHsnGstHasValues(value = emptyCanonicalHsnGst()) {
  return Boolean(value?.hsnCode) || value?.igstRate != null;
}

/**
 * Return HSN + GST already filled by a supplier on this catalog product.
 */
export async function fetchCanonicalHsnAndGst(
  supabase,
  { productId, variantKey, excludeOfferId = null, specifications = null, catalogSpecs = null } = {}
) {
  const pid = String(productId || '').trim();
  if (!supabase || !pid) return emptyCanonicalHsnGst();

  let query = supabase
    .from('supplier_products')
    .select(
      'id, status, is_active, updated_at, created_at, variant_key, igst_rate, cgst_rate, sgst_rate, attributes'
    )
    .eq('product_id', pid)
    .neq('status', 'rejected');

  if (excludeOfferId) {
    query = query.neq('id', excludeOfferId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[catalogHsnGst] fetchCanonicalHsnAndGst error:', error);
    return emptyCanonicalHsnGst();
  }

  return pickCanonicalHsnAndGstFromOffers(data || [], {
    variantKey,
    specifications,
    catalogSpecs
  });
}

/**
 * Batch-resolve canonical HSN/GST for many product+variant pairs (supplier product list).
 */
export async function fetchCanonicalHsnGstMapForVariants(supabase, pairs = []) {
  const map = new Map();
  if (!supabase) return map;

  const wanted = new Set();
  const productIds = new Set();
  for (const pair of pairs || []) {
    const productId = String(pair?.productId || '').trim();
    const variantKey = String(pair?.variantKey || '').trim();
    if (!productId || !variantKey) continue;
    wanted.add(buildVariantMrpMapKey(productId, variantKey));
    productIds.add(productId);
  }

  if (!productIds.size) return map;

  const { data, error } = await supabase
    .from('supplier_products')
    .select(
      'product_id, variant_key, status, is_active, updated_at, created_at, igst_rate, cgst_rate, sgst_rate, attributes'
    )
    .in('product_id', [...productIds])
    .neq('status', 'rejected');

  if (error) {
    console.error('[catalogHsnGst] fetchCanonicalHsnGstMapForVariants error:', error);
    return map;
  }

  const { data: catalogRows, error: catalogError } = await supabase
    .from('products')
    .select('id, specifications')
    .in('id', [...productIds]);
  if (catalogError) {
    console.warn('[catalogHsnGst] catalog specs for HSN/GST map failed:', catalogError);
  }
  const catalogById = new Map(
    (catalogRows || []).map((row) => [String(row.id || '').trim(), row.specifications || {}])
  );

  const groupedByProduct = new Map();
  for (const row of data || []) {
    const pid = String(row.product_id || '').trim();
    if (!pid) continue;
    if (!groupedByProduct.has(pid)) groupedByProduct.set(pid, []);
    groupedByProduct.get(pid).push(row);
  }

  for (const pair of pairs || []) {
    const productId = String(pair?.productId || '').trim();
    const variantKey = String(pair?.variantKey || '').trim();
    if (!productId || !variantKey) continue;
    const key = buildVariantMrpMapKey(productId, variantKey);
    if (!wanted.has(key) || map.has(key)) continue;
    const canonical = pickCanonicalHsnAndGstFromOffers(groupedByProduct.get(productId) || [], {
      variantKey,
      catalogSpecs: catalogById.get(productId) || {}
    });
    if (canonicalHsnGstHasValues(canonical)) map.set(key, canonical);
  }

  return map;
}
