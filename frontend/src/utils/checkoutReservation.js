import { getApiUrl } from '../config/api';

export const DEFAULT_CHECKOUT_RESERVATION_MINUTES = 15;
export const SP_PO_CHECKOUT_SESSION_KEY = 'spPoCheckoutSession';
export const SP_PO_CHECKOUT_HOLD_EXPIRED_KEY = 'spPoCheckoutHoldExpired';
export const SUPPLIER_UPSTREAM_CHECKOUT_HOLD_EXPIRED_KEY = 'supplierUpstreamCheckoutHoldExpired';
export const SP_CHECKOUT_CART_PATH = '/cart';
export const SUPPLIER_UPSTREAM_CART_PATH = '/supplier-cart';

/** DB timestamps for reservations are UTC but often returned without a Z suffix. */
export function parseReservationExpiresAt(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const isoNoTz = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;
  const sqlDateTime = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/;
  const hasTz = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw);

  let normalized = raw;
  if (sqlDateTime.test(normalized)) {
    normalized = normalized.replace(' ', 'T');
  }
  if (!hasTz && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(normalized)) {
    normalized = `${normalized}Z`;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function createCheckoutSessionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getReservationSecondsRemaining(expiresAt) {
  const parsed = parseReservationExpiresAt(expiresAt);
  if (!parsed) return 0;
  const ms = parsed.getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 1000));
}

export function formatReservationCountdown(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function markCheckoutHoldExpired(storageKey) {
  try {
    sessionStorage.setItem(storageKey, '1');
  } catch (_) {
    // Non-fatal.
  }
}

export function clearCheckoutHoldExpired(storageKey) {
  try {
    sessionStorage.removeItem(storageKey);
  } catch (_) {
    // Non-fatal.
  }
}

export function isCheckoutHoldExpired(storageKey) {
  try {
    return sessionStorage.getItem(storageKey) === '1';
  } catch (_) {
    return false;
  }
}

export function buildCheckoutHoldExpiredMessage(reservationMinutes = DEFAULT_CHECKOUT_RESERVATION_MINUTES) {
  const mins = Number(reservationMinutes) > 0 ? Number(reservationMinutes) : DEFAULT_CHECKOUT_RESERVATION_MINUTES;
  return `Your ${mins}-minute inventory hold has expired. You have been returned to your cart — review your items and proceed again when ready.`;
}

export function buildCheckoutHoldExpiredNavState(reservationMinutes, message) {
  return {
    checkoutHoldExpired: true,
    message: message || buildCheckoutHoldExpiredMessage(reservationMinutes)
  };
}

export function isInventoryHoldExpiredApiError(data) {
  if (!data || typeof data !== 'object') return false;
  const code = String(data.code || '').trim();
  const message = String(data.message || data.error || '').toLowerCase();
  return code === 'inventory_hold_expired' || message.includes('inventory hold has expired');
}

/** Server-backed restore: never extend the timer on refresh. */
export async function readActiveCheckoutReservation({ token, checkoutSessionId, fetchStatus }) {
  const sessionId = String(checkoutSessionId || '').trim();
  if (!sessionId || !token) {
    return { active: false, reason: 'missing' };
  }

  const status = await fetchStatus({ token, checkoutSessionId: sessionId });
  if (!status?.active || !status?.expiresAt) {
    return { active: false, reason: 'inactive', checkoutSessionId: sessionId };
  }

  const secondsLeft = getReservationSecondsRemaining(status.expiresAt);
  if (secondsLeft <= 0) {
    return {
      active: false,
      reason: 'expired',
      checkoutSessionId: sessionId,
      expiresAt: status.expiresAt
    };
  }

  return {
    active: true,
    checkoutSessionId: sessionId,
    expiresAt: status.expiresAt,
    secondsLeft
  };
}

async function requestCheckoutReservation({ token, method, path, body }) {
  const res = await fetch(getApiUrl(path), {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.status !== 'success') {
    throw new Error(data?.message || 'Checkout inventory request failed');
  }
  return data;
}

export async function fetchPoCheckoutReservationConfig({ token }) {
  return requestCheckoutReservation({
    token,
    method: 'GET',
    path: '/api/po/checkout-reservation-config'
  });
}

export async function fetchUpstreamCheckoutReservationConfig({ token }) {
  return requestCheckoutReservation({
    token,
    method: 'GET',
    path: '/api/supplier/upstream/checkout-reservation-config'
  });
}

export async function reservePoCheckoutInventory({ token, checkoutSessionId, lines }) {
  return requestCheckoutReservation({
    token,
    method: 'POST',
    path: '/api/po/checkout-reservations',
    body: { checkoutSessionId, lines }
  });
}

export async function releasePoCheckoutInventory({ token, checkoutSessionId = null }) {
  return requestCheckoutReservation({
    token,
    method: 'DELETE',
    path: '/api/po/checkout-reservations',
    body: checkoutSessionId ? { checkoutSessionId } : {}
  });
}

export async function fetchPoCheckoutReservationStatus({ token, checkoutSessionId }) {
  return requestCheckoutReservation({
    token,
    method: 'GET',
    path: `/api/po/checkout-reservations/${encodeURIComponent(checkoutSessionId)}`
  });
}

export async function reserveUpstreamCheckoutInventory({ token, checkoutSessionId, lines }) {
  return requestCheckoutReservation({
    token,
    method: 'POST',
    path: '/api/supplier/upstream/checkout-reservations',
    body: { checkoutSessionId, lines }
  });
}

export async function releaseUpstreamCheckoutInventory({ token, checkoutSessionId = null }) {
  return requestCheckoutReservation({
    token,
    method: 'DELETE',
    path: '/api/supplier/upstream/checkout-reservations',
    body: checkoutSessionId ? { checkoutSessionId } : {}
  });
}

export async function fetchUpstreamCheckoutReservationStatus({ token, checkoutSessionId }) {
  return requestCheckoutReservation({
    token,
    method: 'GET',
    path: `/api/supplier/upstream/checkout-reservations/${encodeURIComponent(checkoutSessionId)}`
  });
}

/**
 * Order-independent signature for a set of reservation lines. Grouping/ranking effects can
 * legitimately re-run and rebuild the same lines in a different order (e.g. once an async
 * shipping-address lookup resolves); using a plain JSON.stringify of the unsorted array would
 * treat that as "the cart changed" and trigger a real release + re-reserve of an identical hold.
 */
export function buildStableReservationLineSignature(lines = []) {
  const normalized = (Array.isArray(lines) ? lines : []).map((line) => ({
    supplierProductId: String(line?.supplierProductId || '').trim(),
    supplierId: String(line?.supplierId || '').trim(),
    quantity: Number(line?.quantity) || 0
  }));
  normalized.sort((a, b) =>
    `${a.supplierProductId}|${a.supplierId}`.localeCompare(`${b.supplierProductId}|${b.supplierId}`)
  );
  return JSON.stringify(normalized);
}

export function buildPoReservationLinesFromGroups(poGroups = []) {
  return (Array.isArray(poGroups) ? poGroups : [])
    .flatMap((group) =>
      (Array.isArray(group?.items) ? group.items : []).map((item) => ({
        supplierProductId: String(item?.supplierProductId || '').trim(),
        supplierId: String(group?.vendorId || '').trim(),
        quantity: Number(item?.quantity) || 0,
        productId: item?.productId || null
      }))
    )
    .filter((line) => line.supplierProductId && line.supplierId && line.quantity > 0);
}
