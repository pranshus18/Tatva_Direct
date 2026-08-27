export function requestedQtyFromItem(item) {
  const qty = Number(item?.quantity);
  return Number.isFinite(qty) && qty > 0 ? qty : 1;
}

/** True only when the offer is available and on-hand stock covers the requested quantity. */
export function vendorOfferCanFulfill(vendor, requestedQty = 1) {
  if (!vendor) return false;
  const flag = vendor.isAvailable;
  if (flag === false || flag === 0 || flag === 'false' || flag === '0') return false;
  const stock = Number(vendor.availableStock ?? vendor.stock ?? 0);
  const qty = Number(requestedQty);
  const need = Number.isFinite(qty) && qty > 0 ? qty : 1;
  return Number.isFinite(stock) && stock >= need;
}

/**
 * Mark at most one fulfillable offer as nearest/recommended.
 * Out-of-stock and insufficient-stock offers must never receive this flag.
 */
export function assignNearestRecommendedFlags(
  vendors,
  { preferredSupplierId = '', requestedQty = 1, enabled = true } = {}
) {
  const list = Array.isArray(vendors) ? vendors : [];
  for (const vendor of list) {
    if (vendor && Object.prototype.hasOwnProperty.call(vendor, 'isNearestRecommended')) {
      delete vendor.isNearestRecommended;
    }
  }
  if (!enabled || list.length === 0) return list;

  const fulfillable = list.filter((vendor) => vendorOfferCanFulfill(vendor, requestedQty));
  const withDistance = fulfillable.filter((vendor) => typeof vendor?.distanceKm === 'number');
  const preferredId = String(preferredSupplierId || '').trim();
  const preferredWithDistance = preferredId
    ? withDistance.filter((vendor) => String(vendor?.id || '') === preferredId)
    : [];

  const pickNearestFrom = (candidates) =>
    candidates.reduce((best, vendor) =>
      (Number(vendor.distanceKm) || Infinity) < (Number(best.distanceKm) || Infinity) ? vendor : best
    );

  const nearest =
    (preferredWithDistance.length > 0 && pickNearestFrom(preferredWithDistance)) ||
    (withDistance.length > 0 && pickNearestFrom(withDistance)) ||
    null;

  if (nearest) nearest.isNearestRecommended = true;
  return list;
}

export function computeUrgencyBonus(requiredDateFromBoq) {
  if (!requiredDateFromBoq) return 0;
  const deadline = new Date(requiredDateFromBoq);
  const now = new Date();
  const days = (deadline.getTime() - now.getTime()) / 86400000;
  if (Number.isNaN(days) || days < 0 || days > 21) return 0;
  return Math.min(12, (21 - days) * 0.6);
}

export function computeLocationScore({
  siteGeoFromBoq,
  distanceKm,
  supplierLocation,
  boqProjectCity,
  serviceProviderCity,
  boqProjectState,
  serviceProviderState
}) {
  if (siteGeoFromBoq && distanceKm != null) {
    const capKm = 400;
    return 40 * Math.max(0, 1 - Math.min(distanceKm, capKm) / capKm);
  }

  const cityForMatch = boqProjectCity || serviceProviderCity;
  const stateForMatch = boqProjectState || serviceProviderState;
  if (!cityForMatch && !stateForMatch) return 0;

  const supplierLocLower = String(supplierLocation || '').toLowerCase();
  if (cityForMatch && supplierLocLower.includes(cityForMatch)) return 30;
  if (stateForMatch && supplierLocLower.includes(stateForMatch)) return 15;
  return 0;
}

export function sortVendorsByGeoThenRankScore(vendors, siteGeoFromBoq, requestedQty = 1) {
  vendors.sort((a, b) => {
    const aOk = vendorOfferCanFulfill(a, requestedQty) ? 0 : 1;
    const bOk = vendorOfferCanFulfill(b, requestedQty) ? 0 : 1;
    if (aOk !== bOk) return aOk - bOk;

    const hasGeo = !!siteGeoFromBoq;
    const aHasDist = hasGeo && typeof a.distanceKm === 'number';
    const bHasDist = hasGeo && typeof b.distanceKm === 'number';

    if (aHasDist && bHasDist && a.distanceKm !== b.distanceKm) {
      return a.distanceKm - b.distanceKm;
    }
    if (aHasDist && !bHasDist) return -1;
    if (!aHasDist && bHasDist) return 1;
    return b.rankScore - a.rankScore;
  });
}

export function prioritizeApprovedThenRankScore(vendors) {
  vendors.sort((a, b) => {
    if (a.status === 'approved' && b.status !== 'approved') return -1;
    if (a.status !== 'approved' && b.status === 'approved') return 1;
    return b.rankScore - a.rankScore;
  });
}

export function assignSequentialRank(vendors) {
  vendors.forEach((vendor, index) => {
    vendor.rank = index + 1;
  });
}

export function filterTopValidVendors(vendors, limit = 10, options = {}) {
  const { preserveGeoOrder = false } = options || {};
  const eligible = (vendors || []).filter(
    (vendor) =>
      vendor &&
      vendor.id &&
      vendor.name &&
      vendor.supplierProductId &&
      vendor.status === 'approved'
  );

  if (preserveGeoOrder) {
    return eligible.slice(0, limit);
  }

  const stockPriority = (v) => {
    const s = parseInt(v.stock, 10);
    if (Number.isFinite(s) && s > 0) return 2;
    const p = parseFloat(v.price);
    if (Number.isFinite(p) && p > 0) return 1;
    return 0;
  };

  eligible.sort((a, b) => {
    const sp = stockPriority(b) - stockPriority(a);
    if (sp !== 0) return sp;
    return (Number(b.rankScore) || 0) - (Number(a.rankScore) || 0);
  });

  return eligible.slice(0, limit);
}
