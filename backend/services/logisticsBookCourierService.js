/**
 * Last-mile booking against Tatva logistics.
 * 1) POST {LOGISTICS_MODULE_URL}/api/logistics/book-courier-checkout (canonical)
 * 2) If that returns 404 and legacy fallback is allowed, POST .../carrier/book (current Render API)
 *
 * Set LOGISTICS_BOOK_DISABLE_LEGACY_FALLBACK=true when book-courier-checkout is deployed and you
 * want to never call /carrier/book.
 */

const LOGISTICS_BASE = String(process.env.LOGISTICS_MODULE_URL || 'http://localhost:8001').replace(
  /\/$/,
  ''
);

const BOOK_TIMEOUT_MS = Math.max(
  0,
  Number.parseInt(String(process.env.LOGISTICS_BOOK_TIMEOUT_MS || '120000'), 10) || 0
);

const BOOK_MAX_RETRIES = Math.min(
  5,
  Math.max(1, Number.parseInt(String(process.env.LOGISTICS_BOOK_MAX_RETRIES || '2'), 10) || 2)
);

const RETRYABLE = new Set([502, 503, 504]);

const disableLegacy404Fallback =
  String(process.env.LOGISTICS_BOOK_DISABLE_LEGACY_FALLBACK || '').toLowerCase() === 'true';

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

/**
 * Read tracking fields from the book-courier-checkout JSON body (top level only).
 */
export function extractBookingTracking(json) {
  if (!json || typeof json !== 'object') {
    return { trackingNumber: null, trackingUrl: null, shippingProvider: null };
  }
  return {
    trackingNumber: pickStr(json.tracking_number, json.trackingNumber),
    trackingUrl: pickStr(json.tracking_url, json.trackingUrl),
    shippingProvider: pickStr(json.shipping_provider, json.shippingProvider)
  };
}

/**
 * /carrier/book returns Shiprocket progress inside data[0].text (JSON string). Parse that layer only.
 */
function extractLegacyCarrierBookTracking(json) {
  if (!json || typeof json !== 'object') {
    return { trackingNumber: null, trackingUrl: null, shippingProvider: null };
  }
  let inner = json;
  const t = json?.data?.[0]?.text;
  if (typeof t === 'string') {
    try {
      const parsed = JSON.parse(t);
      if (parsed && typeof parsed === 'object') inner = parsed;
    } catch {
      inner = {};
    }
  }
  const fromInner = extractBookingTracking(inner);
  if (fromInner.trackingNumber || fromInner.trackingUrl || fromInner.shippingProvider) {
    return fromInner;
  }
  return {
    trackingNumber: pickStr(
      inner.awb_tracking_number,
      inner.awb_code,
      inner.awb,
      inner.tracking_number,
      inner.tracking_no
    ),
    trackingUrl: pickStr(inner.tracking_url, inner.awb_url, inner.track_url),
    shippingProvider: pickStr(inner.shipping_provider, inner.courier_name, inner.carrier_name)
  };
}

function formatUpstreamBookError(detail) {
  if (detail == null) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => (d && typeof d === 'object' ? d.msg || d.message : null) || JSON.stringify(d))
      .filter(Boolean)
      .join('; ');
  }
  if (typeof detail === 'object') return JSON.stringify(detail).slice(0, 500);
  return String(detail);
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
  throw lastErr || new Error('Logistics booking request failed');
}

const BOOK_CHECKOUT_URL = () => `${LOGISTICS_BASE}/api/logistics/book-courier-checkout`;
const BOOK_CARRIER_URL = () => `${LOGISTICS_BASE}/carrier/book`;

/**
 * @param {object} params
 * @param {number} params.courierCompanyId
 * @param {object} params.deliveryAddress — { line1, city, state, country, pincode }
 * @param {object} params.sessionBuyer
 * @param {Array<object>} params.lines
 * @param {number} params.weightKg
 * @param {string} [params.orderId]
 * @param {string} [params.orderNumber]
 */
export async function bookCourierCheckout({
  courierCompanyId,
  deliveryAddress,
  sessionBuyer,
  lines,
  weightKg,
  orderId,
  orderNumber
}) {
  const id = Number(courierCompanyId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Invalid courier_company_id for logistics booking');
  }

  const body = {
    courier_company_id: id,
    delivery_address: deliveryAddress,
    session_buyer: sessionBuyer,
    lines,
    weight: weightKg,
    weight_kg: weightKg,
    order_id: orderId || undefined,
    order_number: orderNumber || undefined
  };

  let res = await postJson(BOOK_CHECKOUT_URL(), body);

  if (!res.ok && RETRYABLE.has(res.status)) {
    await delay(500);
    res = await postJson(BOOK_CHECKOUT_URL(), body);
  }

  let usedLegacyCarrierBook = false;
  if (!res.ok && res.status === 404 && !disableLegacy404Fallback) {
    res = await postJson(BOOK_CARRIER_URL(), {
      carrier_id: id,
      order_details: body
    });
    usedLegacyCarrierBook = true;
  }

  if (!res.ok) {
    const msg =
      res.json?.message ||
      formatUpstreamBookError(res.json?.detail) ||
      res.raw?.slice(0, 500) ||
      `Logistics booking HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.statusCode = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  const extracted = usedLegacyCarrierBook
    ? extractLegacyCarrierBookTracking(res.json)
    : extractBookingTracking(res.json);
  return {
    trackingNumber: extracted.trackingNumber,
    trackingUrl: extracted.trackingUrl,
    shippingProvider: extracted.shippingProvider
  };
}
