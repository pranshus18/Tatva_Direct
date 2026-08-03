import { buildVariantAsinLikeId } from '../../../services/productIdentityService.js';
import { parseSupplierStockQuantity } from '../../../utils/parseSupplierStockQuantity.js';

const IGST_ALLOWED_RATES = new Set([0, 5, 12, 18, 28]);
const CGST_SGST_ALLOWED_RATES = new Set([0, 2.5, 6, 9, 14]);
export const ORDER_INSERT_MAX_RETRIES = 3;

/** Parent TSIN exactly as stored on products.asin (supplier catalog row). */
export function resolveParentTsin(parentAsin) {
  const stored = String(parentAsin || '').trim().toUpperCase();
  return stored || null;
}

export function sanitizeImageUrls(input) {
  if (!input) return [];

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        return sanitizeImageUrls(JSON.parse(trimmed));
      } catch {
        return /^https?:\/\//i.test(trimmed) ? [trimmed] : [];
      }
    }
    return /^https?:\/\//i.test(trimmed) ? [trimmed] : [];
  }

  if (!Array.isArray(input)) return [];

  const seen = new Set();
  const out = [];
  for (const raw of input) {
    const url = String(raw || '').trim();
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out.slice(0, 12);
}

/**
 * Variant TSIN for a supplier offer: always prefer supplier_products.variant_asin when set.
 * Only derive from parent + variant_key when the column is blank (legacy rows).
 */
export function resolveVariantTsin(parentAsin, variantKey, currentVariantAsin) {
  const stored = String(currentVariantAsin || '').trim().toUpperCase();
  if (stored) return stored;
  return buildVariantAsinLikeId(parentAsin || '', variantKey || '');
}

/** TSIN fields for API responses — matches supplier inventory listing. */
export function supplierOfferTsinFields(parentProduct, supplierProduct) {
  const asin = resolveParentTsin(parentProduct?.asin);
  return {
    asin,
    variantAsin: resolveVariantTsin(asin, supplierProduct?.variant_key, supplierProduct?.variant_asin),
    variantKey: supplierProduct?.variant_key || null
  };
}

export function normalizeUserAddress(address = {}) {
  if (!address || typeof address !== 'object') return null;
  const line1 = String(address.line1 || address.street || '').trim();
  const line2 = String(address.line2 || address.area || '').trim();
  const city = String(address.city || '').trim();
  const state = String(address.state || '').trim();
  const zipCode = String(address.zipCode || address.pincode || address.postalCode || '').trim();
  const country = String(address.country || '').trim();

  return {
    ...address,
    street: line1,
    line1,
    line2,
    city,
    state,
    zipCode,
    pincode: zipCode,
    country
  };
}

function parseTaxRate(rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return NaN;
  return Number(parsed.toFixed(2));
}

export function validateAndNormalizeTaxRates(input = {}) {
  const igstRate = parseTaxRate(input.igst_rate ?? input.igstRate);
  const cgstRate = parseTaxRate(input.cgst_rate ?? input.cgstRate);
  const sgstRate = parseTaxRate(input.sgst_rate ?? input.sgstRate);

  const anyProvided = [igstRate, cgstRate, sgstRate].some((v) => v !== null);
  if (!anyProvided) {
    return { ok: true, data: { igstRate: null, cgstRate: null, sgstRate: null } };
  }

  if ([igstRate, cgstRate, sgstRate].some((v) => Number.isNaN(v))) {
    return {
      ok: false,
      message: 'Invalid tax rate value. Select values from the provided dropdown options only.'
    };
  }

  if (igstRate === null || cgstRate === null || sgstRate === null) {
    return { ok: false, message: 'IGST, CGST, and SGST are all required together.' };
  }

  if (!IGST_ALLOWED_RATES.has(igstRate)) {
    return { ok: false, message: 'Invalid IGST rate. Allowed values are 0, 5, 12, 18, and 28.' };
  }
  if (!CGST_SGST_ALLOWED_RATES.has(cgstRate) || !CGST_SGST_ALLOWED_RATES.has(sgstRate)) {
    return {
      ok: false,
      message: 'Invalid CGST/SGST rate. Allowed values are 0, 2.5, 6, 9, and 14.'
    };
  }
  if (cgstRate !== sgstRate) {
    return { ok: false, message: 'CGST and SGST must be the same percentage.' };
  }
  if (Number((cgstRate + sgstRate).toFixed(2)) !== igstRate) {
    return { ok: false, message: 'IGST must equal CGST + SGST.' };
  }

  return { ok: true, data: { igstRate, cgstRate, sgstRate } };
}

export function createTaxRateHelpers(supabase) {
  async function fetchLatestTaxRatesForProduct(productId) {
    if (!productId) return null;
    const { data } = await supabase
      .from('supplier_products')
      .select('igst_rate, cgst_rate, sgst_rate, updated_at')
      .eq('product_id', productId)
      .not('igst_rate', 'is', null)
      .not('cgst_rate', 'is', null)
      .not('sgst_rate', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return {
      igstRate: Number(data.igst_rate),
      cgstRate: Number(data.cgst_rate),
      sgstRate: Number(data.sgst_rate)
    };
  }

  async function fetchLatestTaxRatesForCategory(categoryName) {
    const normalizedCategory = String(categoryName || '').trim().toLowerCase();
    if (!normalizedCategory) return null;

    const { data: products } = await supabase
      .from('products')
      .select('id')
      .eq('category', normalizedCategory)
      .limit(100);
    const productIds = (products || []).map((p) => p.id).filter(Boolean);
    if (!productIds.length) return null;

    const { data } = await supabase
      .from('supplier_products')
      .select('igst_rate, cgst_rate, sgst_rate, updated_at')
      .in('product_id', productIds)
      .not('igst_rate', 'is', null)
      .not('cgst_rate', 'is', null)
      .not('sgst_rate', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    return {
      igstRate: Number(data.igst_rate),
      cgstRate: Number(data.cgst_rate),
      sgstRate: Number(data.sgst_rate)
    };
  }

  async function resolveTaxRatesForProductCreate({
    input = {},
    preferredProductId = null,
    categoryName = ''
  } = {}) {
    const explicitValidation = validateAndNormalizeTaxRates(input);
    if (!explicitValidation.ok) return explicitValidation;

    if (explicitValidation.data.igstRate !== null) {
      return explicitValidation;
    }

    const byProduct = await fetchLatestTaxRatesForProduct(preferredProductId);
    if (byProduct) return { ok: true, data: byProduct };

    const byCategory = await fetchLatestTaxRatesForCategory(categoryName);
    if (byCategory) return { ok: true, data: byCategory };

    return explicitValidation;
  }

  return { resolveTaxRatesForProductCreate };
}

export function isOrderNumberConflictError(error) {
  if (!error) return false;
  if (error.code === '23505') {
    const details = String(error.details || '').toLowerCase();
    const message = String(error.message || '').toLowerCase();
    return details.includes('order_number') || message.includes('order_number');
  }
  return false;
}

export { isRevenueRecognizedOrder } from '../../../utils/salesMetrics.js';

/**
 * Catalog approval alone must not re-label a brand-new pending offer as approved —
 * admin moderation writes approved onto junction rows when the product goes live.
 * Rejected catalog or offer status always wins so suppliers keep a clear approval outcome.
 */
export function resolveEffectiveSupplierOfferState(row, catalogProduct = null) {
  const product = catalogProduct ?? row?.product ?? null;
  const rawStatus = String(row?.status ?? '').trim().toLowerCase();
  const catalogStatus = String(product?.status ?? '').trim().toLowerCase();
  const rejected = rawStatus === 'rejected' || catalogStatus === 'rejected';

  let effectiveStatus = row?.status ?? 'pending';
  let effectiveActive = row?.is_active === true;

  if (rawStatus === 'approved' || rawStatus === 'active') {
    effectiveStatus = 'approved';
    // Approved status means the offer is live even if is_active lagged behind.
    effectiveActive = true;
  } else if (rawStatus === 'pending' || !rawStatus) {
    effectiveStatus = 'pending';
    // Explicit is_active on a pending row does not mean admin approved the listing.
    effectiveActive = false;
  }

  if (rejected) {
    effectiveStatus = 'rejected';
    effectiveActive = false;
  }

  const stock = parseSupplierStockQuantity(row?.stock) ?? 0;
  const availableForUpstream = !rejected && effectiveActive && stock > 0;
  // Heal only when an approved offer row lost its active flag (never when still pending).
  const needsCatalogSync =
    !rejected && effectiveStatus === 'approved' && row?.is_active !== true;

  return {
    rawStatus: row?.status ?? null,
    rawIsActive: row?.is_active === true,
    effectiveStatus,
    effectiveActive,
    availableForUpstream,
    needsCatalogSync
  };
}

export function isSupplierOfferAvailableForUpstream(row, catalogProduct = null) {
  return resolveEffectiveSupplierOfferState(row, catalogProduct).availableForUpstream;
}

/** Approved active offers a supplier may pick as "mine" on upstream sourcing (not pending/rejected). */
export function isSupplierOfferEligibleForUpstreamSelection(row, catalogProduct = null) {
  const state = resolveEffectiveSupplierOfferState(row, catalogProduct);
  return state.effectiveStatus === 'approved' && state.effectiveActive;
}

/** Persist approved + active on offers that were approved but left inactive (stale row). */
export async function syncSupplierOfferApprovalFromCatalog(supabase, row) {
  const state = resolveEffectiveSupplierOfferState(row);
  if (!state.needsCatalogSync || !row?.id || !supabase) return row;
  const { data, error } = await supabase
    .from('supplier_products')
    .update({ status: 'approved', is_active: true })
    .eq('id', row.id)
    .select('*')
    .maybeSingle();
  if (error) {
    console.warn('syncSupplierOfferApprovalFromCatalog failed:', row.id, error.message);
    return row;
  }
  const synced = data ? { ...row, ...data, product: row.product } : row;
  return synced;
}
