import { getApiUrl } from '../config/api';
import { persistSupplierSelectScopeFromCart } from '../constants/supplierSelectSession';

export const VOICE_GUIDED_KEY = 'tatvaVoiceGuided';
export const VOICE_GUIDED_LABEL_KEY = 'tatvaVoiceGuidedLabel';
export const VOICE_GUIDED_PATH_KEY = 'tatvaVoiceGuidedPath';

export function setVoiceGuidedActive(active, label = '', path = '') {
  try {
    if (active) {
      sessionStorage.setItem(VOICE_GUIDED_KEY, '1');
      if (label) sessionStorage.setItem(VOICE_GUIDED_LABEL_KEY, label);
      if (path) sessionStorage.setItem(VOICE_GUIDED_PATH_KEY, path);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('voice-guided-updated'));
      }
    } else {
      sessionStorage.removeItem(VOICE_GUIDED_KEY);
      sessionStorage.removeItem(VOICE_GUIDED_LABEL_KEY);
      sessionStorage.removeItem(VOICE_GUIDED_PATH_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function isVoiceGuidedActive() {
  try {
    return sessionStorage.getItem(VOICE_GUIDED_KEY) === '1';
  } catch {
    return false;
  }
}

export function getVoiceGuidedLabel() {
  try {
    return sessionStorage.getItem(VOICE_GUIDED_LABEL_KEY) || 'Voice assistant';
  } catch {
    return 'Voice assistant';
  }
}

export function getVoiceGuidedPath() {
  try {
    return sessionStorage.getItem(VOICE_GUIDED_PATH_KEY) || '';
  } catch {
    return '';
  }
}

function flattenCartItems(draft) {
  const groups = draft?.boqGroups || [];
  const items = [];
  for (const g of groups) {
    for (const it of g.items || []) items.push(it);
  }
  if (!items.length && Array.isArray(draft?.items)) return draft.items;
  return items;
}

/** Load persisted PO cart — same source the voice agent uses on the server. */
export async function fetchVoiceCartDraft() {
  const token = localStorage.getItem('token');
  if (!token) return { items: [], selectedVendors: {}, substitutions: [], draft: null };

  const res = await fetch(getApiUrl('/api/po/cart'), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.cart?.draft) {
    return { items: [], selectedVendors: {}, substitutions: [], draft: null };
  }

  const draft = data.cart.draft;
  return {
    items: flattenCartItems(draft),
    selectedVendors: draft.selectedVendors || {},
    substitutions: draft.substitutions || [],
    draft
  };
}

export async function prepareSupplierSelectFromVoiceCart() {
  const { items } = await fetchVoiceCartDraft();
  if (items.length) persistSupplierSelectScopeFromCart(items);
  return items;
}
