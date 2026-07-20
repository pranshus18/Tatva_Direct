import { resolveApiPath } from '../config/api';

const QUOTE_CACHE_TTL_MS = 120_000;
const quoteCache = new Map();

function digitsPin6(value) {
  const d = String(value || '').replace(/\D/g, '').slice(0, 6);
  return d.length === 6 ? d : '';
}

function unitWeightKgFromItem(item) {
  const specs = item?.specifications && typeof item.specifications === 'object' ? item.specifications : {};
  const candidates = [specs.Weight, specs.weight, specs['Net weight'], specs['net weight']];
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const m = String(c).match(/(\d+(?:\.\d+)?)\s*(kg|kgs|kilogram|kilograms|g|gm|gram|grams)?/i);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    const unit = String(m[2] || 'kg').toLowerCase();
    if (unit === 'g' || unit === 'gm' || unit === 'gram' || unit === 'grams') return n / 1000;
    return n;
  }
  return null;
}

function computeGroupWeightKg(group) {
  const items = Array.isArray(group?.items) ? group.items : [];
  let sum = 0;
  for (const item of items) {
    const q = Math.max(0, Number(item.quantity) || 0);
    if (q <= 0) continue;
    const unitWeight = unitWeightKgFromItem(item);
    if (unitWeight === null) return null;
    sum += unitWeight * q;
  }
  return sum > 0 ? Math.round(sum * 1000) / 1000 : null;
}

/** Tatva Direct proxy: singular for one transport group, plural for multi-vendor / multi-delivery. */
export function resolveQuoteTransportPath(poGroups) {
  const count = Array.isArray(poGroups) ? poGroups.length : 0;
  return count === 1
    ? '/api/logistics/quote-transport-group'
    : '/api/logistics/quote-transport-groups';
}

export function buildTransportQuoteCacheKey({
  poGroups,
  shippingAddress,
  billingAddress,
  deliveryDestination,
  hasGstin
}) {
  const deliverForm =
    hasGstin && deliveryDestination === 'billing' ? billingAddress : shippingAddress;
  const deliveryPin = digitsPin6(deliverForm?.pincode);
  const groupPart = (Array.isArray(poGroups) ? poGroups : [])
    .map((g) => {
      const tgId = String(g.transportGroupId || g.vendorId || '').trim();
      const pickup = digitsPin6(g.pickupPincode || g.pickupAddress?.pincode);
      const weight = computeGroupWeightKg(g);
      return `${tgId}|${pickup}|${deliveryPin}|${weight ?? ''}`;
    })
    .sort()
    .join(';');
  const addrPart = [
    deliverForm?.line1,
    deliverForm?.city,
    deliverForm?.state,
    deliverForm?.country,
    deliveryPin
  ]
    .map((v) => String(v || '').trim())
    .join('|');
  return `${groupPart}::${addrPart}`;
}

function getCachedQuote(cacheKey) {
  const row = quoteCache.get(cacheKey);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    quoteCache.delete(cacheKey);
    return null;
  }
  return row.value;
}

function setCachedQuote(cacheKey, value) {
  if (!cacheKey || !value) return;
  if (quoteCache.size >= 100) {
    const oldest = quoteCache.keys().next().value;
    if (oldest) quoteCache.delete(oldest);
  }
  quoteCache.set(cacheKey, { expiresAt: Date.now() + QUOTE_CACHE_TTL_MS, value });
}

/**
 * Fetch transport quotes once per cache key; uses singular upstream route for single-group carts.
 */
export async function fetchTransportQuotes({
  poGroups,
  shippingAddress,
  billingAddress,
  deliveryDestination,
  hasGstin,
  signal,
  cacheKey: cacheKeyOverride = null
}) {
  const cacheKey =
    cacheKeyOverride ||
    buildTransportQuoteCacheKey({
      poGroups,
      shippingAddress,
      billingAddress,
      deliveryDestination,
      hasGstin
    });

  const cached = getCachedQuote(cacheKey);
  if (cached) return cached;

  const token = localStorage.getItem('token');
  const path = resolveQuoteTransportPath(poGroups);
  const res = await fetch(resolveApiPath(path), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      poGroups,
      shippingAddress,
      billingAddress,
      deliveryDestination,
      hasGstin
    }),
    signal
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || 'Failed to load transport options.');
    err.status = res.status;
    throw err;
  }

  setCachedQuote(cacheKey, data);
  return data;
}
