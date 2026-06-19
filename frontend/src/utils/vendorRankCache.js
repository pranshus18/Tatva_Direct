/** In-memory cache for POST /api/vendors/rank (survives sidebar tab switches in the same session). */

const CACHE = new Map();
const TTL_MS = 5 * 60 * 1000;

export function buildVendorRankCacheKey(items, boqId, project = null) {
  const lines = (Array.isArray(items) ? items : [])
    .map((it) => {
      const id = String(it?.id ?? it?.productId ?? '').trim();
      const qty = Math.floor(Number(it?.quantity)) || 1;
      return `${id}:${qty}`;
    })
    .filter((line) => line && !line.startsWith(':'))
    .sort();
  const ship = project?.shippingAddress;
  const siteKey = ship
    ? [ship.line1, ship.city, ship.pincode, project?.siteGeo?.lat, project?.siteGeo?.lng]
        .map((part) => String(part ?? '').trim())
        .join('|')
    : String(project?.location || '').trim();
  return `${String(boqId || '').trim()}::${siteKey}::${lines.join('|')}`;
}

export function getVendorRankCache(key) {
  if (!key) return null;
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return entry.itemVendors;
}

export function setVendorRankCache(key, itemVendors) {
  if (!key || !itemVendors || typeof itemVendors !== 'object') return;
  CACHE.set(key, { ts: Date.now(), itemVendors });
}

export function clearVendorRankCache() {
  CACHE.clear();
}
