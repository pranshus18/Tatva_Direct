/** Short-lived backup when navigating Cart → supplier select (router state can be lost in production). */

export const SESSION_SCOPE_KEY = 'tatvaSupplierSelectScope';
export const SESSION_SCOPE_TS_KEY = 'tatvaSupplierSelectScopeTs';
export const SESSION_SCOPE_SOURCE_KEY = 'tatvaSupplierSelectScopeSource';
export const SESSION_SCOPE_FROM_CART = 'cart';
export const SCOPE_TTL_MS = 120000;

export function clearSupplierSelectScopeSession() {
  try {
    sessionStorage.removeItem(SESSION_SCOPE_KEY);
    sessionStorage.removeItem(SESSION_SCOPE_TS_KEY);
    sessionStorage.removeItem(SESSION_SCOPE_SOURCE_KEY);
  } catch {
    /* ignore */
  }
}

export function persistSupplierSelectScopeFromCart(items) {
  if (!Array.isArray(items) || items.length === 0) return;
  try {
    sessionStorage.setItem(SESSION_SCOPE_KEY, JSON.stringify(items));
    sessionStorage.setItem(SESSION_SCOPE_TS_KEY, String(Date.now()));
    sessionStorage.setItem(SESSION_SCOPE_SOURCE_KEY, SESSION_SCOPE_FROM_CART);
  } catch {
    /* ignore */
  }
}

/** Cart backup only; BOQ flow should call clearSupplierSelectScopeSession before opening supplier select. */
export function readSupplierSelectScopeSessionIfFresh() {
  try {
    if (sessionStorage.getItem(SESSION_SCOPE_SOURCE_KEY) !== SESSION_SCOPE_FROM_CART) return null;
    const ts = Number(sessionStorage.getItem(SESSION_SCOPE_TS_KEY) || 0);
    if (!ts || Date.now() - ts >= SCOPE_TTL_MS) return null;
    const raw = sessionStorage.getItem(SESSION_SCOPE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True if cart→supplier backup was written recently (even if JSON parse fails later). */
export function hasFreshCartSupplierSelectSession() {
  try {
    if (sessionStorage.getItem(SESSION_SCOPE_SOURCE_KEY) !== SESSION_SCOPE_FROM_CART) return false;
    const ts = Number(sessionStorage.getItem(SESSION_SCOPE_TS_KEY) || 0);
    return Boolean(ts && Date.now() - ts < SCOPE_TTL_MS);
  } catch {
    return false;
  }
}
