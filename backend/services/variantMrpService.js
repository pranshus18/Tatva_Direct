/** Canonical MRP per catalog product + variant — shared by all suppliers. */

import { extractOfferSpecificationsFromRow } from './supplierCatalogHelpersService.js';
import { specsRepresentSameCatalogVariant } from '../utils/supplierProductApproval.js';

export function roundVariantMrp(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

function offerSortScore(row = {}) {
  const status = String(row.status || '').trim().toLowerCase();
  if (status === 'approved' && row.is_active === true) return 0;
  if (status === 'approved') return 1;
  return 2;
}

function pickCanonicalFromOffers(offers = []) {
  const priced = (offers || [])
    .map((row) => ({
      row,
      price: roundVariantMrp(row?.price)
    }))
    .filter((entry) => entry.price !== null && entry.price > 0);

  if (!priced.length) return null;

  priced.sort((a, b) => {
    const scoreDiff = offerSortScore(a.row) - offerSortScore(b.row);
    if (scoreDiff !== 0) return scoreDiff;
    const aTime = new Date(a.row.updated_at || a.row.created_at || 0).getTime();
    const bTime = new Date(b.row.updated_at || b.row.created_at || 0).getTime();
    return aTime - bTime;
  });

  return priced[0].price;
}

function uniquePositivePrices(offers = []) {
  const seen = new Set();
  for (const row of offers || []) {
    const price = roundVariantMrp(row?.price);
    if (price !== null && price > 0) seen.add(price);
  }
  return [...seen];
}

/**
 * Pick the locked MRP for a catalog attach.
 * Exact variant_key wins; otherwise reuse MRP from offers that are the same
 * catalog variant (including empty offer specs that inherit the catalog).
 */
export function pickCanonicalVariantMrpFromOffers(
  offers = [],
  { variantKey = '', specifications = null, catalogSpecs = null } = {}
) {
  const rows = (offers || []).filter((row) => {
    const price = roundVariantMrp(row?.price);
    return price !== null && price > 0;
  });
  if (!rows.length) return null;

  const vk = String(variantKey || '').trim();
  if (vk) {
    const exact = pickCanonicalFromOffers(
      rows.filter((row) => String(row.variant_key || '').trim() === vk)
    );
    if (exact !== null) return exact;
  }

  const submitted =
    specifications && typeof specifications === 'object' && !Array.isArray(specifications)
      ? specifications
      : {};
  const catalog =
    catalogSpecs && typeof catalogSpecs === 'object' && !Array.isArray(catalogSpecs)
      ? catalogSpecs
      : {};
  const matchingSameVariant = rows.filter((row) => {
    if (vk && String(row.variant_key || '').trim() === vk) return true;
    const offerSpecs = extractOfferSpecificationsFromRow(row);
    return specsRepresentSameCatalogVariant(submitted, offerSpecs, catalog);
  });
  if (matchingSameVariant.length) {
    const matched = pickCanonicalFromOffers(matchingSameVariant);
    if (matched !== null) return matched;
  }

  const prices = uniquePositivePrices(rows);
  if (prices.length === 1) return prices[0];

  const keys = [
    ...new Set(rows.map((row) => String(row.variant_key || '').trim()).filter(Boolean))
  ];
  if (keys.length === 1) return pickCanonicalFromOffers(rows);

  return null;
}

/**
 * Return the locked MRP for a catalog variant, if any supplier has set one.
 * When variant_key is missing or new, still reuse MRP from the same catalog variant.
 */
export async function fetchCanonicalVariantMrp(
  supabase,
  { productId, variantKey, excludeOfferId = null, specifications = null, catalogSpecs = null } = {}
) {
  const pid = String(productId || '').trim();
  if (!supabase || !pid) return null;

  let query = supabase
    .from('supplier_products')
    .select('id, price, status, is_active, updated_at, created_at, variant_key, attributes')
    .eq('product_id', pid)
    .neq('status', 'rejected')
    .not('price', 'is', null)
    .gt('price', 0);

  if (excludeOfferId) {
    query = query.neq('id', excludeOfferId);
  }

  let { data, error } = await query;
  if (error) {
    let fallback = supabase
      .from('supplier_products')
      .select('id, price, status, is_active, updated_at, created_at, variant_key')
      .eq('product_id', pid)
      .neq('status', 'rejected')
      .not('price', 'is', null)
      .gt('price', 0);
    if (excludeOfferId) fallback = fallback.neq('id', excludeOfferId);
    const retried = await fallback;
    data = retried.data;
    error = retried.error;
  }
  if (error) {
    console.error('[variantMrp] fetchCanonicalVariantMrp error:', error);
    return null;
  }

  return pickCanonicalVariantMrpFromOffers(data || [], {
    variantKey,
    specifications,
    catalogSpecs
  });
}

export function buildVariantMrpMapKey(productId, variantKey) {
  return `${String(productId || '').trim()}::${String(variantKey || '').trim()}`;
}

/**
 * Batch-resolve canonical MRP for many product+variant pairs (supplier product list).
 */
export async function fetchCanonicalMrpMapForVariants(supabase, pairs = []) {
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
    .select('product_id, variant_key, price, status, is_active, updated_at, created_at, attributes')
    .in('product_id', [...productIds])
    .neq('status', 'rejected')
    .not('price', 'is', null)
    .gt('price', 0);

  if (error) {
    console.error('[variantMrp] fetchCanonicalMrpMapForVariants error:', error);
    return map;
  }

  const { data: catalogRows, error: catalogError } = await supabase
    .from('products')
    .select('id, specifications')
    .in('id', [...productIds]);
  if (catalogError) {
    console.warn('[variantMrp] catalog specs for MRP map failed:', catalogError);
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
    const canonical = pickCanonicalVariantMrpFromOffers(groupedByProduct.get(productId) || [], {
      variantKey,
      catalogSpecs: catalogById.get(productId) || {}
    });
    if (canonical !== null) map.set(key, canonical);
  }

  return map;
}

export const VARIANT_MRP_MISMATCH_MESSAGE =
  'MRP for this variant is fixed. All suppliers must use the same MRP. Contact admin to change it.';

export function formatVariantMrpMismatchMessage(canonicalMrp) {
  const amount = roundVariantMrp(canonicalMrp);
  if (amount === null) return VARIANT_MRP_MISMATCH_MESSAGE;
  return `MRP for this variant is fixed at ₹${amount.toFixed(2)}. All suppliers must use the same MRP. Contact admin to change it.`;
}

/** Block supplier attempts to set a different MRP when a canonical value already exists. */
export function validateSupplierVariantMrpConsistency({
  body = {},
  canonicalMrp = null
} = {}) {
  if (body?.price === undefined) {
    return { ok: true, message: '', code: null, canonicalMrp: null };
  }

  const nextPrice = roundVariantMrp(body.price);
  if (nextPrice === null) {
    return { ok: true, message: '', code: null, canonicalMrp: null };
  }

  const canonical = roundVariantMrp(canonicalMrp);
  if (canonical === null) {
    return { ok: true, message: '', code: null, canonicalMrp: null };
  }

  if (nextPrice !== canonical) {
    return {
      ok: false,
      message: formatVariantMrpMismatchMessage(canonical),
      code: 'variant_mrp_mismatch',
      missingFields: ['price'],
      canonicalMrp: canonical
    };
  }

  return { ok: true, message: '', code: null, canonicalMrp: canonical };
}

/** Admin-only: apply the same MRP to every non-rejected offer for this variant. */
export async function propagateVariantMrpToAllOffers(
  supabase,
  { productId, variantKey, mrp } = {}
) {
  const pid = String(productId || '').trim();
  const vk = String(variantKey || '').trim();
  const price = roundVariantMrp(mrp);
  if (!supabase || !pid || !vk || price === null) {
    return { updated: 0, price: null };
  }

  const { data, error } = await supabase
    .from('supplier_products')
    .update({
      price,
      updated_at: new Date().toISOString()
    })
    .eq('product_id', pid)
    .eq('variant_key', vk)
    .neq('status', 'rejected')
    .select('id');

  if (error) {
    console.error('[variantMrp] propagateVariantMrpToAllOffers error:', error);
    throw error;
  }

  return { updated: (data || []).length, price };
}
