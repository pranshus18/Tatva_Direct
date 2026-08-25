/** Where Supplier Selection should send the header back button. */

export const SUPPLIER_SELECT_BACK = {
  cart: { origin: 'cart', path: '/cart', label: 'Back to cart' },
  boq: { origin: 'boq', path: '/boq-normalize', label: 'Back to BOQ' },
  dashboard: { origin: 'dashboard', path: '/dashboard', label: 'Back to Dashboard' },
  boqs: { origin: 'boqs', path: '/boqs', label: 'Back to BOQs' }
};

const LAST_PATH_KEY = 'tatvaSpPathBeforeSupplierSelect';
const ORIGIN_KEY = 'tatvaSupplierSelectBackOrigin';

const PATH_ORIGIN = {
  '/cart': 'cart',
  '/boq-normalize': 'boq',
  '/dashboard': 'dashboard',
  '/boqs': 'boqs'
};

function normalizeOrigin(value) {
  const origin = String(value || '').trim().toLowerCase();
  if (origin === 'cart' || origin === 'boq' || origin === 'dashboard' || origin === 'boqs') {
    return origin;
  }
  return '';
}

export function rememberSpPathForSupplierSelectBack(pathname) {
  const path = String(pathname || '').trim();
  if (!path || path === '/supplier-select') return;
  try {
    sessionStorage.setItem(LAST_PATH_KEY, path);
  } catch {
    /* ignore */
  }
}

export function readLastSpPathBeforeSupplierSelect() {
  try {
    return String(sessionStorage.getItem(LAST_PATH_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function persistSupplierSelectBackOrigin(origin) {
  const next = normalizeOrigin(origin);
  if (!next) return;
  try {
    sessionStorage.setItem(ORIGIN_KEY, next);
  } catch {
    /* ignore */
  }
}

export function readPersistedSupplierSelectBackOrigin() {
  try {
    return normalizeOrigin(sessionStorage.getItem(ORIGIN_KEY));
  } catch {
    return '';
  }
}

export function originFromReturnPath(pathname) {
  const path = String(pathname || '').split('?')[0];
  return PATH_ORIGIN[path] || '';
}

/**
 * Cart handoff wins. Explicit router state from BOQ vs dashboard is next.
 * Last visited SP page covers sidebar / dialog flows and refresh.
 */
export function resolveSupplierSelectBack({
  cartSupplierHandoff = false,
  location = null,
  lastPath = '',
  persistedOrigin = ''
} = {}) {
  if (cartSupplierHandoff) return SUPPLIER_SELECT_BACK.cart;

  let searchFrom = '';
  try {
    searchFrom = new URLSearchParams(location?.search || '').get('from') || '';
  } catch {
    searchFrom = '';
  }

  const state = location?.state && typeof location.state === 'object' ? location.state : {};
  const explicitOrigin =
    normalizeOrigin(state.supplierSelectOrigin) ||
    normalizeOrigin(searchFrom) ||
    normalizeOrigin(state.supplierSelectReturnTo && originFromReturnPath(state.supplierSelectReturnTo));

  if (explicitOrigin && SUPPLIER_SELECT_BACK[explicitOrigin]) {
    return SUPPLIER_SELECT_BACK[explicitOrigin];
  }

  if (state.fromBoqDetail === true) {
    const dialogOrigin = originFromReturnPath(state.supplierSelectReturnTo) || 'dashboard';
    return SUPPLIER_SELECT_BACK[dialogOrigin];
  }

  if (Array.isArray(state.supplierSelectItems) && state.supplierSelectItems.length > 0) {
    return SUPPLIER_SELECT_BACK.boq;
  }

  const fromLastPath = originFromReturnPath(lastPath);
  if (fromLastPath && SUPPLIER_SELECT_BACK[fromLastPath]) {
    return SUPPLIER_SELECT_BACK[fromLastPath];
  }

  const stored = normalizeOrigin(persistedOrigin);
  if (stored && SUPPLIER_SELECT_BACK[stored]) {
    return SUPPLIER_SELECT_BACK[stored];
  }

  return SUPPLIER_SELECT_BACK.dashboard;
}
