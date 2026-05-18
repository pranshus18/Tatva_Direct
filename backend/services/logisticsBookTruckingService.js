/**
 * Borzo / trucking booking against Tatva logistics module.
 * POST ${LOGISTICS_MODULE_URL}/carrier/trucking-book
 * Called from transport/confirm when the user selected a Borzo / trucking quote.
 */

const LOGISTICS_BASE = String(process.env.LOGISTICS_MODULE_URL || 'http://localhost:8001').replace(
  /\/$/,
  ''
);

function truckingBookUrl() {
  const explicit = String(process.env.LOGISTICS_BOOK_TRUCKING_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  return `${LOGISTICS_BASE}/carrier/trucking-book`;
}

const BOOK_TIMEOUT_MS = Math.max(
  0,
  Number.parseInt(String(process.env.LOGISTICS_BOOK_TIMEOUT_MS || '120000'), 10) || 0
);

const BOOK_MAX_RETRIES = Math.min(
  5,
  Math.max(1, Number.parseInt(String(process.env.LOGISTICS_BOOK_MAX_RETRIES || '2'), 10) || 2)
);

const RETRYABLE = new Set([502, 503, 504]);

const bookDebugEnabled =
  String(process.env.LOGISTICS_BOOK_DEBUG || '').toLowerCase() === 'true';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickStr(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

function pickNum(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function extractTruckingBookingTracking(json) {
  if (!json || typeof json !== 'object') {
    return {
      trackingNumber: null,
      trackingUrl: null,
      shippingProvider: null,
      borzoOrderId: null,
      pendingReason: null
    };
  }
  const layer =
    json.data && typeof json.data === 'object' && !Array.isArray(json.data) ? json.data : json;
  return {
    trackingNumber: pickStr(
      layer.order_id,
      layer.orderId,
      layer.tracking_number,
      layer.trackingNumber,
      json.order_id,
      json.orderId
    ),
    trackingUrl: pickStr(layer.tracking_url, layer.trackingUrl, json.tracking_url, json.trackingUrl),
    shippingProvider: pickStr(
      layer.shipping_provider,
      layer.shippingProvider,
      layer.carrier_label,
      layer.vehicle_name,
      json.shipping_provider
    ),
    borzoOrderId: pickStr(layer.order_id, layer.orderId, json.order_id),
    pendingReason: pickStr(layer.message, layer.error, json.message)
  };
}

async function postJson(url, body) {
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
  if (BOOK_TIMEOUT_MS > 0) {
    opts.signal = AbortSignal.timeout(BOOK_TIMEOUT_MS);
  }
  let lastErr = null;
  for (let attempt = 1; attempt <= BOOK_MAX_RETRIES; attempt++) {
    try {
      const r = await fetch(url, opts);
      const raw = await r.text();
      let json = {};
      try {
        json = raw ? JSON.parse(raw) : {};
      } catch {
        json = {};
      }
      return { ok: r.ok, status: r.status, json, raw };
    } catch (e) {
      lastErr = e;
      if (attempt < BOOK_MAX_RETRIES) await delay(400 * attempt);
    }
  }
  throw lastErr || new Error('Trucking booking request failed');
}

function formatUpstreamError(detail) {
  if (detail == null) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && typeof d === 'object' ? d.msg || d.message || JSON.stringify(d) : String(d)))
      .filter(Boolean)
      .join('; ');
  }
  if (typeof detail === 'object') return JSON.stringify(detail).slice(0, 500);
  return String(detail);
}

/**
 * @returns {Promise<{
 *   trackingNumber: string|null,
 *   trackingUrl: string|null,
 *   shippingProvider: string|null,
 *   borzoOrderId: string|null,
 *   pendingReason: string|null,
 *   debug?: object
 * }>}
 */
export async function bookTrucking({
  vehicleTypeId = null,
  carrier = 'Borzo',
  pickupLat,
  pickupLng,
  deliveryLat,
  deliveryLng,
  contactPhone,
  weightKg,
  matter = null,
  displayName = null
}) {
  const plat = Number(pickupLat);
  const plng = Number(pickupLng);
  const dlat = Number(deliveryLat);
  const dlng = Number(deliveryLng);
  if (![plat, plng, dlat, dlng].every((n) => Number.isFinite(n))) {
    throw new Error('Pickup and delivery coordinates are required for trucking booking');
  }

  let digits = String(contactPhone || '').replace(/\D/g, '');
  if (digits.length >= 12 && digits.startsWith('91')) digits = digits.slice(-10);
  else if (digits.length > 10) digits = digits.slice(-10);
  const phone =
    digits.length === 10 && /^[6-9]\d{9}$/.test(digits) ? digits : '9876543210';

  const body = {
    carrier: String(carrier || 'Borzo').trim() || 'Borzo',
    pickup_lat: plat,
    pickup_lng: plng,
    delivery_lat: dlat,
    delivery_lng: dlng,
    contact_phone: phone,
    weight_kg: Number(weightKg) > 0 ? Number(weightKg) : 1
  };
  const vid = Number(vehicleTypeId);
  if (Number.isFinite(vid) && vid > 0) {
    body.vehicle_type_id = vid;
  }
  const m = pickStr(matter);
  if (m) body.matter = m.slice(0, 500);

  let res = await postJson(truckingBookUrl(), body);
  if (!res.ok && RETRYABLE.has(res.status)) {
    await delay(500);
    res = await postJson(truckingBookUrl(), body);
  }

  if (!res.ok) {
    const msg =
      res.json?.message ||
      formatUpstreamError(res.json?.detail) ||
      res.raw?.slice(0, 500) ||
      `Trucking booking HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  const extracted = extractTruckingBookingTracking(res.json);
  let shippingProvider = extracted.shippingProvider;
  const dn = pickStr(displayName);
  if (dn && !shippingProvider) shippingProvider = dn;
  if (dn && shippingProvider && !shippingProvider.includes(dn)) {
    shippingProvider = dn;
  }

  const out = {
    trackingNumber: extracted.trackingNumber,
    trackingUrl: extracted.trackingUrl,
    shippingProvider,
    borzoOrderId: extracted.borzoOrderId,
    pendingReason: extracted.pendingReason
  };

  if (bookDebugEnabled) {
    out.debug = {
      requestUrl: truckingBookUrl(),
      requestBody: body,
      upstreamStatus: res.status,
      upstreamJson: res.json
    };
  }

  return out;
}
