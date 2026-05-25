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

/**
 * One supplier-select row per product — avoids duplicate Mac Air M2 blocks from repeated voice adds.
 */
export function dedupeSupplierSelectItems(items) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const byLineId = new Set();
  const byProductId = new Map();
  const out = [];

  for (const it of items) {
    const lineId = String(it?.id ?? '').trim();
    if (lineId && byLineId.has(lineId)) continue;
    if (lineId) byLineId.add(lineId);

    const pid = String(it?.productId ?? '').trim();
    if (pid) {
      if (byProductId.has(pid)) {
        const prev = byProductId.get(pid);
        prev.quantity = (Number(prev.quantity) || 0) + (Number(it.quantity) || 0);
        continue;
      }
      const row = { ...it };
      byProductId.set(pid, row);
      out.push(row);
      continue;
    }
    out.push({ ...it });
  }
  return out;
}

export function persistSupplierSelectScopeFromCart(items) {
  const scoped = dedupeSupplierSelectItems(items);
  if (!scoped.length) return;
  try {
    sessionStorage.setItem(SESSION_SCOPE_KEY, JSON.stringify(scoped));
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
    return dedupeSupplierSelectItems(parsed);
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
