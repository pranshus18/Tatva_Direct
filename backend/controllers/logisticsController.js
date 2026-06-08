import express from 'express';
import { randomBytes } from 'node:crypto';
import {
  requireAuthentication as authenticateToken,
  requireServiceProviderOrSupplier as isServiceProviderOrSupplier
} from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import {
  getSupplierPickupMeta,
  applyPrimaryStreetLine,
  isPlaceholderStreetLine
} from '../utils/pickupPincode.js';
import { geocodeAddressNominatim } from '../utils/geoUtils.js';
import {
  inferLogisticsCategory,
  resolveShipmentQuoteStrategy,
  LOGISTICS_TRUCKING_MIN_WEIGHT_KG
} from '../utils/logisticsQuotePolicy.js';
import { classifyQuoteProvider, TRANSPORT_KIND } from '../utils/logisticsTransportIntent.js';

export { inferLogisticsCategory } from '../utils/logisticsQuotePolicy.js';

const router = express.Router();

const BRIDGE_TTL_MS = 10 * 60 * 1000;
const bridgeSessions = new Map();

const LOGISTICS_BASE = String(process.env.LOGISTICS_MODULE_URL || 'http://localhost:8001').replace(
  /\/$/,
  ''
);

const LOGISTICS_UPSTREAM_TIMEOUT_MS = Math.max(
  0,
  Number.parseInt(String(process.env.LOGISTICS_UPSTREAM_TIMEOUT_MS || '120000'), 10) || 0
);

const LOGISTICS_QUOTE_CACHE_TTL_MS = Math.max(
  0,
  (Number.parseInt(String(process.env.LOGISTICS_QUOTE_CACHE_TTL_SEC || '120'), 10) || 0) * 1000
);

const LOGISTICS_QUOTE_CACHE_MAX = Math.min(
  500,
  Math.max(20, Number.parseInt(String(process.env.LOGISTICS_QUOTE_CACHE_MAX || '200'), 10) || 200)
);

/** Transient gateway / upstream overload (common after deploy or cold start on hosted logistics). */
const LOGISTICS_UPSTREAM_MAX_RETRIES = Math.min(
  5,
  Math.max(1, Number.parseInt(String(process.env.LOGISTICS_UPSTREAM_MAX_RETRIES || '3'), 10) || 3)
);
const RETRYABLE_UPSTREAM_HTTP = new Set([502, 503, 504]);

const logisticsQuoteCache = new Map();
let loggedServiceProvidersApiVersion = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerFare(p = {}) {
  const raw = p.fare_value ?? p.estimated_fare ?? p.rate ?? null;
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : raw;
}

function normalizeProviderForUi(p = {}) {
  const row = { ...p };
  const kind = classifyQuoteProvider(row);
  if (kind === TRANSPORT_KIND.TRUCKING) {
    row.transportKind = TRANSPORT_KIND.TRUCKING;
    row.rate = providerFare(row);
  } else if (kind === TRANSPORT_KIND.COURIER) {
    row.transportKind = TRANSPORT_KIND.COURIER;
    row.rate = row.rate ?? providerFare(row);
  }
  return row;
}

function cloneLogistics(value) {
  return {
    success: Boolean(value?.success),
    mode: value?.mode || 'courier',
    requestedMode: value?.requestedMode ?? value?.requested_mode ?? null,
    modeRecommendation: value?.modeRecommendation ?? value?.mode_recommendation ?? null,
    message: value?.message ?? null,
    quoteNote: value?.quoteNote ?? null,
    intercity: value?.intercity ?? null,
    filteredCount: value?.filteredCount ?? value?.filtered_count ?? null,
    providers: Array.isArray(value?.providers)
      ? value.providers.map((p) => normalizeProviderForUi(p))
      : []
  };
}

function inferMatterFromGroup(group) {
  const items = Array.isArray(group?.items) ? group.items : [];
  const names = items.map((i) => String(i?.name || '').trim()).filter(Boolean);
  if (names.length === 0) return null;
  return names.slice(0, 3).join(', ').slice(0, 500);
}

function parseVolumeCbmFromGroup(group) {
  const items = Array.isArray(group?.items) ? group.items : [];
  let sum = 0;
  for (const item of items) {
    const specs =
      item?.specifications && typeof item.specifications === 'object' ? item.specifications : {};
    const q = Math.max(0, Number(item.quantity) || 0);
    for (const [k, v] of Object.entries(specs)) {
      if (!String(k).toLowerCase().includes('volume') && !String(k).toLowerCase().includes('cbm')) continue;
      const m = String(v).match(/(\d+(?:\.\d+)?)/);
      if (m) sum += parseFloat(m[1]) * (q || 1);
    }
  }
  return sum > 0 ? Math.round(sum * 1000) / 1000 : 0;
}

function addressGeocodeText(addr) {
  if (!addr || typeof addr !== 'object') return '';
  return [addr.line1, addr.city, addr.state, addr.pincode, addr.country].filter(Boolean).join(', ');
}

const geoCache = new Map();

async function resolveCoordsForAddress(addr, cacheKey) {
  const key = cacheKey || addressGeocodeText(addr);
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key);
  const geo = await geocodeAddressNominatim(key);
  geoCache.set(key, geo);
  return geo;
}

function logisticsQuoteCacheGet(cacheKey) {
  const row = logisticsQuoteCache.get(cacheKey);
  if (!row) return null;
  if (row.expiresAt <= Date.now()) {
    logisticsQuoteCache.delete(cacheKey);
    return null;
  }
  return cloneLogistics(row.value);
}

function logisticsQuoteCacheSet(cacheKey, logistics) {
  const ok =
    logistics &&
    (Boolean(logistics.success) ||
      (Array.isArray(logistics.providers) && logistics.providers.length > 0));
  if (!ok) return;
  if (logisticsQuoteCache.size >= LOGISTICS_QUOTE_CACHE_MAX) {
    const oldest = logisticsQuoteCache.keys().next().value;
    if (oldest) logisticsQuoteCache.delete(oldest);
  }
  logisticsQuoteCache.set(cacheKey, {
    expiresAt: Date.now() + LOGISTICS_QUOTE_CACHE_TTL_MS,
    value: cloneLogistics(logistics)
  });
}

/**
 * Parses the first top-level JSON object from a body string.
 * Ignores trailing garbage (e.g. corrupted streams or accidental concatenation upstream).
 */
function parseFirstJsonObject(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    /* trailing/non-JSON suffix: scan for first balanced `{ ... }` */
  }
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        const chunk = s.slice(start, i + 1);
        try {
          return JSON.parse(chunk);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeAddress(address = {}) {
  return {
    line1: String(address?.line1 || address?.street || '').trim(),
    city: String(address?.city || '').trim(),
    state: String(address?.state || '').trim(),
    pincode: String(
      address?.pincode ||
        address?.zipCode ||
        address?.postalCode ||
        address?.postal_code ||
        ''
    ).trim(),
    country: String(address?.country || '').trim()
  };
}

const ADDRESS_REQUIRED_FIELDS = ['line1', 'city', 'state', 'pincode', 'country'];

function isAddressComplete(address = {}) {
  return ADDRESS_REQUIRED_FIELDS.every((field) => String(address?.[field] || '').trim());
}

function digitsPin6(value) {
  const d = String(value || '').replace(/\D/g, '').slice(0, 6);
  return d.length === 6 ? d : '';
}

function parseKgFromText(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (m) return parseFloat(m[1]);
  const n = parseFloat(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unitWeightKgFromItem(item) {
  const specs = item?.specifications && typeof item.specifications === 'object' ? item.specifications : {};
  const candidates = [
    specs.Weight,
    specs.weight,
    specs['Net weight'],
    specs['net weight'],
    specs['Gross weight'],
    specs['gross weight']
  ];
  for (const c of candidates) {
    const w = parseKgFromText(c);
    if (w !== null) return w;
  }
  for (const [k, v] of Object.entries(specs)) {
    if (!k || String(k).toLowerCase().includes('weight')) {
      const w = parseKgFromText(v);
      if (w !== null) return w;
    }
  }
  return null;
}

export function computeGroupWeightKg(group) {
  const items = Array.isArray(group?.items) ? group.items : [];
  let sum = 0;
  for (const item of items) {
    const q = Math.max(0, Number(item.quantity) || 0);
    if (q <= 0) continue;
    const unitWeight = unitWeightKgFromItem(item);
    if (unitWeight === null) return null;
    sum += unitWeight * q;
  }
  if (sum <= 0) return null;
  return Math.round(sum * 1000) / 1000;
}

/**
 * Fresh supplier ship-from from Supabase. Used when the client omits `pickupAddress`, has no PIN,
 * or still carries a signup placeholder in `line1` while `pickupPincode` / summary were filled.
 */
async function loadFallbackSupplierPickupMeta(poGroups) {
  const needVendorIds = new Set();
  for (const g of poGroups || []) {
    if (!g?.vendorId) continue;
    const hasPin =
      digitsPin6(g?.pickupAddress?.pincode) ||
      digitsPin6(g?.pickupPincode);
    const addr = g.pickupAddress && typeof g.pickupAddress === 'object' ? g.pickupAddress : null;
    const line1 = String(addr?.line1 || '').trim();
    const missingStructuredAddress = !addr;
    const missingLine = !line1;
    const placeholderLine = line1 && isPlaceholderStreetLine(line1);
    if (!hasPin || missingStructuredAddress || missingLine || placeholderLine) {
      needVendorIds.add(g.vendorId);
    }
  }
  const ids = [...needVendorIds];
  const map = {};
  if (ids.length === 0) return map;
  const { data: rows } = await supabase
    .from('users')
    .select('id, address, profile')
    .in('id', ids)
    .eq('user_type', 'supplier');
  for (const row of rows || []) {
    map[row.id] = getSupplierPickupMeta(row);
  }
  return map;
}

function resolveGroupPickupMeta(group, fallbackMeta) {
  let pin =
    digitsPin6(group?.pickupAddress?.pincode) ||
    digitsPin6(group?.pickupPincode) ||
    (fallbackMeta?.pincode ? String(fallbackMeta.pincode) : '') ||
    '';

  let pickupAddress =
    group.pickupAddress && typeof group.pickupAddress === 'object'
      ? {
          line1: String(group.pickupAddress.line1 || '').trim(),
          city: String(group.pickupAddress.city || '').trim(),
          state: String(group.pickupAddress.state || '').trim(),
          country: String(group.pickupAddress.country || '').trim(),
          pincode: pin || digitsPin6(group.pickupAddress.pincode)
        }
      : null;

  const useFallbackPickup =
    fallbackMeta?.pickupAddress &&
    (!pickupAddress ||
      !String(pickupAddress.line1 || '').trim() ||
      isPlaceholderStreetLine(pickupAddress.line1));

  if (useFallbackPickup) {
    pickupAddress = {
      line1: String(fallbackMeta.pickupAddress.line1 || '').trim(),
      city: String(fallbackMeta.pickupAddress.city || '').trim(),
      state: String(fallbackMeta.pickupAddress.state || '').trim(),
      country: String(fallbackMeta.pickupAddress.country || '').trim(),
      pincode: pin || String(fallbackMeta.pickupAddress.pincode || '')
    };
  }

  if (!pin && pickupAddress) {
    pin = digitsPin6(pickupAddress.pincode);
  }
  if (pickupAddress && pin) {
    pickupAddress = { ...pickupAddress, pincode: pin };
  }

  const summary =
    String(group.pickupAddressSummary || '').trim() ||
    String(fallbackMeta?.summary || '').trim() ||
    '';

  return { pincode: pin, pickupAddress, summary };
}

function resolveDeliveryPincode(body) {
  const ship = normalizeAddress(body.shippingAddress || {});
  const bill = normalizeAddress(body.billingAddress || {});
  const dest = String(body.deliveryDestination || 'shipping').toLowerCase().trim();
  const useBilling = Boolean(body.hasGstin) && dest === 'billing';
  const addr = useBilling ? bill : ship;
  return { deliveryAddr: addr, deliveryPincode: digitsPin6(addr.pincode), useBilling };
}

function buildServiceProvidersBody({
  mode,
  category,
  supplierId,
  pickupPincode,
  deliveryPincode,
  weightKg,
  matter,
  totalVolumeCbm,
  pickupGeo,
  deliveryGeo,
  pickupAddress,
  deliveryAddress
}) {
  const body = {
    mode,
    category,
    pickup_pincode: pickupPincode,
    delivery_pincode: deliveryPincode,
    weight_kg: weightKg,
    total_volume_cbm: totalVolumeCbm
  };
  if (matter) body.matter = matter;
  if (pickupGeo && Number.isFinite(pickupGeo.lat) && Number.isFinite(pickupGeo.lng)) {
    body.pickup_lat = pickupGeo.lat;
    body.pickup_lng = pickupGeo.lng;
  }
  if (deliveryGeo && Number.isFinite(deliveryGeo.lat) && Number.isFinite(deliveryGeo.lng)) {
    body.delivery_lat = deliveryGeo.lat;
    body.delivery_lng = deliveryGeo.lng;
  }
  if (supplierId) body.supplier_id = String(supplierId);
  if (pickupAddress?.line1 && pickupPincode) {
    body.pickup_address = {
      line1: pickupAddress.line1,
      city: pickupAddress.city || '',
      state: pickupAddress.state || '',
      country: pickupAddress.country || '',
      pincode: pickupPincode
    };
  }
  if (deliveryAddress?.line1 && deliveryPincode) {
    body.delivery_address = {
      line1: deliveryAddress.line1,
      city: deliveryAddress.city || '',
      state: deliveryAddress.state || '',
      country: deliveryAddress.country || '',
      pincode: deliveryPincode
    };
  }
  return body;
}

async function postServiceProvidersUpstream(body) {
  let r = null;
  let raw = '';
  let json = {};

  for (let attempt = 1; attempt <= LOGISTICS_UPSTREAM_MAX_RETRIES; attempt++) {
    const fetchOpts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    };
    if (LOGISTICS_UPSTREAM_TIMEOUT_MS > 0) {
      fetchOpts.signal = AbortSignal.timeout(LOGISTICS_UPSTREAM_TIMEOUT_MS);
    }

    r = await fetch(`${LOGISTICS_BASE}/api/logistics/service-providers`, fetchOpts);
    raw = await r.text();
    json = parseFirstJsonObject(raw) || {};

    const retryable = !r.ok && RETRYABLE_UPSTREAM_HTTP.has(r.status);
    if (!retryable || attempt >= LOGISTICS_UPSTREAM_MAX_RETRIES) break;

    await delay(450 * attempt);
  }

  return { r, raw, json };
}

function intracityUserMessage(rawMsg) {
  const m = String(rawMsg || '').toLowerCase();
  return (
    m.includes('intracity') ||
    m.includes('intra-city') ||
    m.includes('intra city') ||
    m.includes('same-city') ||
    m.includes('same city')
  );
}

function mapUpstreamQuoteResponse({ r, raw, json }, meta = {}) {
  const apiVersion = json.api_version ?? json.apiVersion ?? null;
  if (apiVersion && !loggedServiceProvidersApiVersion) {
    loggedServiceProvidersApiVersion = true;
    console.info('[logistics] service-providers api_version:', apiVersion);
  }

  const logistics = {
    success: Boolean(json.success),
    mode: json.mode || 'courier',
    requestedMode: json.requested_mode || meta.requestedMode || 'auto',
    modeRecommendation: json.mode_recommendation || null,
    message: json.message ?? null,
    filteredCount: json.filtered_count ?? null,
    quoteNote: meta.quoteNote ?? null,
    intercity: meta.intercity ?? null,
    sameCity: meta.sameCity ?? null,
    apiVersion,
    providers: Array.isArray(json.providers)
      ? json.providers.map((p) => normalizeProviderForUi(p))
      : []
  };

  const upstreamText = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  const upstreamMsg =
    upstreamText(json.message) ||
    upstreamText(json.error) ||
    (Array.isArray(json.errors)
      ? json.errors.map((e) => upstreamText(e?.message || e)).filter(Boolean).join('; ')
      : '') ||
    upstreamText(json.detail);

  if (!r.ok) {
    logistics.success = false;
    logistics.providers = [];
    const transient = RETRYABLE_UPSTREAM_HTTP.has(r.status);
    logistics.message =
      upstreamMsg ||
      (raw.length > 0 && raw.length < 500 && !raw.trimStart().startsWith('<')
        ? `Logistics API HTTP ${r.status}: ${raw.trim().slice(0, 400)}`
        : transient
          ? `Logistics service returned HTTP ${r.status} after ${LOGISTICS_UPSTREAM_MAX_RETRIES} attempt(s). This is usually a temporary gateway issue (cold start, restart, or overload on the logistics host). Wait 15–30 seconds and refresh, or verify LOGISTICS_MODULE_URL points at a healthy deployment.`
          : `Logistics API returned HTTP ${r.status}. Check LOGISTICS_MODULE_URL and upstream logs.`);
  } else if (!logistics.message && upstreamMsg) {
    logistics.message = upstreamMsg;
  }

  if (
    !logistics.success &&
    (!logistics.providers || logistics.providers.length === 0) &&
    intracityUserMessage(upstreamMsg || logistics.message)
  ) {
    logistics.message =
      'Trucking available for same-city delivery only; use courier or contact ops for intercity.';
  } else if (
    !logistics.success &&
    (!logistics.providers || logistics.providers.length === 0) &&
    !logistics.message
  ) {
    logistics.message =
      'No transport quotes were returned (success=false or empty providers). Typical causes: logistics account not linked, invalid tokens, weight above vehicle capacity, or no service on this pickup→delivery lane.';
  }

  const fc = Number(json.filtered_count);
  if (
    !logistics.success &&
    Number.isFinite(fc) &&
    fc > 0 &&
    (!logistics.providers || logistics.providers.length === 0)
  ) {
    const w = Number(json.weight_kg) || meta.weightKg;
    logistics.message =
      logistics.message ||
      `No vehicles met capacity for ${w} kg (${fc} option(s) filtered out). Try splitting the order or use courier if under ${LOGISTICS_TRUCKING_MIN_WEIGHT_KG} kg per lane.`;
  }

  return logistics;
}

async function fetchLogisticsQuoteForShipment({
  supplierId,
  pickupPincode,
  deliveryPincode,
  weightKg,
  pickupAddress,
  deliveryAddress,
  category = 'general',
  matter = null,
  totalVolumeCbm = 0,
  pickupGeo = null,
  deliveryGeo = null,
  quoteStrategy = null
}) {
  let logistics = { success: false, mode: 'courier', message: null, providers: [] };

  const strategy =
    quoteStrategy ||
    resolveShipmentQuoteStrategy({
      weightKg,
      category,
      pickupPincode,
      deliveryPincode,
      pickupCity: pickupAddress?.city || null,
      deliveryCity: deliveryAddress?.city || null,
      pickupGeo,
      deliveryGeo
    });

  const body = buildServiceProvidersBody({
    mode: strategy.mode,
    category: strategy.category || category,
    supplierId,
    pickupPincode,
    deliveryPincode,
    weightKg,
    matter,
    totalVolumeCbm,
    pickupGeo,
    deliveryGeo,
    pickupAddress,
    deliveryAddress
  });

  const quoteCacheKey =
    LOGISTICS_QUOTE_CACHE_TTL_MS > 0 ? `${LOGISTICS_BASE}\n${JSON.stringify(body)}` : '';

  if (quoteCacheKey) {
    const hit = logisticsQuoteCacheGet(quoteCacheKey);
    if (hit) return hit;
  }

  try {
    const first = await postServiceProvidersUpstream(body);
    logistics = mapUpstreamQuoteResponse(first, {
      requestedMode: strategy.mode,
      quoteNote: strategy.quoteNote,
      intercity: strategy.intercity,
      sameCity: strategy.sameCity,
      weightKg
    });

    const truckingEmpty =
      strategy.allowCourierFallback &&
      !strategy.intercity &&
      strategy.mode !== 'courier' &&
      (!logistics.success || logistics.providers.length === 0) &&
      (logistics.mode === 'trucking' || strategy.mode === 'auto');

    if (truckingEmpty) {
      const courierBody = buildServiceProvidersBody({
        mode: 'courier',
        category: strategy.category || category,
        supplierId,
        pickupPincode,
        deliveryPincode,
        weightKg,
        matter,
        totalVolumeCbm,
        pickupGeo,
        deliveryGeo,
        pickupAddress,
        deliveryAddress
      });
      const second = await postServiceProvidersUpstream(courierBody);
      const courierLogistics = mapUpstreamQuoteResponse(second, {
        requestedMode: 'courier',
        intercity: strategy.intercity,
        weightKg,
        quoteNote:
          'Trucking had no suitable vehicles for this weight or lane; showing courier (Shiprocket) options instead.'
      });
      if (courierLogistics.success && courierLogistics.providers.length > 0) {
        logistics = courierLogistics;
      } else if (!logistics.message && courierLogistics.message) {
        logistics.message = courierLogistics.message;
      }
    }

    if (quoteCacheKey) logisticsQuoteCacheSet(quoteCacheKey, logistics);
  } catch (e) {
    const name = String(e?.name || '');
    if (name === 'TimeoutError' || name === 'AbortError') {
      const sec = LOGISTICS_UPSTREAM_TIMEOUT_MS > 0 ? Math.round(LOGISTICS_UPSTREAM_TIMEOUT_MS / 1000) : 0;
      logistics.message = sec
        ? `Courier quote timed out after ${sec}s (Shiprocket / logistics host is slow or cold). Retry, or set LOGISTICS_UPSTREAM_TIMEOUT_MS in backend .env (e.g. 180000 for 3 minutes).`
        : 'Courier quote request was aborted.';
    } else {
      const errMsg = e?.cause?.code || e?.code || e?.message || '';
      const hint =
        /ECONNREFUSED|fetch failed|ENOTFOUND|ETIMEDOUT/i.test(String(errMsg)) ||
        String(e?.message || '').toLowerCase().includes('fetch')
          ? ' Is LOGISTICS_MODULE_URL correct and is the logistics API reachable from this server?'
          : '';
      logistics.message = `${e?.message || 'Logistics service unreachable'}.${hint}`;
    }
  }
  return logistics;
}

async function fetchCourierQuotes({ deliveryPincode, deliveryAddr, poGroups }) {
  const fallbackMetaByVendor = await loadFallbackSupplierPickupMeta(poGroups);

  const deliveryAddressPayload = applyPrimaryStreetLine({
    line1: deliveryAddr.line1,
    city: deliveryAddr.city,
    state: deliveryAddr.state,
    country: deliveryAddr.country,
    pincode: deliveryPincode
  });

  const deliveryGeo = await resolveCoordsForAddress(
    deliveryAddressPayload,
    `delivery|${deliveryPincode}|${addressGeocodeText(deliveryAddressPayload)}`
  );

  /** Same supplier + lane + weight → one upstream HTTP call */
  const laneQuoteCache = new Map();

  const getCachedLaneQuote = (laneKey, runFetch) => {
    let p = laneQuoteCache.get(laneKey);
    if (!p) {
      p = runFetch();
      laneQuoteCache.set(laneKey, p);
    }
    return p;
  };

  const shipments = await Promise.all(
    (poGroups || []).map(async (group) => {
      const vendorId = group.vendorId;
      const fallback = vendorId ? fallbackMetaByVendor[vendorId] : null;
      const resolved = resolveGroupPickupMeta(group, fallback);
      const pickupPincode = resolved.pincode;
      let pickupAddress = resolved.pickupAddress;
      if (pickupAddress) {
        pickupAddress = applyPrimaryStreetLine(pickupAddress);
        if (pickupPincode) pickupAddress = { ...pickupAddress, pincode: pickupPincode };
      }
      const summaryParts = [pickupAddress?.line1, pickupAddress?.city, pickupAddress?.state].filter(Boolean);
      const summary =
        pickupPincode && summaryParts.length
          ? `${summaryParts.join(', ')} · PIN ${pickupPincode}`
          : resolved.summary;
      const weightKg = computeGroupWeightKg(group);
      const category = weightKg === null ? 'general' : inferLogisticsCategory(group, weightKg);
      const matter = inferMatterFromGroup(group);
      const totalVolumeCbm = parseVolumeCbmFromGroup(group);

      let pickupGeo = null;
      if (pickupAddress) {
        pickupGeo = await resolveCoordsForAddress(
          pickupAddress,
          `pickup|${vendorId || ''}|${pickupPincode}|${addressGeocodeText(pickupAddress)}`
        );
      }

      const quoteStrategyWithCoords = resolveShipmentQuoteStrategy({
        weightKg,
        category,
        pickupPincode,
        deliveryPincode,
        pickupCity: pickupAddress?.city || null,
        deliveryCity: deliveryAddressPayload?.city || null,
        pickupGeo,
        deliveryGeo
      });

      let logistics = { success: false, mode: 'courier', message: null, providers: [] };

      if (!pickupPincode) {
        logistics.message =
          'Supplier warehouse pincode is missing. Ask the supplier to complete their profile or outlet address (PIN / postal code).';
      } else if (weightKg === null) {
        logistics.message =
          'Product weight is required for logistics quotes. Add valid weight in item specifications (for example: "Weight: 25 kg"), then retry.';
      } else {
        const laneKey = `${vendorId || ''}|${pickupPincode}|${deliveryPincode}|${weightKg}|${quoteStrategyWithCoords.mode}|${quoteStrategyWithCoords.category}|${totalVolumeCbm}|${quoteStrategyWithCoords.sameCity}`;
        logistics = await getCachedLaneQuote(laneKey, () =>
          fetchLogisticsQuoteForShipment({
            supplierId: vendorId,
            pickupPincode,
            deliveryPincode,
            weightKg,
            pickupAddress,
            deliveryAddress: deliveryAddressPayload,
            category,
            matter,
            totalVolumeCbm,
            pickupGeo,
            deliveryGeo,
            quoteStrategy: quoteStrategyWithCoords
          })
        );
      }

      return {
        vendorId,
        vendorName: group.vendorName,
        pickupPincode,
        pickupAddressSummary: summary,
        pickupAddress: pickupAddress || null,
        pickupOutletId: group.pickupOutletId || null,
        pickupOutletName: group.pickupOutletName || null,
        pickupLat: pickupGeo?.lat ?? null,
        pickupLng: pickupGeo?.lng ?? null,
        deliveryLat: deliveryGeo?.lat ?? null,
        deliveryLng: deliveryGeo?.lng ?? null,
        deliveryPincode,
        weightKg,
        category,
        intercity: quoteStrategyWithCoords.intercity,
        sameCity: quoteStrategyWithCoords.sameCity,
        heavy: quoteStrategyWithCoords.heavy,
        quoteMode: quoteStrategyWithCoords.mode,
        items: Array.isArray(group.items) ? group.items : [],
        logistics
      };
    })
  );

  const deliveryAddressUsed = {
    line1: deliveryAddressPayload.line1,
    city: deliveryAddressPayload.city,
    state: deliveryAddressPayload.state,
    country: deliveryAddressPayload.country,
    pincode: deliveryPincode
  };

  return { shipments, deliveryAddressUsed };
}

router.options('/bridge-session/:id', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

router.get('/bridge-session/:id', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const now = Date.now();
  for (const [k, v] of bridgeSessions) {
    if (v.expiresAt < now) bridgeSessions.delete(k);
  }
  const row = bridgeSessions.get(req.params.id);
  if (!row || row.expiresAt < now) {
    return res.status(404).json({ status: 'error', message: 'Session expired or not found' });
  }
  bridgeSessions.delete(req.params.id);
  res.json({
    deliveryPincode: row.payload.deliveryPincode,
    deliveryAddress: row.payload.deliveryAddress || null,
    shipments: row.payload.shipments
  });
});

router.post(
  '/bridge-session',
  authenticateToken,
  isServiceProviderOrSupplier,
  async (req, res) => {
    try {
      const body = req.body || {};
      const { poGroups } = body;
      if (!Array.isArray(poGroups) || poGroups.length === 0) {
        return res.status(400).json({ status: 'error', message: 'poGroups array is required' });
      }

      const { deliveryAddr, deliveryPincode } = resolveDeliveryPincode(body);
      if (!isAddressComplete(deliveryAddr) || !deliveryPincode) {
        return res.status(400).json({
          status: 'error',
          message: 'Complete delivery address with a valid 6-digit pincode is required for logistics quotes.'
        });
      }

      const result = await fetchCourierQuotes({ deliveryPincode, deliveryAddr, poGroups });
      const id = randomBytes(24).toString('hex');
      bridgeSessions.set(id, {
        expiresAt: Date.now() + BRIDGE_TTL_MS,
        payload: {
          deliveryPincode,
          deliveryAddress: result.deliveryAddressUsed,
          shipments: result.shipments
        }
      });

      res.json({
        sessionId: id,
        expiresInSeconds: Math.floor(BRIDGE_TTL_MS / 1000)
      });
    } catch (error) {
      console.error('[logistics] bridge-session error:', error);
      res.status(500).json({
        status: 'error',
        message: error?.message || 'Failed to create logistics bridge session'
      });
    }
  }
);

router.post(
  '/service-providers',
  authenticateToken,
  isServiceProviderOrSupplier,
  async (req, res) => {
    try {
      const body = req.body || {};
      const { poGroups } = body;
      if (!Array.isArray(poGroups) || poGroups.length === 0) {
        return res.status(400).json({ status: 'error', message: 'poGroups array is required' });
      }

      const { deliveryAddr, deliveryPincode } = resolveDeliveryPincode(body);
      if (!isAddressComplete(deliveryAddr) || !deliveryPincode) {
        return res.status(400).json({
          status: 'error',
          message: 'Complete delivery address with a valid 6-digit pincode is required for logistics quotes.'
        });
      }

      const result = await fetchCourierQuotes({ deliveryPincode, deliveryAddr, poGroups });
      res.json({
        deliveryPincode,
        deliveryAddress: result.deliveryAddressUsed,
        shipments: result.shipments
      });
    } catch (error) {
      console.error('[logistics] service-providers error:', error);
      res.status(500).json({
        status: 'error',
        message: error?.message || 'Failed to load service providers'
      });
    }
  }
);

export { router as logisticsRouter };
