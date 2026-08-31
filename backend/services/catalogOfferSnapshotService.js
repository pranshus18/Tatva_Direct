import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';
import { parseMoney } from '../utils/money.js';

export function parseOfferPrice(raw) {
  return parseMoney(raw);
}

export function isListedSupplierOffer(row = {}) {
  const normalizedStatus = String(row?.status || '').trim().toLowerCase();
  return normalizedStatus === 'approved' && row?.is_active === true;
}

/** JWT / PostgREST UUID casing can differ between environments. */
export function normalizeActorId(value) {
  return String(value || '').trim().toLowerCase();
}

export function resolveOfferSupplierId(offer = {}) {
  const nested = offer?.supplier;
  const nestedId = Array.isArray(nested) ? nested[0]?.id : nested?.id;
  return String(offer?.supplier_id || nestedId || '').trim();
}

export const BUYER_OWN_LISTING_PURCHASE_MESSAGE =
  'You cannot buy this product from your own supplier listing. Choose another supplier of the same product or variant.';

export const BUYER_OWNED_DISCOVERY_PURCHASE_MESSAGE =
  'You already sell this product or variant. Source it from your upstream partner instead of Product Discovery.';

/** Dual-role buyers must not purchase from their own supplier listing. */
export function isExcludedBuyerSupplierOffer(offer, excludeSupplierId) {
  const excluded = normalizeActorId(excludeSupplierId);
  if (!excluded) return false;
  return normalizeActorId(resolveOfferSupplierId(offer)) === excluded;
}

function emptyBuyerOwnedListingIndex() {
  return {
    productIds: new Set(),
    productIdsWithoutVariant: new Set(),
    variantKeysByProductId: new Map(),
    variantAsins: new Set()
  };
}

export function isBuyerOwnedCatalogOffer(offer, buyerSupplierId) {
  if (!isExcludedBuyerSupplierOffer(offer, buyerSupplierId)) return false;
  return String(offer?.status || '').trim().toLowerCase() !== 'rejected';
}

/**
 * Index of catalog rows / variants the buyer already sells.
 * Used so Product Discovery hides those SKUs even when other retailers list them.
 * Upstream sourcing does not pass excludeSupplierId, so it stays visible there.
 */
export function collectBuyerOwnedListingIndex(offerRows = [], buyerSupplierId) {
  const index = emptyBuyerOwnedListingIndex();
  if (!normalizeActorId(buyerSupplierId)) return index;

  for (const offer of offerRows || []) {
    if (!isBuyerOwnedCatalogOffer(offer, buyerSupplierId)) continue;
    const productId = normalizeActorId(offer?.product_id);
    const variantKey = String(offer?.variant_key || '').trim().toLowerCase();
    const variantAsin = String(offer?.variant_asin || '').trim().toLowerCase();
    if (productId) index.productIds.add(productId);
    if (variantAsin) index.variantAsins.add(variantAsin);
    if (variantKey && productId) {
      if (!index.variantKeysByProductId.has(productId)) {
        index.variantKeysByProductId.set(productId, new Set());
      }
      index.variantKeysByProductId.get(productId).add(variantKey);
    } else if (productId && !variantAsin) {
      index.productIdsWithoutVariant.add(productId);
    }
  }
  return index;
}

export function isBuyerOwnedDiscoveryVariant(listing = {}, ownedIndex = null) {
  if (!ownedIndex) return false;
  const productId = normalizeActorId(
    listing?.productId || listing?.product_id || listing?.id
  );
  const variantKey = String(listing?.variantKey || listing?.variant_key || '')
    .trim()
    .toLowerCase();
  const variantAsin = String(listing?.variantAsin || listing?.variant_asin || '')
    .trim()
    .toLowerCase();

  if (variantAsin && ownedIndex.variantAsins.has(variantAsin)) return true;

  // An explicit variant identity must match that variant only. Owning Blue must
  // never hide Red of the same catalog product, even if the buyer's own row
  // was saved without a variant_key (common in production).
  if (variantKey) {
    if (!productId) return false;
    const keys = ownedIndex.variantKeysByProductId.get(productId);
    return Boolean(keys?.has(variantKey));
  }

  if (productId && ownedIndex.productIds.has(productId)) {
    return true;
  }
  return false;
}

export function isBuyerOwnedDiscoveryProduct(productId, ownedIndex = null) {
  if (!ownedIndex) return false;
  return ownedIndex.productIds.has(normalizeActorId(productId));
}

/** True when this offer is the same SKU/variant the buyer already sells (any seller). */
export function offerMatchesBuyerOwnedListing(offer, ownedIndex) {
  if (!ownedIndex) return false;
  return isBuyerOwnedDiscoveryVariant(
    {
      productId: offer?.product_id,
      variantKey: offer?.variant_key,
      variantAsin: offer?.variant_asin
    },
    ownedIndex
  );
}

function resolveOwnedListingIndex({
  offerRows = [],
  excludeSupplierId = null,
  ownedListingIndex = null
} = {}) {
  if (ownedListingIndex) return ownedListingIndex;
  if (!normalizeActorId(excludeSupplierId)) return null;
  return collectBuyerOwnedListingIndex(offerRows, excludeSupplierId);
}

export async function assertBuyerDoesNotOwnDiscoveryListing(
  supabase,
  { productId, variantKey = '', variantAsin = '', buyerUserId = null } = {}
) {
  const buyerId = String(buyerUserId || '').trim();
  const pid = String(productId || '').trim();
  if (!buyerId || !pid) return { ok: true };

  const { data, error } = await supabase
    .from('supplier_products')
    .select('id, product_id, supplier_id, variant_key, variant_asin, status, is_active')
    .eq('product_id', pid)
    .neq('status', 'rejected')
    .limit(200);
  if (error) throw error;

  const ownedIndex = collectBuyerOwnedListingIndex(data || [], buyerId);
  if (variantKey || variantAsin) {
    if (
      isBuyerOwnedDiscoveryVariant(
        { productId: pid, variantKey, variantAsin },
        ownedIndex
      )
    ) {
      return {
        ok: false,
        status: 400,
        message: BUYER_OWNED_DISCOVERY_PURCHASE_MESSAGE
      };
    }
    return { ok: true };
  }

  const remainingUnownedVariant = (data || []).some(
    (row) =>
      isListedSupplierOffer(row) && !offerMatchesBuyerOwnedListing(row, ownedIndex)
  );
  if (remainingUnownedVariant) return { ok: true };
  if (!isBuyerOwnedDiscoveryProduct(pid, ownedIndex)) return { ok: true };
  return {
    ok: false,
    status: 400,
    message: BUYER_OWNED_DISCOVERY_PURCHASE_MESSAGE
  };
}

/** Prefer higher stock; tie-break on lower positive price. */
export function pickBetterListedOffer(existing, candidate) {
  if (!existing) return candidate;
  if (candidate._stock > existing._stock) return candidate;
  if (candidate._stock < existing._stock) return existing;
  if (candidate._price > 0 && (existing._price <= 0 || candidate._price < existing._price)) {
    return candidate;
  }
  return existing;
}

export function aggregateListedSupplierOffers(offerRows = []) {
  const byProduct = new Map();

  for (const row of offerRows) {
    const productId = row?.product_id;
    if (!productId || !isListedSupplierOffer(row)) continue;

    const stock = parseSupplierStockQuantity(row.stock) ?? 0;
    const price = parseOfferPrice(row.price);
    const candidate = {
      ...row,
      _stock: stock,
      _price: price
    };

    const existing = byProduct.get(productId) || {
      productId,
      listedOfferCount: 0,
      totalStock: 0,
      bestOffer: null,
      bestInStockOffer: null,
      lowestPriceOffer: null
    };

    existing.listedOfferCount += 1;
    existing.totalStock += stock;
    existing.bestOffer = pickBetterListedOffer(existing.bestOffer, candidate);
    if (stock > 0) {
      existing.bestInStockOffer = pickBetterListedOffer(existing.bestInStockOffer, candidate);
    }
    if (price > 0 && (!existing.lowestPriceOffer || price < existing.lowestPriceOffer._price)) {
      existing.lowestPriceOffer = candidate;
    }

    byProduct.set(productId, existing);
  }

  return { byProduct };
}

export function buildCatalogSnapshotPatch(aggregate) {
  if (!aggregate || aggregate.listedOfferCount === 0) {
    return {
      stock: 0,
      min_order_quantity: null,
      location: null
    };
  }

  const priceSource =
    aggregate.bestInStockOffer ||
    aggregate.lowestPriceOffer ||
    aggregate.bestOffer;

  return {
    stock: aggregate.totalStock,
    min_order_quantity: priceSource?.min_order_quantity ?? null,
    location: String(priceSource?.location || '').trim() || null
  };
}

export function aggregateEligibleDiscoveryOffers({
  offerRows = [],
  productById,
  detectDiscoveryBrand,
  terminalRoleByBrandMap,
  supplierMatchesBrandTerminalRoleFn,
  excludeSupplierId = null,
  ownedListingIndex = null
}) {
  const resolvedOwnedIndex = resolveOwnedListingIndex({
    offerRows,
    excludeSupplierId,
    ownedListingIndex
  });
  const eligibleSupplierCountByProduct = new Map();
  const totalStockByProduct = new Map();
  const bestOfferByProduct = new Map();

  for (const row of offerRows) {
    const productId = row?.product_id;
    if (productId == null || productId === '') continue;
    if (
      !isOfferEligibleForDiscoveryAudience({
        offer: row,
        product: productById.get(productId),
        detectDiscoveryBrand,
        terminalRoleByBrandMap,
        supplierMatchesBrandTerminalRoleFn,
        enforceTerminalRole: true,
        excludeSupplierId,
        ownedListingIndex: resolvedOwnedIndex
      })
    ) {
      continue;
    }

    eligibleSupplierCountByProduct.set(
      productId,
      (eligibleSupplierCountByProduct.get(productId) || 0) + 1
    );

    const stock = parseSupplierStockQuantity(row.stock) ?? 0;
    totalStockByProduct.set(productId, (totalStockByProduct.get(productId) || 0) + stock);

    const candidate = {
      ...row,
      _stock: stock,
      _price:
        row._price != null && Number.isFinite(Number(row._price))
          ? Number(row._price)
          : parseOfferPrice(row.price)
    };
    bestOfferByProduct.set(productId, pickBetterListedOffer(bestOfferByProduct.get(productId), candidate));
  }

  return { eligibleSupplierCountByProduct, totalStockByProduct, bestOfferByProduct };
}

/**
 * Listed + (optionally) brand-terminal-role eligibility for buyer discovery.
 * Upstream sellers must not appear as purchasable variants for service providers.
 */
export function isOfferEligibleForDiscoveryAudience({
  offer,
  product,
  detectDiscoveryBrand,
  terminalRoleByBrandMap,
  supplierMatchesBrandTerminalRoleFn = () => true,
  enforceTerminalRole = false,
  excludeSupplierId = null,
  ownedListingIndex = null
} = {}) {
  if (!isListedSupplierOffer(offer)) return false;
  if (isExcludedBuyerSupplierOffer(offer, excludeSupplierId)) return false;
  if (offerMatchesBuyerOwnedListing(offer, ownedListingIndex)) return false;
  if (!enforceTerminalRole) return true;
  const brandLabel =
    typeof detectDiscoveryBrand === 'function' ? detectDiscoveryBrand(product) : '';
  const supplierProfile = offer?.supplier?.profile || {};
  return supplierMatchesBrandTerminalRoleFn(
    supplierProfile,
    brandLabel,
    terminalRoleByBrandMap || new Map()
  );
}

/** Filter offer rows to those buyers may purchase for the given discovery audience. */
export function filterListedOffersForDiscoveryAudience({
  offerRows = [],
  productById,
  detectDiscoveryBrand,
  terminalRoleByBrandMap,
  supplierMatchesBrandTerminalRoleFn = () => true,
  enforceTerminalRole = false,
  excludeSupplierId = null,
  ownedListingIndex = null
} = {}) {
  const resolvedOwnedIndex = resolveOwnedListingIndex({
    offerRows,
    excludeSupplierId,
    ownedListingIndex
  });
  return (offerRows || []).filter((offer) =>
    isOfferEligibleForDiscoveryAudience({
      offer,
      product: productById?.get(offer?.product_id),
      detectDiscoveryBrand,
      terminalRoleByBrandMap,
      supplierMatchesBrandTerminalRoleFn,
      enforceTerminalRole,
      excludeSupplierId,
      ownedListingIndex: resolvedOwnedIndex
    })
  );
}

export function reconcileDiscoveryProductFields(product, aggregates) {
  const productId = product?.id;
  const supplierCount = Number(aggregates.eligibleSupplierCountByProduct.get(productId) || 0);
  const totalStock = Number(aggregates.totalStockByProduct.get(productId) || 0);
  const bestOffer = aggregates.bestOfferByProduct.get(productId);
  const catalogPrice = parseOfferPrice(product?.price);
  const offerMrp = parseOfferPrice(
    bestOffer?._basePrice ?? bestOffer?.price ?? bestOffer?._price
  );
  const offerEffective = parseOfferPrice(
    bestOffer?._effectivePrice ?? bestOffer?._price ?? bestOffer?.price
  );
  const catalogStock = parseSupplierStockQuantity(product?.stock);
  const resolvedStock = supplierCount > 0 ? totalStock : (catalogStock ?? 0);
  const resolvedPrice = offerEffective > 0 ? offerEffective : catalogPrice;
  const resolvedMrp = offerMrp > 0 ? offerMrp : catalogPrice;
  const bcovApplied =
    Boolean(bestOffer?._bcovApplied) &&
    resolvedMrp > 0 &&
    resolvedPrice > 0 &&
    resolvedPrice < resolvedMrp;

  return {
    ...product,
    supplierCount,
    canAddToCart: supplierCount > 0 && resolvedStock > 0,
    stock: resolvedStock,
    price: resolvedPrice,
    // MRP / list price before Product_COV — used for strikethrough in discovery UI.
    basePrice: resolvedMrp > 0 ? resolvedMrp : null,
    mrp: resolvedMrp > 0 ? resolvedMrp : null,
    bcovApplied,
    bcovLevelId: bcovApplied ? bestOffer?._bcovLevelId || null : null,
    min_order_quantity: bestOffer?.min_order_quantity ?? product?.min_order_quantity ?? null,
    location:
      String(product?.location || '').trim() ||
      String(bestOffer?.location || '').trim() ||
      product?.location
  };
}

/**
 * Keep shared catalog `products` stock (and MOQ/location) aligned with listed supplier offers.
 * Price lives on each offer (`supplier_products.price`) — discovery/ranking read offer price;
 * this snapshot intentionally does not overwrite `products.price`.
 * Supplier inventory is authoritative; the stock snapshot prevents legacy readers from seeing
 * stale zero stock when listed offers still have inventory.
 */
export async function syncCatalogProductSnapshotFromOffers(supabase, productId) {
  const normalizedProductId = String(productId || '').trim();
  if (!normalizedProductId) {
    return { ok: false, reason: 'missing_product_id' };
  }

  const { data: offerRows, error } = await supabase
    .from('supplier_products')
    .select('product_id, price, stock, min_order_quantity, location, status, is_active')
    .eq('product_id', normalizedProductId)
    .neq('status', 'rejected');

  if (error) {
    console.error('[CatalogSnapshot] Failed to load supplier offers:', error.message || error);
    return { ok: false, reason: 'load_failed', error };
  }

  const aggregates = aggregateListedSupplierOffers(offerRows || []);
  const aggregate = aggregates.byProduct.get(normalizedProductId);
  const snapshot = buildCatalogSnapshotPatch(aggregate);
  const patch = {
    stock: snapshot.stock,
    updated_at: new Date().toISOString()
  };

  if (snapshot.min_order_quantity != null) patch.min_order_quantity = snapshot.min_order_quantity;
  if (snapshot.location) patch.location = snapshot.location;

  const { error: updateError } = await supabase
    .from('products')
    .update(patch)
    .eq('id', normalizedProductId);

  if (updateError) {
    console.error('[CatalogSnapshot] Failed to update products snapshot:', updateError.message || updateError);
    return { ok: false, reason: 'update_failed', error: updateError };
  }

  return { ok: true, productId: normalizedProductId, ...snapshot };
}
