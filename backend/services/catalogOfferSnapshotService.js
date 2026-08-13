import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';
import { parseMoney } from '../utils/money.js';

export function parseOfferPrice(raw) {
  return parseMoney(raw);
}

export function isListedSupplierOffer(row = {}) {
  const normalizedStatus = String(row?.status || '').trim().toLowerCase();
  return normalizedStatus === 'approved' && row?.is_active === true;
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
  supplierMatchesBrandTerminalRoleFn
}) {
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
        enforceTerminalRole: true
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
  enforceTerminalRole = false
} = {}) {
  if (!isListedSupplierOffer(offer)) return false;
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
  enforceTerminalRole = false
} = {}) {
  return (offerRows || []).filter((offer) =>
    isOfferEligibleForDiscoveryAudience({
      offer,
      product: productById?.get(offer?.product_id),
      detectDiscoveryBrand,
      terminalRoleByBrandMap,
      supplierMatchesBrandTerminalRoleFn,
      enforceTerminalRole
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
