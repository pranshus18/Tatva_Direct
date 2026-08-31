export function getItemRequestedQty(item) {
  const qty = Number(item?.quantity);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

export function getVendorAvailableStock(vendor) {
  const stock = Number(vendor?.availableStock ?? vendor?.stock ?? 0);
  return Number.isFinite(stock) ? Math.max(0, stock) : 0;
}

export function vendorHasSufficientStock(vendor, item) {
  return getVendorAvailableStock(vendor) >= getItemRequestedQty(item);
}

/** True when the offer is explicitly unavailable or has no stock. */
export function vendorIsUnavailable(vendor) {
  if (!vendor) return true;
  const flag = vendor.isAvailable;
  if (flag === false || flag === 0 || flag === 'false' || flag === '0') return true;
  return getVendorAvailableStock(vendor) <= 0;
}

/** Supplier can fulfill only when stock covers qty and the offer is marked available. */
export function vendorCanFulfill(vendor, item) {
  if (!vendor || vendorIsUnavailable(vendor)) return false;
  return vendorHasSufficientStock(vendor, item);
}

/**
 * Normalize rank API / cache payloads so OOS offers cannot keep recommendation flags
 * or inconsistent stock/availability fields that confuse auto-select + badges.
 * Dual-role buyers must not see their own supplier listing.
 */
export function sanitizeVendorOffers(itemVendors, itemsList = [], excludeSupplierId = '') {
  const itemsById = new Map(
    (itemsList || []).map((item) => [String(item?.id ?? ''), item])
  );
  const buyerId = String(excludeSupplierId || '').trim();
  const cleaned = {};
  Object.keys(itemVendors || {}).forEach((itemId) => {
    const item = itemsById.get(String(itemId)) || null;
    const vendors = Array.isArray(itemVendors[itemId]) ? itemVendors[itemId] : [];
    cleaned[itemId] = vendors
      .filter((v) => {
        if (!v || !v.id || !v.name) return false;
        if (buyerId && String(v.id || '').trim().toLowerCase() === buyerId.toLowerCase()) return false;
        if (!v.supplierProductId) return false;
        if (String(v.status || '').toLowerCase() !== 'approved') return false;
        return true;
      })
      .map((v) => {
        const availableStock = getVendorAvailableStock(v);
        const isAvailable = !(
          v.isAvailable === false ||
          v.isAvailable === 0 ||
          v.isAvailable === 'false' ||
          v.isAvailable === '0' ||
          availableStock <= 0
        );
        const canFulfill = item
          ? isAvailable && availableStock >= getItemRequestedQty(item)
          : isAvailable;
        return {
          ...v,
          stock: availableStock,
          availableStock,
          isAvailable,
          isNearestRecommended: Boolean(v.isNearestRecommended) && canFulfill
        };
      });
  });
  return cleaned;
}

/** Sort fulfillable offers first, then by existing rank/distance order. */
export function sortVendorsForDisplay(vendors, item) {
  return [...vendors].sort((a, b) => {
    const aOk = vendorCanFulfill(a, item) ? 0 : 1;
    const bOk = vendorCanFulfill(b, item) ? 0 : 1;
    if (aOk !== bOk) return aOk - bOk;
    const aRank = Number(a?.rank);
    const bRank = Number(b?.rank);
    if (Number.isFinite(aRank) && Number.isFinite(bRank) && aRank !== bRank) {
      return aRank - bRank;
    }
    const aDist = typeof a?.distanceKm === 'number' ? a.distanceKm : Infinity;
    const bDist = typeof b?.distanceKm === 'number' ? b.distanceKm : Infinity;
    return aDist - bDist;
  });
}

/** Pick nearest supplier when distance is known; otherwise first ranked approved option. */
export function pickRecommendedVendor(vendors, item = null) {
  if (!Array.isArray(vendors) || vendors.length === 0) return null;
  const eligible = vendors.filter((v) => v && (v.selectionId || v.supplierProductId || v.id));
  if (!eligible.length) return null;

  const inStock = eligible.filter((v) => vendorCanFulfill(v, item));
  if (!inStock.length) return null;

  const preferredSupplierId =
    String(item?.nearestSupplier?.supplierId || '').trim() ||
    String(item?.supplyChainLastSupplier?.supplierId || '').trim() ||
    '';
  if (preferredSupplierId) {
    const preferred = inStock.filter((v) => String(v.id || '').trim() === preferredSupplierId);
    const preferredDistance = preferred.filter((v) => typeof v.distanceKm === 'number');
    if (preferredDistance.length) {
      return preferredDistance.reduce((best, vendor) =>
        vendor.distanceKm < best.distanceKm ? vendor : best
      );
    }
    if (preferred.length) {
      return preferred[0];
    }
  }

  const nearestFlagged = inStock.filter((v) => v.isNearestRecommended);
  if (nearestFlagged.length) {
    return nearestFlagged.reduce((best, vendor) => {
      const bestDist = typeof best.distanceKm === 'number' ? best.distanceKm : Infinity;
      const vendorDist = typeof vendor.distanceKm === 'number' ? vendor.distanceKm : Infinity;
      if (vendorDist !== bestDist) return vendorDist < bestDist ? vendor : best;
      return (Number(vendor.rank) || Infinity) < (Number(best.rank) || Infinity) ? vendor : best;
    });
  }

  const withDistance = inStock.filter(
    (v) => typeof v.distanceKm === 'number' && !Number.isNaN(v.distanceKm)
  );
  if (withDistance.length) {
    return withDistance.reduce((best, vendor) =>
      vendor.distanceKm < best.distanceKm ? vendor : best
    );
  }

  const approved = inStock.filter((v) => v.status === 'approved');
  const pool = approved.length ? approved : inStock;
  return pool.find((v) => v.rank === 1 || v.isNearestRecommended) || pool[0];
}
