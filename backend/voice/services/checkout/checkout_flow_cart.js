import {
  promptCartEmpty,
  promptCartWithItems,
  promptDiscoveryCartHandoff,
  promptCartContinue
} from '../../lib/voice_prompts.js';
import { isCartContinuePhrase } from '../voice_navigation_phrases.js';
import { enterCartCheckoutFlow, enterDiscoveryFlow } from '../../lib/voice_flow_mode.js';
import { flattenCartItems, setCheckout } from './checkout_flow_state.js';

export async function loadCartItems(client) {
  const cartRes = await client.get('/api/po/cart');
  if (!cartRes.ok) return { ok: false, error: cartRes.error, items: [] };
  const items = flattenCartItems(cartRes.data?.cart?.draft || {});
  return { ok: true, items, draft: cartRes.data?.cart?.draft };
}

export async function syncCheckoutFromCartDraft(toolCtx, memory) {
  const cart = await loadCartItems(toolCtx.client);
  if (!cart.ok) {
    return { ok: false, items: [], draft: null, error: cart.error };
  }
  const draft = cart.draft || {};
  setCheckout(memory, {
    items: cart.items,
    selectedVendors: draft.selectedVendors || {},
    substitutions: Array.isArray(draft.substitutions) ? draft.substitutions : []
  });
  return { ok: true, items: cart.items, draft };
}

export async function beginCartCheckoutSession(toolCtx, memory) {
  enterCartCheckoutFlow(memory);
  const synced = await syncCheckoutFromCartDraft(toolCtx, memory);
  if (!synced.ok || !synced.items.length) {
    memory.setPendingAction(null);
    return { ok: false, speech: promptCartEmpty() };
  }
  memory.setPendingAction({
    type: 'await_cart_continue',
    summary: 'review cart',
    payload: { itemCount: synced.items.length }
  });
  return {
    ok: true,
    speech: promptCartWithItems(synced.items.length, 'cart')
  };
}

export async function handleDiscoveryCartHandoff(toolCtx, memory, utterance, startSupplierSelection) {
  enterDiscoveryFlow(memory);
  if (!isCartContinuePhrase(utterance)) {
    return promptDiscoveryCartHandoff();
  }
  return startSupplierSelection(toolCtx, memory);
}

export async function handleCartContinue(toolCtx, memory, utterance, startSupplierSelection) {
  enterCartCheckoutFlow(memory);
  if (!isCartContinuePhrase(utterance)) {
    return promptCartContinue();
  }
  return startSupplierSelection(toolCtx, memory);
}
