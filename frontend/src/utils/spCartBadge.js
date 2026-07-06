import { getApiUrl } from '../config/api';
import { countServiceProviderCartDraft } from './cartBadge';

const listeners = new Set();
let cachedCount = 0;
let inflightPromise = null;
let requestGeneration = 0;
let debounceTimer = null;

function notify(count) {
  cachedCount = Math.max(0, Number(count) || 0);
  listeners.forEach((listener) => {
    try {
      listener(cachedCount);
    } catch {
      // Ignore subscriber errors.
    }
  });
}

async function fetchLatestCount() {
  const generation = ++requestGeneration;
  const token = localStorage.getItem('token');
  if (!token) {
    if (generation === requestGeneration) notify(0);
    return 0;
  }

  try {
    const response = await fetch(getApiUrl('/api/po/cart'), {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-cache'
    });
    const data = await response.json();
    const count =
      response.ok && data?.status === 'success'
        ? countServiceProviderCartDraft(data?.cart?.draft)
        : 0;
    if (generation === requestGeneration) notify(count);
    return count;
  } catch {
    if (generation === requestGeneration) notify(0);
    return 0;
  }
}

export function getCachedServiceProviderCartCount() {
  return cachedCount;
}

export function emitServiceProviderCartCount(draftOrCount) {
  const count =
    typeof draftOrCount === 'number'
      ? draftOrCount
      : countServiceProviderCartDraft(draftOrCount);
  notify(count);
  window.dispatchEvent(new CustomEvent('sp-cart-updated', { detail: { count } }));
}

export function refreshServiceProviderCartCount(options = {}) {
  const immediate = options.immediate === true;
  if (immediate) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    if (inflightPromise) return inflightPromise;
    inflightPromise = fetchLatestCount().finally(() => {
      inflightPromise = null;
    });
    return inflightPromise;
  }

  clearTimeout(debounceTimer);
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    if (inflightPromise) return;
    inflightPromise = fetchLatestCount().finally(() => {
      inflightPromise = null;
    });
  }, 120);

  return Promise.resolve(cachedCount);
}

export function subscribeServiceProviderCartCount(listener) {
  listener(cachedCount);
  listeners.add(listener);

  const onCartUpdated = (event) => {
    const detailCount = event?.detail?.count;
    if (Number.isFinite(detailCount)) {
      notify(detailCount);
      return;
    }
    refreshServiceProviderCartCount();
  };

  const onVoiceCartUpdated = (event) => {
    const draft = event?.detail;
    if (draft && typeof draft === 'object') {
      notify(countServiceProviderCartDraft(draft));
      return;
    }
    refreshServiceProviderCartCount();
  };

  window.addEventListener('sp-cart-updated', onCartUpdated);
  window.addEventListener('voice-cart-updated', onVoiceCartUpdated);

  refreshServiceProviderCartCount({ immediate: true });

  return () => {
    listeners.delete(listener);
    window.removeEventListener('sp-cart-updated', onCartUpdated);
    window.removeEventListener('voice-cart-updated', onVoiceCartUpdated);
  };
}

/** @deprecated Use refreshServiceProviderCartCount */
export async function fetchServiceProviderCartCount() {
  await refreshServiceProviderCartCount({ immediate: true });
  return cachedCount;
}
