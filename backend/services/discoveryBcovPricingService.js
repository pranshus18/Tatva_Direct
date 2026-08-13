import {
  normalizeBrandKey,
  parseFiniteNumber,
  pickEffectiveOfferPrice,
  resolveBcovPriceForBuyerMetrics
} from './procurementSharedService.js';
import { parseOfferPrice } from './catalogOfferSnapshotService.js';
import { loadBuyerCovMetrics } from './vendorBuyerMetricsService.js';

function detectOfferBrandKey(offer, product = null) {
  const attrs =
    offer?.attributes && typeof offer.attributes === 'object' && !Array.isArray(offer.attributes)
      ? offer.attributes
      : {};
  const specs =
    product?.specifications &&
    typeof product.specifications === 'object' &&
    !Array.isArray(product.specifications)
      ? product.specifications
      : {};
  const attrSpecs =
    attrs.specifications && typeof attrs.specifications === 'object' && !Array.isArray(attrs.specifications)
      ? attrs.specifications
      : {};
  return normalizeBrandKey(
    attrs.brandModel ||
      attrs.brand ||
      attrSpecs.brandModel ||
      attrSpecs.brand ||
      product?.brand ||
      specs.brandModel ||
      specs.brand ||
      product?.name ||
      ''
  );
}

/**
 * Preload Product_COV slabs keyed by `${supplierId}::${variantKey}` only.
 */
export async function preloadDiscoveryBcovLevels(supabase, supplierIds = []) {
  const ids = [...new Set((supplierIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const bcovBySupplierVariant = new Map();
  if (ids.length === 0) return bcovBySupplierVariant;

  const { data: bcovRows, error } = await supabase
    .from('supplier_bcov_levels')
    .select(
      'id, supplier_id, variant_key, normalized_brand, min_purchase_qty, max_purchase_qty, unit_price, notes'
    )
    .in('supplier_id', ids);
  if (error) {
    console.error('[Discovery BCOV] preload error:', error);
    return bcovBySupplierVariant;
  }

  for (const row of bcovRows || []) {
    const supplierId = String(row?.supplier_id || '').trim();
    const variantKey = String(row?.variant_key || '').trim();
    // Product_COV is per variant only — never index by brand, or other variants would inherit slabs.
    if (!supplierId || !variantKey) continue;
    const mapKey = `${supplierId}::${variantKey}`;
    if (!bcovBySupplierVariant.has(mapKey)) bcovBySupplierVariant.set(mapKey, []);
    bcovBySupplierVariant.get(mapKey).push(row);
  }

  for (const [key, levels] of bcovBySupplierVariant.entries()) {
    levels.sort(
      (a, b) =>
        (parseFiniteNumber(b.min_purchase_qty) || 0) - (parseFiniteNumber(a.min_purchase_qty) || 0)
    );
    bcovBySupplierVariant.set(key, levels);
  }

  return bcovBySupplierVariant;
}

/**
 * Resolve effective discovery price for one supplier offer using Product_COV OR-thresholds.
 * If the supplier has not defined Product_COV for this exact variant_key, MRP only.
 * Returns COV price only when a slab for this variant unlocks and is below MRP.
 */
export function resolveDiscoveryOfferBcovPricing({
  offer,
  product = null,
  platformCov = 0,
  supplierCovById = new Map(),
  brandCovByBrand = new Map(),
  bcovBySupplierVariant = new Map()
} = {}) {
  const basePrice = parseOfferPrice(offer?.price ?? offer?._price);
  const supplierId = String(offer?.supplier_id || offer?.supplier?.id || '').trim();
  if (!supplierId || basePrice <= 0) {
    return {
      price: basePrice,
      basePrice,
      bcovApplied: false,
      bcovLevelId: null
    };
  }

  const variantKey = String(offer?.variant_key || '').trim();
  // No variant identity or no slabs for this variant → catalog/offer MRP only.
  const levels =
    variantKey && bcovBySupplierVariant.has(`${supplierId}::${variantKey}`)
      ? bcovBySupplierVariant.get(`${supplierId}::${variantKey}`) || []
      : [];
  if (!variantKey || levels.length === 0) {
    return {
      price: basePrice,
      basePrice,
      bcovApplied: false,
      bcovLevelId: null
    };
  }

  const brandKey = detectOfferBrandKey(offer, product);
  const resolved = resolveBcovPriceForBuyerMetrics({
    levels,
    supplierCov: parseFiniteNumber(supplierCovById.get(supplierId)) || 0,
    platformCov: parseFiniteNumber(platformCov) || 0,
    brandCov: parseFiniteNumber(brandCovByBrand.get(brandKey)) || 0
  });

  const picked = pickEffectiveOfferPrice(basePrice, resolved);
  return {
    price: picked.price,
    basePrice: picked.basePrice,
    bcovApplied: picked.bcovApplied,
    bcovLevelId: picked.bcovLevelId
  };
}

/**
 * Annotate offer rows with effective Product_COV prices used by discovery ranking/display.
 */
export function annotateDiscoveryOffersWithBcov({
  offerRows = [],
  productById = new Map(),
  platformCov = 0,
  supplierCovById = new Map(),
  brandCovByBrand = new Map(),
  bcovBySupplierVariant = new Map()
} = {}) {
  return (offerRows || []).map((row) => {
    const product = productById.get(row?.product_id) || null;
    const pricing = resolveDiscoveryOfferBcovPricing({
      offer: row,
      product,
      platformCov,
      supplierCovById,
      brandCovByBrand,
      bcovBySupplierVariant
    });
    return {
      ...row,
      _basePrice: pricing.basePrice,
      _effectivePrice: pricing.price,
      _bcovApplied: pricing.bcovApplied,
      _bcovLevelId: pricing.bcovLevelId,
      // Discovery "best offer" tie-break uses _price — prefer unlocked COV price for the buyer.
      _price: pricing.price > 0 ? pricing.price : parseOfferPrice(row?.price)
    };
  });
}

export async function loadDiscoveryBuyerBcovContext(supabase, userId) {
  const buyerId = String(userId || '').trim();
  if (!buyerId) {
    return {
      platformCov: 0,
      supplierCovById: new Map(),
      brandCovByBrand: new Map(),
      bcovBySupplierVariant: new Map()
    };
  }

  try {
    const metrics = await loadBuyerCovMetrics({ supabase, userId: buyerId });
    return {
      platformCov: metrics.platformCov || 0,
      supplierCovById: metrics.supplierCovById || new Map(),
      brandCovByBrand: metrics.brandCovByBrand || new Map(),
      bcovBySupplierVariant: new Map()
    };
  } catch (error) {
    console.error('[Discovery BCOV] buyer metrics failed:', error?.message || error);
    return {
      platformCov: 0,
      supplierCovById: new Map(),
      brandCovByBrand: new Map(),
      bcovBySupplierVariant: new Map()
    };
  }
}

export async function enrichDiscoveryOffersWithBuyerBcov({
  supabase,
  userId,
  offerRows = [],
  productById = new Map(),
  enabled = true
} = {}) {
  if (!enabled || !userId || !Array.isArray(offerRows) || offerRows.length === 0) {
    return {
      offerRows,
      platformCov: 0,
      supplierCovById: new Map(),
      brandCovByBrand: new Map(),
      bcovBySupplierVariant: new Map()
    };
  }

  const context = await loadDiscoveryBuyerBcovContext(supabase, userId);
  const supplierIds = offerRows
    .map((row) => row?.supplier_id || row?.supplier?.id)
    .filter(Boolean);
  const bcovBySupplierVariant = await preloadDiscoveryBcovLevels(supabase, supplierIds);
  const annotated = annotateDiscoveryOffersWithBcov({
    offerRows,
    productById,
    platformCov: context.platformCov,
    supplierCovById: context.supplierCovById,
    brandCovByBrand: context.brandCovByBrand,
    bcovBySupplierVariant
  });

  return {
    offerRows: annotated,
    platformCov: context.platformCov,
    supplierCovById: context.supplierCovById,
    brandCovByBrand: context.brandCovByBrand,
    bcovBySupplierVariant
  };
}
