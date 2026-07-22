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
 *
 * Set LOGISTICS_BOOK_DEBUG=true to log booking → DB fields and attach a `debug` object inside each
 * order's `logisticsBooking` in the JSON response (disable in production once done debugging).
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

const bookDebugEnabled =
  String(process.env.LOGISTICS_BOOK_DEBUG || '').toLowerCase() === 'true';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { buildBookCourierCheckoutPayload, buildScheduleCourierPayload } from '../utils/logisticsApiPayload.js';

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
  const details = json.details && typeof json.details === 'object' ? json.details : null;
  const sr = layer.shiprocket_response && typeof layer.shiprocket_response === 'object'
    ? layer.shiprocket_response
    : null;
  const srDetails =
    details?.shiprocket_response && typeof details.shiprocket_response === 'object'
      ? details.shiprocket_response
      : null;
  const shipErrors = srDetails?.errors && typeof srDetails.errors === 'object' ? srDetails.errors : null;
  const shipErrorStr = shipErrors
    ? Object.entries(shipErrors)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
        .join('; ')
    : null;
  const pendingReason = pickStr(
    layer.awb_note,
    json.awb_note,
    layer.message,
    layer.error,
    sr?.message,
    json.success === false ? json.message : null,
    details?.message,
    srDetails?.message,
    shipErrorStr,
    details?.note,
    Array.isArray(layer.errors) ? layer.errors.join('; ') : null
  );
  return {
    trackingNumber: pickStr(
      layer.tracking_number,
      layer.trackingNumber,
      layer.awb_tracking_number,
      layer.awb_code,
      layer.awb,
      json.tracking_number,
      json.trackingNumber,
      details?.awb_tracking_number
    ),
    trackingUrl: pickStr(
      layer.tracking_url,
      layer.trackingUrl,
      layer.awb_url,
      layer.track_url,
      json.tracking_url,
      json.trackingUrl
    ),
    shippingProvider: pickStr(
      layer.shipping_provider,
      layer.shippingProvider,
      layer.courier_name,
      layer.carrier_name,
      json.shipping_provider,
      json.shippingProvider
    ),
    shipmentId: pickNum(layer.shipment_id, layer.shipmentId, json.shipment_id, details?.shipment_id),
    shiprocketOrderId: pickNum(
      layer.shiprocket_order_id,
      layer.shiprocketOrderId,
      json.shiprocket_order_id,
      details?.shiprocket_order_id
    ),
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
      .map((d) => {
        if (d && typeof d === 'object') {
          const loc = Array.isArray(d.loc) ? d.loc.filter((x) => x !== 'body').join('.') : '';
          const msg = d.msg || d.message || JSON.stringify(d);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return JSON.stringify(d);
      })
      .filter(Boolean)
      .join('; ');
  }
  if (typeof detail === 'object') return JSON.stringify(detail).slice(0, 500);
  return String(detail);
}

/** Rewrite opaque FastAPI/Render "Not Found" into an actionable booking error. */
export function clarifyLogisticsHttpError(status, rawMessage, attemptedUrl, kind = 'courier') {
  const raw = String(rawMessage || '').trim() || `HTTP ${status}`;
  const url = String(attemptedUrl || '').trim();
  if (Number(status) === 404 || /^not found$/i.test(raw)) {
    return (
      `Logistics ${kind} booking endpoint was not found` +
      (url ? ` at ${url}` : '') +
      '. Verify LOGISTICS_MODULE_URL and LOGISTICS_BOOK_COURIER_CHECKOUT_URL on the Tatva Direct server ' +
      '(expected path: /api/logistics/book-courier-checkout).'
    );
  }
  return raw;
}

function safeJsonPreview(obj, max = 1500) {
  try {
    const s = JSON.stringify(obj);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return '[non-serializable]';
  }
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

function scheduleCourierUrl() {
  const explicit = String(process.env.LOGISTICS_SCHEDULE_COURIER_URL || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  return `${LOGISTICS_BASE}/api/logistics/schedule-courier`;
}

const BOOK_CARRIER_URL = () => `${LOGISTICS_BASE}/carrier/book`;

/**
 * Read schedule-courier response (top level, scheduling, or immediate_book).
 */
export function extractScheduleBookingTracking(json) {
  if (!json || typeof json !== 'object') {
    return {
      trackingNumber: null,
      trackingUrl: null,
      shippingProvider: null,
      shipmentId: null,
      shiprocketOrderId: null,
      pendingReason: null,
      scheduledId: null,
      status: null,
      dispatchDate: null,
      dispatchImmediately: null,
      logisticsOrderId: null
    };
  }
  const immediate =
    json.immediate_book && typeof json.immediate_book === 'object' ? json.immediate_book : null;
  const base = extractBookingTracking(immediate || json);
  const scheduling =
    json.scheduling && typeof json.scheduling === 'object' ? json.scheduling : null;
  return {
    ...base,
    trackingNumber: pickStr(base.trackingNumber, immediate?.tracking_number, json.tracking_number),
    scheduledId: pickStr(json.scheduled_id, json.scheduledId, immediate?.id),
    status: pickStr(json.status, immediate?.status),
    dispatchDate: pickStr(scheduling?.dispatch_date, json.dispatch_date, immediate?.dispatch_date),
    dispatchImmediately:
      scheduling?.dispatch_immediately ?? json.dispatch_immediately ?? null,
    logisticsOrderId: pickStr(json.logistics_order_id, immediate?.logistics_order_id),
    pendingReason:
      base.pendingReason ||
      pickStr(json.message, scheduling?.buffer_mode ? `buffer_mode: ${scheduling.buffer_mode}` : null)
  };
}


/**
 * @returns {Promise<{
 *   trackingNumber: string|null,
 *   trackingUrl: string|null,
 *   shippingProvider: string|null,
 *   shipmentId: number|null,
 *   shiprocketOrderId: number|null,
 *   pendingReason: string|null,
 *   usedLegacyCarrierBook: boolean,
 *   debug?: object
 * }>}
 */
export async function bookCourierCheckout({
  courierCompanyId,
  courierDisplayName = null,
  deliveryAddress,
  sessionBuyer,
  lines,
  weightKg,
  orderId,
  orderNumber,
  vendorId = null,
  clientReference = null
}) {
  const id = Number(courierCompanyId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Invalid courier_company_id for logistics booking');
  }

  const checkoutBody = buildBookCourierCheckoutPayload({
    courierCompanyId: id,
    courierDisplayName,
    deliveryAddress,
    sessionBuyer,
    lines,
    weightKg,
    orderId,
    orderNumber,
    vendorId,
    clientReference
  });

  let res = await postJson(bookCourierCheckoutUrl(), checkoutBody);

  if (!res.ok && RETRYABLE.has(res.status)) {
    await delay(500);
    res = await postJson(bookCourierCheckoutUrl(), checkoutBody);
  }

  let usedLegacyCarrierBook = false;
  if (!res.ok && res.status === 404 && !disableLegacy404Fallback) {
    res = await postJson(BOOK_CARRIER_URL(), {
      carrier_id: id,
      order_details: checkoutBody
    });
    usedLegacyCarrierBook = true;
  }

  if (!res.ok) {
    const attemptedUrl = usedLegacyCarrierBook ? BOOK_CARRIER_URL() : bookCourierCheckoutUrl();
    const msg =
      res.json?.message ||
      formatUpstreamBookError(res.json?.detail) ||
      res.raw?.slice(0, 500) ||
      `Logistics booking HTTP ${res.status}`;
    const err = new Error(
      clarifyLogisticsHttpError(res.status, msg, attemptedUrl, 'courier checkout')
    );
    // Never surface upstream FastAPI 404 as our route 404 — clients show a useless "Not Found".
    err.statusCode =
      res.status === 404 ? 502 : res.status >= 400 && res.status < 600 ? res.status : 502;
    err.logisticsUrl = attemptedUrl;
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

  const result = {
    trackingNumber: trackingNumber || null,
    trackingUrl: trackingUrl || null,
    shippingProvider: extracted.shippingProvider || null,
    shipmentId: extracted.shipmentId,
    shiprocketOrderId: extracted.shiprocketOrderId,
    pendingReason: extracted.pendingReason,
    usedLegacyCarrierBook
  };

  if (bookDebugEnabled) {
    result.debug = {
      primaryBookingUrl: bookCourierCheckoutUrl(),
      fallbackBookingUrl: usedLegacyCarrierBook ? BOOK_CARRIER_URL() : null,
      httpStatus: res.status,
      usedLegacyCarrierBook,
      requestPreview: safeJsonPreview(checkoutBody),
      extractedFromUpstream: {
        trackingNumber: extracted.trackingNumber || null,
        trackingUrl: extracted.trackingUrl || null,
        shippingProvider: extracted.shippingProvider || null,
        shipmentId: extracted.shipmentId,
        shiprocketOrderId: extracted.shiprocketOrderId,
        pendingReason: extracted.pendingReason || null
      },
      valuesAfterDerive: {
        trackingNumber: result.trackingNumber,
        trackingUrl: result.trackingUrl,
        shippingProvider: result.shippingProvider
      },
      responsePreview: safeJsonPreview(res.json)
    };
  }

  return result;
}

/**
 * Deferred or immediate courier booking by promised delivery date.
 * Logistics module decides dispatch_immediately vs scheduled dispatch.
 *
 * @returns {Promise<{
 *   trackingNumber: string|null,
 *   trackingUrl: string|null,
 *   shippingProvider: string|null,
 *   shipmentId: number|null,
 *   shiprocketOrderId: number|null,
 *   pendingReason: string|null,
 *   scheduledId: string|null,
 *   status: string|null,
 *   dispatchDate: string|null,
 *   dispatchImmediately: boolean|null,
 *   logisticsOrderId: string|null,
 *   usedScheduleEndpoint: boolean,
 *   debug?: object
 * }>}
 */
export async function scheduleCourier({
  courierCompanyId,
  courierDisplayName = null,
  deliveryAddress,
  sessionBuyer,
  weightKg,
  expectedDeliveryDate,
  transitDays,
  bufferDays = 1,
  pickupPincode,
  orderId = null,
  orderNumber = null,
  clientReference = null,
  etdRaw = null
}) {
  const id = Number(courierCompanyId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Invalid courier_company_id for schedule-courier');
  }

  const scheduleBody = buildScheduleCourierPayload({
    courierCompanyId: id,
    courierDisplayName,
    deliveryAddress,
    sessionBuyer,
    weightKg,
    expectedDeliveryDate,
    transitDays,
    bufferDays,
    pickupPincode,
    clientReference,
    orderId,
    orderNumber,
    etdRaw
  });

  let res = await postJson(scheduleCourierUrl(), scheduleBody);

  if (!res.ok && RETRYABLE.has(res.status)) {
    await delay(500);
    res = await postJson(scheduleCourierUrl(), scheduleBody);
  }

  if (!res.ok) {
    const attemptedUrl = scheduleCourierUrl();
    const msg =
      res.json?.message ||
      formatUpstreamBookError(res.json?.detail) ||
      res.raw?.slice(0, 500) ||
      `Schedule courier HTTP ${res.status}`;
    const err = new Error(
      clarifyLogisticsHttpError(res.status, msg, attemptedUrl, 'schedule-courier')
    );
    err.statusCode =
      res.status === 404 ? 502 : res.status >= 400 && res.status < 600 ? res.status : 502;
    err.logisticsUrl = attemptedUrl;
    throw err;
  }

  const extracted = extractScheduleBookingTracking(res.json);
  let trackingUrl = extracted.trackingUrl;
  const trackingNumber = extracted.trackingNumber;
  if (!trackingUrl && trackingNumber) {
    trackingUrl = shiprocketPublicTrackingUrl(trackingNumber);
  }

  const result = {
    trackingNumber: trackingNumber || null,
    trackingUrl: trackingUrl || null,
    shippingProvider: extracted.shippingProvider || courierDisplayName || null,
    shipmentId: extracted.shipmentId,
    shiprocketOrderId: extracted.shiprocketOrderId,
    pendingReason: extracted.pendingReason,
    scheduledId: extracted.scheduledId,
    status: extracted.status,
    dispatchDate: extracted.dispatchDate,
    dispatchImmediately: extracted.dispatchImmediately,
    logisticsOrderId: extracted.logisticsOrderId,
    usedScheduleEndpoint: true
  };

  if (bookDebugEnabled) {
    result.debug = {
      scheduleUrl: scheduleCourierUrl(),
      httpStatus: res.status,
      requestPreview: safeJsonPreview(scheduleBody),
      extractedFromUpstream: extracted,
      responsePreview: safeJsonPreview(res.json)
    };
  }

  return result;
}
