import { buildOutletAddressString, haversineKm } from '../utils/geoUtils.js';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';
import { UPSTREAM_VARIANT_MATCH_RANK } from './upstreamOfferMatchService.js';

export const SUPPLY_CHAIN_ROLE_LABELS = {
  manufacturer: 'Manufacturers (MGF)',
  stockist: 'Stockists',
  regional_distributor: 'Regional distributors',
  local_distributor: 'Local distributors',
  dealer: 'Dealers',
  retailer: 'Retailers'
};

export const UPSTREAM_RANK_PRIORITY = ['distance', 'stock', 'price', 'rating'];

function getUpstreamRatingSortValue(candidate) {
  const ratingCount = candidate.ratingCount || 0;
  const averageRating = candidate.averageRating;
  if (ratingCount > 0 && averageRating != null && Number.isFinite(Number(averageRating))) {
    return Number(averageRating);
  }
  return -1;
}

export function minHaversineKmBuyerOutletsToSeller(buyerGeos, sellerGeo) {
  if (!sellerGeo || typeof sellerGeo.lat !== 'number' || typeof sellerGeo.lng !== 'number') return null;
  if (!Array.isArray(buyerGeos) || buyerGeos.length === 0) return null;
  let best = Infinity;
  for (const bg of buyerGeos) {
    if (!bg || typeof bg.lat !== 'number' || typeof bg.lng !== 'number') continue;
    const distance = haversineKm(bg.lat, bg.lng, sellerGeo.lat, sellerGeo.lng);
    if (distance < best) best = distance;
  }
  return Number.isFinite(best) ? best : null;
}

export function getFirstSupplierBranchAddressText(profile) {
  const branches = Array.isArray(profile?.branches) ? profile.branches : [];
  for (const branch of branches) {
    const addr = buildOutletAddressString(branch);
    if (addr) return addr;
  }
  return '';
}

export function dedupeUpstreamCandidatesBySupplierPreferClosest(candidates) {
  const map = new Map();
  for (const c of candidates) {
    const supplierId = c.supplierId;
    if (!supplierId) continue;
    const prev = map.get(supplierId);
    if (!prev) {
      map.set(supplierId, c);
      continue;
    }
    const tierNew = UPSTREAM_VARIANT_MATCH_RANK[c.variantMatchType] ?? 99;
    const tierOld = UPSTREAM_VARIANT_MATCH_RANK[prev.variantMatchType] ?? 99;
    if (tierNew < tierOld) {
      map.set(supplierId, c);
      continue;
    }
    if (tierNew > tierOld) continue;
    const dNew = c.distanceKmRaw != null && Number.isFinite(c.distanceKmRaw) ? c.distanceKmRaw : Infinity;
    const dOld = prev.distanceKmRaw != null && Number.isFinite(prev.distanceKmRaw) ? prev.distanceKmRaw : Infinity;
    if (dNew < dOld) {
      map.set(supplierId, c);
      continue;
    }
    if (dNew > dOld) continue;
    const pNew = parseFloat(c.price) || 0;
    const pOld = parseFloat(prev.price) || 0;
    if (pNew < pOld) map.set(supplierId, c);
    else if (
      pNew === pOld &&
      (parseSupplierStockQuantity(c.stock) ?? 0) > (parseSupplierStockQuantity(prev.stock) ?? 0)
    ) {
      map.set(supplierId, c);
    }
  }
  return [...map.values()];
}

export function rankUpstreamOffersForProduct(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];

  const sorted = [...candidates].sort((a, b) => {
    const tierA = UPSTREAM_VARIANT_MATCH_RANK[a.variantMatchType] ?? 99;
    const tierB = UPSTREAM_VARIANT_MATCH_RANK[b.variantMatchType] ?? 99;
    if (tierA !== tierB) return tierA - tierB;

    const da = a.distanceKmRaw != null && Number.isFinite(a.distanceKmRaw) ? a.distanceKmRaw : Infinity;
    const db = b.distanceKmRaw != null && Number.isFinite(b.distanceKmRaw) ? b.distanceKmRaw : Infinity;
    if (da !== db) return da - db;

    const sa = Math.max(0, parseSupplierStockQuantity(a.stock) ?? 0);
    const sb = Math.max(0, parseSupplierStockQuantity(b.stock) ?? 0);
    if (sa !== sb) return sb - sa;

    const pa = Math.max(0, parseFloat(a.price) || 0);
    const pb = Math.max(0, parseFloat(b.price) || 0);
    if (pa !== pb) return pa - pb;

    const ra = getUpstreamRatingSortValue(b) - getUpstreamRatingSortValue(a);
    if (ra !== 0) return ra;

    return String(a.supplierId || '').localeCompare(String(b.supplierId || ''));
  });

  return sorted.map((c, idx) => {
    const stock = Math.max(0, parseSupplierStockQuantity(c.stock) ?? 0);
    const price = Math.max(0, parseFloat(c.price) || 0);
    const rv = getUpstreamRatingSortValue(c);
    return {
      ...c,
      rankOrder: idx + 1,
      rankMethod: 'distance_then_stock_then_price_then_rating',
      rankScore: sorted.length - idx,
      rankComponents: {
        distanceKm: c.distanceKm != null && Number.isFinite(c.distanceKm) ? c.distanceKm : null,
        stock,
        price,
        averageRating: rv >= 0 ? c.averageRating : null,
        ratingCount: c.ratingCount || 0
      }
    };
  });
}
