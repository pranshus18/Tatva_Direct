/**
 * Strict separation: discovery (search→qty→cart handoff→supplier…) vs cart-only checkout.
 */

export const VOICE_FLOW_DISCOVERY = 'discovery';
export const VOICE_FLOW_CART = 'cart';

/** Only valid while in discovery flow — never set in cart-only mode. */
export const DISCOVERY_ONLY_PENDING = new Set([
  'await_pick_product',
  'await_add_quantity',
  'await_discovery_cart_handoff'
]);

/** Only valid while in cart checkout flow — never set during discovery search/qty. */
export const CART_ONLY_PENDING = new Set(['await_cart_continue']);

/** Shared after supplier step (both flows). */
export const SHARED_CHECKOUT_PENDING = new Set([
  'await_select_supplier',
  'await_substitution',
  'await_po_details',
  'await_transport',
  'await_place_confirm'
]);

export function getVoiceFlowMode(memory) {
  const mode = memory?.getContext?.('voice_flow_mode');
  if (mode === VOICE_FLOW_CART || mode === VOICE_FLOW_DISCOVERY) return mode;
  return VOICE_FLOW_DISCOVERY;
}

export function setVoiceFlowMode(memory, mode) {
  if (!memory) return;
  memory.setContext('voice_flow_mode', mode === VOICE_FLOW_CART ? VOICE_FLOW_CART : VOICE_FLOW_DISCOVERY);
}

export function isCartFlowMode(memory) {
  return getVoiceFlowMode(memory) === VOICE_FLOW_CART;
}

export function isDiscoveryFlowMode(memory) {
  return getVoiceFlowMode(memory) === VOICE_FLOW_DISCOVERY;
}

function clearPendingTypes(memory, types) {
  const pending = memory?.getPendingAction?.();
  if (pending && types.has(pending.type)) {
    memory.setPendingAction(null);
  }
}

/** Cart checkout: supplier onward only; no search/qty/handoff from discovery. */
export function enterCartCheckoutFlow(memory) {
  setVoiceFlowMode(memory, VOICE_FLOW_CART);
  clearPendingTypes(memory, DISCOVERY_ONLY_PENDING);
  memory.setContext('last_search', null);
}

/** New product path: search → pick → qty → cart handoff → supplier… */
export function enterDiscoveryFlow(memory) {
  setVoiceFlowMode(memory, VOICE_FLOW_DISCOVERY);
  clearPendingTypes(memory, CART_ONLY_PENDING);
}

/**
 * Reject pending actions that belong to the other flow (prevents overlap).
 */
export function normalizePendingForFlow(memory, action) {
  if (!action?.type) return action;
  if (isCartFlowMode(memory) && DISCOVERY_ONLY_PENDING.has(action.type)) {
    return null;
  }
  if (isDiscoveryFlowMode(memory) && CART_ONLY_PENDING.has(action.type)) {
    return null;
  }
  return action;
}

export function isDiscoveryOnlyPending(pending) {
  return Boolean(pending?.type && DISCOVERY_ONLY_PENDING.has(pending.type));
}

export function isCartOnlyPending(pending) {
  return Boolean(pending?.type && CART_ONLY_PENDING.has(pending.type));
}

/** Discovery add/search handlers must not run during cart-only checkout. */
export function canRunDiscoveryAddFlow(memory) {
  return isDiscoveryFlowMode(memory);
}

/** Cart resume / go-to-cart must not steal discovery search/qty turns. */
export function canRunCartCheckoutResume(memory, pending) {
  if (isCartFlowMode(memory)) return true;
  if (isDiscoveryOnlyPending(pending)) return false;
  return false;
}

export function shouldBlockAmbientProductSearch(memory, pending) {
  if (isCartFlowMode(memory)) return true;
  if (isDiscoveryOnlyPending(pending)) return false;
  if (!pending?.type) return false;
  return SHARED_CHECKOUT_PENDING.has(pending.type) || CART_ONLY_PENDING.has(pending.type);
}
