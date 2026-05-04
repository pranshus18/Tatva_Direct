const POS_QUEUE_KEY = 'tatva_pos_offline_queue_v1';
const BARCODE_CACHE_KEY = 'tatva_pos_barcode_cache_v1';

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function loadPosQueue() {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(POS_QUEUE_KEY);
  const q = safeParse(raw || '[]', []);
  return Array.isArray(q) ? q : [];
}

export function savePosQueue(queue) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(POS_QUEUE_KEY, JSON.stringify(queue || []));
}

export function enqueuePosOrder(payload) {
  const id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
  const entry = {
    id,
    createdAt: new Date().toISOString(),
    payload,
    status: 'pending'
  };
  const q = loadPosQueue();
  q.unshift(entry);
  savePosQueue(q);
  return entry;
}

export function markPosOrderSynced(id, serverOrderNumber = null) {
  const q = loadPosQueue();
  const next = q.map((e) => e.id === id ? { ...e, status: 'synced', syncedAt: new Date().toISOString(), serverOrderNumber } : e);
  savePosQueue(next);
  return next;
}

export function getPendingPosOrders() {
  return loadPosQueue().filter((e) => e.status === 'pending');
}

export function clearSyncedPosOrders() {
  const q = loadPosQueue();
  const next = q.filter((e) => e.status !== 'synced');
  savePosQueue(next);
  return next;
}

function barcodeCacheKey({ barcode, outletId, scanType }) {
  return `${String(scanType || 'gsku')}::${String(outletId || 'no_outlet')}::${String(barcode || '').trim()}`;
}

export function cacheBarcodeLookup({ barcode, outletId, scanType, product }) {
  if (typeof localStorage === 'undefined') return;
  const raw = localStorage.getItem(BARCODE_CACHE_KEY);
  const cache = safeParse(raw || '{}', {});
  cache[barcodeCacheKey({ barcode, outletId, scanType })] = {
    cachedAt: new Date().toISOString(),
    outletId: outletId || null,
    barcode: String(barcode || '').trim(),
    product
  };
  localStorage.setItem(BARCODE_CACHE_KEY, JSON.stringify(cache));
}

export function getCachedBarcodeLookup({ barcode, outletId, scanType }) {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(BARCODE_CACHE_KEY);
  const cache = safeParse(raw || '{}', {});
  return cache[barcodeCacheKey({ barcode, outletId, scanType })] || null;
}

