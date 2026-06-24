import { getApiUrl } from '../config/api';
import { persistSupplierSelectScopeFromCart } from '../constants/supplierSelectSession';
import { formatShippingAddressPreview } from '../utils/shippingAddressLabel';

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

function normalizeCartShippingAddress(raw = {}) {
  return {
    line1: String(raw?.line1 || raw?.street || '').trim(),
    city: String(raw?.city || '').trim(),
    state: String(raw?.state || '').trim(),
    pincode: String(raw?.pincode || raw?.zipCode || '').trim(),
    country: String(raw?.country || 'India').trim() || 'India'
  };
}

function isCartShippingAddressComplete(address = {}) {
  return ['line1', 'city', 'state', 'pincode', 'country'].every((key) =>
    String(address?.[key] || '').trim()
  );
}

/** Shipping picked in Product Discovery is stored on cart project metadata. */
export function resolveDiscoveryShippingFromCartDraft(draft) {
  if (!draft || typeof draft !== 'object') return null;

  const root = normalizeCartShippingAddress(draft.shippingAddress || {});
  if (isCartShippingAddressComplete(root)) {
    return {
      address: root,
      shippingAddressId: String(draft.shippingAddressId || '').trim(),
      projectName: ''
    };
  }

  const groups = Array.isArray(draft.boqGroups) ? draft.boqGroups : [];
  for (const group of groups) {
    const project = group?.boqProject;
    if (!project || typeof project !== 'object') continue;
    const address = normalizeCartShippingAddress(project.shippingAddress || {});
    if (!isCartShippingAddressComplete(address)) continue;
    return {
      address,
      shippingAddressId: String(project.shippingAddressId || '').trim(),
      projectName: String(group?.boqName || '').trim()
    };
  }

  return null;
}

function resolveShippingFromBoqProject(boqProject) {
  if (!boqProject || typeof boqProject !== 'object') return null;
  const address = normalizeCartShippingAddress(boqProject.shippingAddress || {});
  if (!isCartShippingAddressComplete(address)) return null;
  return {
    address,
    shippingAddressId: String(boqProject.shippingAddressId || '').trim(),
    projectName: String(boqProject.location || '').trim()
  };
}

function resolveShippingFromCartDraftForItems(draft, workflowItems = []) {
  if (!draft || typeof draft !== 'object') return null;
  const items = Array.isArray(workflowItems) ? workflowItems : [];
  const lineIds = new Set(
    items.map((it) => String(it?.id ?? '').trim()).filter(Boolean)
  );
  const productIds = new Set(
    items.map((it) => String(it?.productId ?? '').trim()).filter(Boolean)
  );
  const groups = Array.isArray(draft.boqGroups) ? draft.boqGroups : [];
  for (const group of groups) {
    const groupItems = Array.isArray(group?.items) ? group.items : [];
    const overlaps = groupItems.some((it) => {
      const lineId = String(it?.id ?? '').trim();
      const productId = String(it?.productId ?? '').trim();
      return (lineId && lineIds.has(lineId)) || (productId && productIds.has(productId));
    });
    if (!overlaps) continue;
    const project = group?.boqProject;
    if (!project || typeof project !== 'object') continue;
    const address = normalizeCartShippingAddress(project.shippingAddress || {});
    if (!isCartShippingAddressComplete(address)) continue;
    return {
      address,
      shippingAddressId: String(project.shippingAddressId || '').trim(),
      projectName: String(group?.boqName || '').trim()
    };
  }
  return null;
}

/** Checkout shipping chosen in cart / supplier-select — not the full profile address book. */
export function resolveWorkflowShippingAddress({
  boqProject = null,
  cartDraft = null,
  workflowItems = []
} = {}) {
  const fromProject = resolveShippingFromBoqProject(boqProject);
  if (fromProject) return fromProject;

  const fromCartItems = resolveShippingFromCartDraftForItems(cartDraft, workflowItems);
  if (fromCartItems) return fromCartItems;

  return resolveDiscoveryShippingFromCartDraft(cartDraft);
}

/** Load persisted PO cart — same source the voice agent uses on the server. */
/** Notify App workflow state after voice syncs cart (suppliers, substitutions, PO fields). */
export function emitVoiceCartUpdated(draft) {
  if (typeof window === 'undefined' || !draft) return;
  try {
    window.dispatchEvent(new CustomEvent('voice-cart-updated', { detail: draft }));
  } catch {
    /* ignore */
  }
}

export async function fetchVoiceCartDraft() {
  const token = localStorage.getItem('token');
  const empty = {
    items: [],
    selectedVendors: {},
    substitutions: [],
    poGroups: [],
    grandTotalAllPos: 0,
    requiredDate: '',
    hasGstin: false,
    deliveryDestination: 'shipping',
    shippingAddress: {},
    billingAddress: {},
    draft: null
  };
  if (!token) return empty;

  const res = await fetch(getApiUrl('/api/po/cart'), {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.cart?.draft) {
    return empty;
  }

  const draft = data.cart.draft;
  return {
    items: flattenCartItems(draft),
    selectedVendors: draft.selectedVendors || {},
    substitutions: draft.substitutions || [],
    poGroups: Array.isArray(draft.poGroups) ? draft.poGroups : [],
    grandTotalAllPos: Number(draft.grandTotalAllPos) || 0,
    requiredDate: draft.requiredDate || '',
    hasGstin: Boolean(String(draft.gstin || '').trim()),
    deliveryDestination: draft.deliveryDestination || 'shipping',
    shippingAddress: draft.shippingAddress || {},
    billingAddress: draft.billingAddress || {},
    draft
  };
}

/** Build PO groups for Transport suggestion when draft has not stored them yet. */
export async function fetchPoGroupsForVoiceCart(voiceCart) {
  const existing = Array.isArray(voiceCart?.poGroups) ? voiceCart.poGroups : [];
  if (existing.length) return existing;

  const items = voiceCart?.items || [];
  const selectedVendors = voiceCart?.selectedVendors || {};
  if (!items.length || !Object.keys(selectedVendors).length) return [];

  const token = localStorage.getItem('token');
  if (!token) return [];

  const res = await fetch(getApiUrl('/api/po/group'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      items,
      selectedVendors,
      substitutions: voiceCart?.substitutions || []
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return [];
  return data?.groups || data?.poGroups || [];
}

export async function prepareSupplierSelectFromVoiceCart() {
  const cart = await fetchVoiceCartDraft();
  const shipping = resolveDiscoveryShippingFromCartDraft(cart.draft);
  const project = shipping
    ? {
        shippingAddress: shipping.address,
        ...(shipping.shippingAddressId ? { shippingAddressId: shipping.shippingAddressId } : {}),
        location: formatShippingAddressPreview(shipping.address)
      }
    : null;
  if (cart.items.length) persistSupplierSelectScopeFromCart(cart.items, project);
  return cart.items;
}
