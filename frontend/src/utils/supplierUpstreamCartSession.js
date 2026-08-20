/** Last project chosen in this browser session — reused when adding more qty. */
export const SUPPLIER_UPSTREAM_SESSION_PROJECT_KEY = 'supplierUpstreamSessionProjectId';

/** Resume draft written when continuing from cart back to sourcing. */
export const SUPPLIER_UPSTREAM_CART_RESUME_KEY = 'supplierUpstreamCartResumeDraft';

export const readUpstreamSessionProjectId = () => {
  try {
    return String(sessionStorage.getItem(SUPPLIER_UPSTREAM_SESSION_PROJECT_KEY) || '').trim();
  } catch {
    return '';
  }
};

export const writeUpstreamSessionProjectId = (projectId) => {
  const id = String(projectId || '').trim();
  if (!id || id === '__new__') return;
  try {
    sessionStorage.setItem(SUPPLIER_UPSTREAM_SESSION_PROJECT_KEY, id);
  } catch {
    // Ignore quota / private-mode failures.
  }
};

export const clearUpstreamSessionProjectId = () => {
  try {
    sessionStorage.removeItem(SUPPLIER_UPSTREAM_SESSION_PROJECT_KEY);
  } catch {
    // Ignore private-mode failures.
  }
};

/** Drop every client-side pointer at a cart project once the cart (or its last
 * project) is cleared — otherwise Add to Cart keeps targeting a deleted project.
 */
export const clearUpstreamCartClientProjectState = () => {
  clearUpstreamSessionProjectId();
  try {
    localStorage.removeItem(SUPPLIER_UPSTREAM_CART_RESUME_KEY);
  } catch {
    // Ignore private-mode failures.
  }
};

/** Legacy auto-name that stuffed today's date into the project label. */
const AUTO_DATED_UPSTREAM_PROJECT_NAME = /^Project \d{1,2}\/[A-Za-z]+\/\d{2}$/i;
export const DEFAULT_UPSTREAM_PROJECT_NAME = 'Supplier Project';

/**
 * Project name must stay separate from expected dispatch date.
 * Never surface `Project DD/Month/YY` (auto-generated from "today") as the label.
 */
export const resolveUpstreamProjectCartName = (value) => {
  const cartNameRaw = String(value || '').trim();
  if (!cartNameRaw || AUTO_DATED_UPSTREAM_PROJECT_NAME.test(cartNameRaw)) {
    return DEFAULT_UPSTREAM_PROJECT_NAME;
  }
  return cartNameRaw;
};

export const SUPPLIER_UPSTREAM_CART_UPDATED_EVENT = 'supplier-upstream-cart-updated';
/** Written so other browser tabs/windows can pick up cart quantity changes. */
export const SUPPLIER_UPSTREAM_CART_SYNC_KEY = 'supplierUpstreamCartSyncAt';

export const emitSupplierCartUpdated = () => {
  try {
    window.dispatchEvent(new Event(SUPPLIER_UPSTREAM_CART_UPDATED_EVENT));
  } catch {
    // Ignore non-browser.
  }
  try {
    localStorage.setItem(SUPPLIER_UPSTREAM_CART_SYNC_KEY, String(Date.now()));
  } catch {
    // Ignore quota / private-mode failures.
  }
};

export const subscribeSupplierCartUpdated = (handler, options = {}) => {
  const includeSameWindow = options.includeSameWindow !== false;
  const includeStorage = options.includeStorage !== false;
  const includeFocus = options.includeFocus === true;
  const debounceMs = Number(options.debounceMs);
  const wait = Number.isFinite(debounceMs) && debounceMs >= 0 ? debounceMs : 50;
  let timer = null;
  const fire = () => {
    if (wait <= 0) {
      handler();
      return;
    }
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      handler();
    }, wait);
  };
  const onStorage = (event) => {
    if (event?.key === SUPPLIER_UPSTREAM_CART_SYNC_KEY) fire();
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') fire();
  };
  if (includeSameWindow) {
    window.addEventListener(SUPPLIER_UPSTREAM_CART_UPDATED_EVENT, fire);
  }
  if (includeStorage) {
    window.addEventListener('storage', onStorage);
  }
  if (includeFocus) {
    window.addEventListener('focus', fire);
    document.addEventListener('visibilitychange', onVisibility);
  }
  return () => {
    if (timer) window.clearTimeout(timer);
    window.removeEventListener(SUPPLIER_UPSTREAM_CART_UPDATED_EVENT, fire);
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('focus', fire);
    document.removeEventListener('visibilitychange', onVisibility);
  };
};

/**
 * Copy live cart quantities into a local qty map when the saved cart changed
 * during this session. Do not pass `seedMissingFromLive` on page load/refresh —
 * the quantity field must stay at its default until the user edits it.
 */
export const applyLiveCartQuantitiesToMap = (
  prevMap = {},
  prevCartQty = {},
  nextCartQty = {},
  options = {}
) => {
  const current = prevMap && typeof prevMap === 'object' ? prevMap : {};
  const prev = prevCartQty && typeof prevCartQty === 'object' ? prevCartQty : {};
  const live = nextCartQty && typeof nextCartQty === 'object' ? nextCartQty : {};
  const onlyExistingKeys = options.onlyExistingKeys === true;
  const resetRemovedToZero = options.resetRemovedToZero === true;
  const dropRemovedKeys = options.dropRemovedKeys === true;
  const seedMissingFromLive = options.seedMissingFromLive === true;
  const next = { ...current };
  let changed = false;
  for (const [mineId, qtyRaw] of Object.entries(live)) {
    const qty = Number(qtyRaw);
    if (!mineId || !Number.isFinite(qty) || qty <= 0) continue;
    if (!Object.prototype.hasOwnProperty.call(prev, mineId)) {
      if (
        seedMissingFromLive &&
        !onlyExistingKeys &&
        !Object.prototype.hasOwnProperty.call(current, mineId)
      ) {
        next[mineId] = qty;
        changed = true;
      }
      continue;
    }
    if (Number(prev[mineId] || 0) === qty) continue;
    if (onlyExistingKeys && !Object.prototype.hasOwnProperty.call(current, mineId)) continue;
    next[mineId] = qty;
    changed = true;
  }
  if (resetRemovedToZero || dropRemovedKeys) {
    for (const mineId of Object.keys(prev)) {
      const prevQty = Number(prev[mineId] || 0);
      const liveQty = Number(live[mineId] || 0);
      if (!mineId || !(prevQty > 0) || liveQty > 0) continue;
      if (dropRemovedKeys) {
        if (Object.prototype.hasOwnProperty.call(next, mineId)) {
          delete next[mineId];
          changed = true;
        }
      } else if (Object.prototype.hasOwnProperty.call(current, mineId) && Number(current[mineId]) !== 0) {
        next[mineId] = 0;
        changed = true;
      }
    }
  }
  return changed ? next : current;
};

export const SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY = 'supplierUpstreamOrderDraft';
export const SUPPLIER_UPSTREAM_RESTORE_FROM_ORDER_KEY = 'supplierUpstreamRestoreFromOrder';
export const SUPPLIER_UPSTREAM_LAST_ORDERED_KEY = 'supplierUpstreamLastOrderedQty';

export const quantitiesFromOrderLines = (lines = []) => {
  const out = {};
  for (const line of Array.isArray(lines) ? lines : []) {
    const mineId = String(line?.mineSupplierProductId || line?.mineId || '').trim();
    const qty = Number(line?.quantity);
    if (!mineId || !Number.isFinite(qty) || qty <= 0) continue;
    out[mineId] = (out[mineId] || 0) + qty;
  }
  return out;
};

export const readLastOrderedQuantities = () => {
  try {
    const raw = sessionStorage.getItem(SUPPLIER_UPSTREAM_LAST_ORDERED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out = {};
    for (const [mineId, qtyRaw] of Object.entries(parsed)) {
      const key = String(mineId || '').trim();
      const qty = Number(qtyRaw);
      if (!key || !Number.isFinite(qty) || qty <= 0) continue;
      out[key] = qty;
    }
    return out;
  } catch {
    return {};
  }
};

export const readLastOrderedQuantity = (mineId) => {
  const key = String(mineId || '').trim();
  if (!key) return null;
  const qty = Number(readLastOrderedQuantities()[key]);
  return Number.isFinite(qty) && qty > 0 ? qty : null;
};

export const mergeLastOrderedQuantities = (qtyByMineId = {}) => {
  const next = { ...readLastOrderedQuantities() };
  for (const [mineId, qtyRaw] of Object.entries(qtyByMineId && typeof qtyByMineId === 'object' ? qtyByMineId : {})) {
    const key = String(mineId || '').trim();
    const qty = Number(qtyRaw);
    if (!key || !Number.isFinite(qty) || qty <= 0) continue;
    next[key] = qty;
  }
  try {
    sessionStorage.setItem(SUPPLIER_UPSTREAM_LAST_ORDERED_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota / private-mode failures.
  }
  return next;
};

export const recordLastOrderedQuantitiesFromLines = (lines = []) =>
  mergeLastOrderedQuantities(quantitiesFromOrderLines(lines));

/** After a successful upstream order: drop cart/project pointers so Add to Cart starts a new order. */
export const clearUpstreamStateAfterSuccessfulOrder = (lines = []) => {
  recordLastOrderedQuantitiesFromLines(lines);
  clearUpstreamCartClientProjectState();
  try {
    localStorage.removeItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
  } catch {
    // Ignore private-mode failures.
  }
  try {
    sessionStorage.removeItem(SUPPLIER_UPSTREAM_RESTORE_FROM_ORDER_KEY);
  } catch {
    // Ignore private-mode failures.
  }
  emitSupplierCartUpdated();
};
