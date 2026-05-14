/**
 * Last-mile booking against Tatva logistics (Shiprocket via logistics module).
 * Primary POST URL (in order of precedence):
 *   1) LOGISTICS_BOOK_COURIER_CHECKOUT_URL — full URL, e.g.
 *      https://tatva-logistic-module.onrender.com/api/logistics/book-courier-checkout
 *   2) Else LOGISTICS_MODULE_URL + /api/logistics/book-courier-checkout
 * Called from Tatva Direct when the user confirms transport (Confirm & create all POs).
 *
 * If the checkout URL returns 404 and legacy fallback is allowed, POST .../carrier/book.
 * Set LOGISTICS_BOOK_DISABLE_LEGACY_FALLBACK=true when checkout is deployed and you want no fallback.
 */

const LOGISTICS_BASE = String(process.env.LOGISTICS_MODULE_URL || 'http://localhost:8001').replace(
  /\/$/,
  ''
);

function bookCourierCheckoutUrl() {
  const explicit = String(process.env.LOGISTICS_BOOK_COURIER_CHECKOUT_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  return `${LOGISTICS_BASE}/api/logistics/book-courier-checkout`;
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

function pickNum(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** Public Shiprocket tracking page when AWB is known. */
export function shiprocketPublicTrackingUrl(awb) {
  const a = pickStr(awb);
  if (!a) return null;
  return `https://shiprocket.co/tracking/${encodeURIComponent(a)}`;
}

/**
 * Read tracking fields from book-courier-checkout (top level or single `data` object).
 */
export function extractBookingTracking(json) {
  if (!json || typeof json !== 'object') {
    return {
      trackingNumber: null,
      trackingUrl: null,
      shippingProvider: null,
      shipmentId: null,
      shiprocketOrderId: null,
      pendingReason: null
    };
  }
  const layer =
    json.data && typeof json.data === 'object' && !Array.isArray(json.data) ? json.data : json;
  const sr = layer.shiprocket_response && typeof layer.shiprocket_response === 'object'
    ? layer.shiprocket_response
    : null;
  const pendingReason = pickStr(
    layer.awb_note,
    layer.message,
    layer.error,
    sr?.message,
    Array.isArray(layer.errors) ? layer.errors.join('; ') : null
  );
  return {
    trackingNumber: pickStr(
      layer.tracking_number,
      layer.trackingNumber,
      layer.awb_tracking_number,
      layer.awb_code,
      layer.awb
    ),
    trackingUrl: pickStr(layer.tracking_url, layer.trackingUrl, layer.awb_url, layer.track_url),
    shippingProvider: pickStr(
      layer.shipping_provider,
      layer.shippingProvider,
      layer.courier_name,
      layer.carrier_name
    ),
    shipmentId: pickNum(layer.shipment_id, layer.shipmentId),
    shiprocketOrderId: pickNum(layer.shiprocket_order_id, layer.shiprocketOrderId),
    pendingReason: pendingReason || null
  };
}

/**
 * /carrier/book returns Shiprocket progress inside data[0].text (JSON string).
 */
function extractLegacyCarrierBookTracking(json) {
  if (!json || typeof json !== 'object') {
    return {
      trackingNumber: null,
      trackingUrl: null,
      shippingProvider: null,
      shipmentId: null,
      shiprocketOrderId: null,
      pendingReason: null
    };
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
  const base = extractBookingTracking(inner);
  if (base.trackingNumber || base.trackingUrl || base.shippingProvider) {
    return base;
  }
  const sr = inner.shiprocket_response && typeof inner.shiprocket_response === 'object'
    ? inner.shiprocket_response
    : null;
  const tn = pickStr(
    base.trackingNumber,
    inner.awb_tracking_number,
    inner.awb_code,
    inner.awb,
    inner.tracking_number,
    inner.tracking_no
  );
  const tu = pickStr(
    base.trackingUrl,
    inner.tracking_url,
    inner.awb_url,
    inner.track_url,
    inner.trackingUrl
  );
  const sp = pickStr(
    base.shippingProvider,
    inner.shipping_provider,
    inner.courier_name,
    inner.carrier_name
  );
  const pendingReason = pickStr(
    base.pendingReason,
    inner.awb_note,
    inner.message,
    sr?.message
  );
  return {
    trackingNumber: tn,
    trackingUrl: tu,
    shippingProvider: sp,
    shipmentId: base.shipmentId ?? pickNum(inner.shipment_id, inner.shipmentId),
    shiprocketOrderId: base.shiprocketOrderId ?? pickNum(inner.shiprocket_order_id, inner.shiprocketOrderId),
    pendingReason: pendingReason || null
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

const BOOK_CARRIER_URL = () => `${LOGISTICS_BASE}/carrier/book`;

/**
 * @returns {Promise<{
 *   trackingNumber: string|null,
 *   trackingUrl: string|null,
 *   shippingProvider: string|null,
 *   shipmentId: number|null,
 *   shiprocketOrderId: number|null,
 *   pendingReason: string|null,
 *   usedLegacyCarrierBook: boolean
 * }>}
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

  let res = await postJson(bookCourierCheckoutUrl(), body);

  if (!res.ok && RETRYABLE.has(res.status)) {
    await delay(500);
    res = await postJson(bookCourierCheckoutUrl(), body);
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

  let trackingUrl = extracted.trackingUrl;
  const trackingNumber = extracted.trackingNumber;
  if (!trackingUrl && trackingNumber) {
    trackingUrl = shiprocketPublicTrackingUrl(trackingNumber);
  }

  return {
    trackingNumber: trackingNumber || null,
    trackingUrl: trackingUrl || null,
    shippingProvider: extracted.shippingProvider || null,
    shipmentId: extracted.shipmentId,
    shiprocketOrderId: extracted.shiprocketOrderId,
    pendingReason: extracted.pendingReason,
    usedLegacyCarrierBook
  };
}
