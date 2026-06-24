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

export function sortVendorsByGeoThenRankScore(vendors, siteGeoFromBoq) {
  vendors.sort((a, b) => {
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
      (vendor.status === 'approved' || vendor.status === 'pending')
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
