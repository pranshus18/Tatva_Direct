import { compactLocationText, uniqueLocationList } from './vendorRankingHelpersService.js';
import {
  distanceKmForRanking,
  geocodeIndianAddress,
  geocodeAddressNominatim,
  getDrivingDistanceMatrixKm,
  resolveGeoFromOutletAddress
} from '../utils/geoUtils.js';

export async function computeSupplierDistances({ supabase, supplierProducts, siteGeoFromBoq }) {
  const supplierIds = Object.keys(supplierProducts || {});
  const distanceBySupplier = {};
  const distanceSourceLocationBySupplier = {};
  const distanceByOutletId = {};
  const distanceSourceLocationByOutletId = {};

  for (const sid of supplierIds) distanceBySupplier[sid] = null;
  if (!siteGeoFromBoq || supplierIds.length === 0) {
    return { distanceBySupplier, distanceSourceLocationBySupplier, distanceByOutletId, distanceSourceLocationByOutletId };
  }

  // Each individual offer (supplier_products row) can carry its own `outlet_id`, which is the
  // most authoritative location we have for that specific listing — more reliable than a
  // free-text `location` string or the supplier's generic account address. Resolve those first,
  // per exact outlet, so two offers from the same supplier (e.g. one per physical branch) get
  // their own correct distance instead of sharing a single supplier-wide guess.
  const offerOutletIds = new Set();
  for (const sid of supplierIds) {
    for (const product of supplierProducts[sid]?.products || []) {
      if (product?.outlet_id) offerOutletIds.add(product.outlet_id);
    }
  }

  if (offerOutletIds.size > 0) {
    const { data: exactOutletRows } = await supabase
      .from('outlets')
      .select('id, geo_location, address')
      .in('id', [...offerOutletIds])
      .eq('is_active', true);

    const exactOutletInputs = [];
    for (const row of exactOutletRows || []) {
      if (!row?.id) continue;
      const geo = await resolveGeoFromOutletAddress(row?.geo_location, row?.address);
      if (!geo) continue;
      exactOutletInputs.push({ outletId: row.id, geo });
    }
    if (exactOutletInputs.length > 0) {
      const routeDistances = await getDrivingDistanceMatrixKm(
        siteGeoFromBoq,
        exactOutletInputs.map((x) => x.geo)
      );
      exactOutletInputs.forEach((entry, idx) => {
        const km = distanceKmForRanking(siteGeoFromBoq, entry.geo, routeDistances[idx]);
        if (km == null) return;
        distanceByOutletId[entry.outletId] = km;
        distanceSourceLocationByOutletId[entry.outletId] = 'Outlet geo location';
      });
    }
  }

  const geocodeCache = new Map();
  const geocodeCached = async (text) => {
    const key = compactLocationText(text).toLowerCase();
    if (!key) return null;
    if (geocodeCache.has(key)) return geocodeCache.get(key);
    try {
      const geo = (await geocodeIndianAddress(text)) || (await geocodeAddressNominatim(text));
      geocodeCache.set(key, geo || null);
      return geo || null;
    } catch {
      geocodeCache.set(key, null);
      return null;
    }
  };

  const { data: outletRows } = await supabase
    .from('outlets')
    .select('supplier_id, geo_location, address')
    .in('supplier_id', supplierIds)
    .eq('is_active', true);

  const outletDistanceInputs = [];
  for (const row of outletRows || []) {
    const sid = row?.supplier_id;
    if (!sid) continue;
    const geo = await resolveGeoFromOutletAddress(row?.geo_location, row?.address);
    if (!geo) continue;
    outletDistanceInputs.push({ sid, geo });
  }

  if (outletDistanceInputs.length > 0) {
    const routeDistances = await getDrivingDistanceMatrixKm(
      siteGeoFromBoq,
      outletDistanceInputs.map((x) => x.geo)
    );
    outletDistanceInputs.forEach((entry, idx) => {
      const sid = entry.sid;
      const km = distanceKmForRanking(siteGeoFromBoq, entry.geo, routeDistances[idx]);
      if (km == null) return;
      if (distanceBySupplier[sid] == null || km < distanceBySupplier[sid]) {
        distanceBySupplier[sid] = km;
        distanceSourceLocationBySupplier[sid] = 'Outlet geo location';
      }
    });
  }

  for (const sid of supplierIds) {
    if (distanceBySupplier[sid] != null) continue;
    const supplierInfo = supplierProducts[sid];
    // `locationCandidates` is ordered by trust: the specific product/listing location
    // comes first, then the supplier's registered account address, then branch addresses.
    // We must use the FIRST candidate that successfully geocodes — never the one that
    // happens to yield the smallest distance — otherwise a generic/stale account address
    // (e.g. a signup pincode shared by many test accounts) can "win" over the real,
    // more specific listing location just because it geocodes closer to the buyer,
    // producing a wildly wrong distance (and a "Distance based on" label that
    // contradicts the location actually shown on the card).
    const locCandidates = uniqueLocationList([...(supplierInfo?.locationCandidates || []), supplierInfo?.supplierLocation]);
    let matchedCandidate = null;
    for (const locText of locCandidates) {
      if (!locText) continue;
      const approxGeo = await geocodeCached(locText);
      if (approxGeo && typeof approxGeo.lat === 'number' && typeof approxGeo.lng === 'number') {
        matchedCandidate = { locText, geo: approxGeo };
        break;
      }
    }
    if (!matchedCandidate) continue;
    const [routeKm] = await getDrivingDistanceMatrixKm(siteGeoFromBoq, [matchedCandidate.geo]);
    const km = distanceKmForRanking(siteGeoFromBoq, matchedCandidate.geo, routeKm);
    if (km == null) continue;
    distanceBySupplier[sid] = km;
    distanceSourceLocationBySupplier[sid] = matchedCandidate.locText;
  }

  return { distanceBySupplier, distanceSourceLocationBySupplier, distanceByOutletId, distanceSourceLocationByOutletId };
}
