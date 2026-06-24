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

  for (const sid of supplierIds) distanceBySupplier[sid] = null;
  if (!siteGeoFromBoq || supplierIds.length === 0) {
    return { distanceBySupplier, distanceSourceLocationBySupplier };
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
    const locCandidates = uniqueLocationList([...(supplierInfo?.locationCandidates || []), supplierInfo?.supplierLocation]);
    const geocodedCandidates = [];
    for (const locText of locCandidates) {
      if (!locText) continue;
      const approxGeo = await geocodeCached(locText);
      if (approxGeo && typeof approxGeo.lat === 'number' && typeof approxGeo.lng === 'number') {
        geocodedCandidates.push({ locText, geo: approxGeo });
      }
    }
    if (geocodedCandidates.length === 0) continue;
    const routeDistances = await getDrivingDistanceMatrixKm(
      siteGeoFromBoq,
      geocodedCandidates.map((x) => x.geo)
    );
    geocodedCandidates.forEach((candidate, idx) => {
      const km = distanceKmForRanking(siteGeoFromBoq, candidate.geo, routeDistances[idx]);
      if (km == null) return;
      if (distanceBySupplier[sid] == null || km < distanceBySupplier[sid]) {
        distanceBySupplier[sid] = km;
        distanceSourceLocationBySupplier[sid] = candidate.locText;
      }
    });
  }

  return { distanceBySupplier, distanceSourceLocationBySupplier };
}
