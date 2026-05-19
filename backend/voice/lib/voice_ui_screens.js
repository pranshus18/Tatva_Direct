/**
 * Maps voice checkout state → frontend routes so the user sees the real page for each step.
 */

import { FLOW_STEPS } from './voice_prompts.js';
import { getVoiceFlowMode, VOICE_FLOW_CART } from './voice_flow_mode.js';

export const VOICE_UI_SCREENS = {
  product_discovery: {
    path: '/product-discovery',
    query: '?voice=1',
    label: 'Product discovery'
  },
  cart: {
    path: '/cart',
    query: '?voice=1',
    label: 'Cart'
  },
  supplier_select: {
    path: '/supplier-select',
    query: '?from=cart&voice=1',
    label: 'Supplier selection'
  },
  substitution: {
    path: '/substitution',
    query: '?voice=1',
    label: 'Substitution'
  },
  create_po: {
    path: '/create-po',
    query: '?voice=1',
    label: 'Create purchase order'
  },
  transport: {
    path: '/transport-suggestion',
    query: '?voice=1',
    label: 'Transport'
  },
  orders: {
    path: '/your-orders',
    label: 'Your orders'
  },
  voice: {
    path: '/voice',
    label: 'Voice shop'
  }
};

/** Voice flow step key → UI screen key (aligned with spoken Step N labels). */
const FLOW_STEP_TO_SCREEN = {
  search: 'product_discovery',
  quantity: 'product_discovery',
  cart: 'cart',
  suppliers: 'supplier_select',
  substitution: 'substitution',
  po_details: 'create_po',
  confirm_order: 'create_po',
  transport: 'transport',
  done: 'orders'
};

const PENDING_TO_SCREEN = {
  await_pick_product: 'product_discovery',
  await_add_quantity: 'product_discovery',
  await_discovery_cart_handoff: 'cart',
  await_cart_continue: 'cart',
  await_select_supplier: 'supplier_select',
  await_substitution: 'substitution',
  await_po_details: 'create_po',
  await_place_confirm: 'create_po',
  await_transport: 'transport'
};

/**
 * Parse the last "Step N, Label" from the assistant reply — matches what the user hears.
 */
export function resolveVoiceUiScreenFromReply(replyText) {
  const text = String(replyText || '');
  const matches = [...text.matchAll(/Step\s+(\d+)\s*,\s*([^.;]+?)(?=\s*\.|\s*Say\b|$)/gi)];
  if (!matches.length) return null;

  const last = matches[matches.length - 1];
  const label = String(last[2] || '')
    .trim()
    .toLowerCase();

  for (const [stepKey, meta] of Object.entries(FLOW_STEPS)) {
    if (label === meta.label.toLowerCase()) {
      const screenKey = FLOW_STEP_TO_SCREEN[stepKey];
      if (screenKey && VOICE_UI_SCREENS[screenKey]) return VOICE_UI_SCREENS[screenKey];
    }
  }

  if (label.includes('supplier')) return VOICE_UI_SCREENS.supplier_select;
  if (label.includes('substitution')) return VOICE_UI_SCREENS.substitution;
  if (label.includes('transport')) return VOICE_UI_SCREENS.transport;
  if (label.includes('purchase order') || label.includes('order confirmation')) {
    return VOICE_UI_SCREENS.create_po;
  }
  if (label.includes('cart')) return VOICE_UI_SCREENS.cart;
  if (label.includes('product search') || label.includes('quantity')) {
    return VOICE_UI_SCREENS.product_discovery;
  }
  if (label.includes('complete')) return VOICE_UI_SCREENS.orders;

  return null;
}

export function setVoiceUiScreenKey(memory, screenKey) {
  if (!memory || !screenKey) return;
  memory.setContext('voice_ui_screen', screenKey);
}

export function syncVoiceUiScreenForPending(memory, pendingType) {
  const screenKey = PENDING_TO_SCREEN[pendingType];
  if (screenKey) setVoiceUiScreenKey(memory, screenKey);
}

export function resolveVoiceUiScreen(memory, replyText = '') {
  if (!memory) return null;

  const fromReply = resolveVoiceUiScreenFromReply(replyText);
  if (fromReply) return fromReply;

  const explicitKey = memory.getContext?.('voice_ui_screen');
  if (explicitKey && VOICE_UI_SCREENS[explicitKey]) {
    return VOICE_UI_SCREENS[explicitKey];
  }

  const pending = memory.getPendingAction?.();
  const pendingType = pending?.type;
  const checkout = memory.getContext?.('checkout', {}) || {};

  if (pendingType && PENDING_TO_SCREEN[pendingType]) {
    return VOICE_UI_SCREENS[PENDING_TO_SCREEN[pendingType]];
  }

  const hasCart = Boolean(checkout.items?.length);
  const hasVendors = Boolean(Object.keys(checkout.selectedVendors || {}).length);
  const hasSubs = Boolean(checkout.substitutionSuggestions?.length);
  const hasPo = Boolean(checkout.poGroups?.length || checkout.poFieldsQueue?.length);

  if (hasPo) return VOICE_UI_SCREENS.create_po;
  if (hasSubs && hasVendors) return VOICE_UI_SCREENS.substitution;
  if (hasCart && hasVendors) return VOICE_UI_SCREENS.substitution;
  if (hasCart && !hasVendors) return VOICE_UI_SCREENS.cart;
  if (hasCart) return VOICE_UI_SCREENS.cart;

  if (getVoiceFlowMode(memory) === VOICE_FLOW_CART) {
    return null;
  }

  const lastSearch = memory.getContext?.('last_search');
  if (lastSearch?.products?.length) return VOICE_UI_SCREENS.product_discovery;

  return null;
}

export function voiceScreenToPayload(screen) {
  if (!screen?.path) return null;
  const path = `${screen.path}${screen.query || ''}`;
  const screenKey =
    Object.entries(VOICE_UI_SCREENS).find(([, v]) => v.path === screen.path)?.[0] || 'unknown';
  return {
    path,
    label: screen.label || '',
    screen: screenKey
  };
}
