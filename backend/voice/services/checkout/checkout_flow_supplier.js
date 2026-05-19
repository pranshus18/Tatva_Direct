import { truncateForSpeech, VOICE_SPEECH_MAX_LEN } from '../../summarizeForVoice.js';
import { parseSelectionIndex } from '../../lib/spokenNumbers.js';
import {
  formatVendorDetail,
  promptSuppliers,
  promptSupplierRetry,
  promptNoSubstitutions,
  promptSubstitutions,
  promptSubstitutionRetry,
  promptCartEmpty,
  promptCartWithItems
} from '../../lib/voice_prompts.js';
import { enterCartCheckoutFlow } from '../../lib/voice_flow_mode.js';
import { getCheckout, setCheckout } from './checkout_flow_state.js';
import { loadCartItems, syncCheckoutFromCartDraft } from './checkout_flow_cart.js';
import { advanceAfterSubstitution, advancePoDetails } from './checkout_flow_po.js';

export async function loadSubstitutions(client, items, selectedVendors) {
  const res = await client.post('/api/substitutions/suggest', { items, selectedVendors });
  if (!res.ok) return [];
  return Array.isArray(res.data?.suggestions) ? res.data.suggestions : [];
}

export async function startSupplierSelection(toolCtx, memory) {
  const { client } = toolCtx;
  const cart = await loadCartItems(client);
  if (!cart.ok || !cart.items.length) {
    return 'Your cart is empty. Say a product name to search first, for example Mac Air M2.';
  }

  const rank = await client.post('/api/vendors/rank', {
    items: cart.items,
    boqId: null,
    _timestamp: Date.now()
  });
  if (!rank.ok) {
    return `I could not load suppliers: ${rank.error}. Try again in a moment.`;
  }

  const itemVendors = rank.data?.itemVendors || {};
  const primaryItemId = Object.keys(itemVendors)[0];
  const vendors = Array.isArray(itemVendors[primaryItemId]) ? itemVendors[primaryItemId] : [];

  if (!vendors.length) {
    return 'No suppliers are available for this product right now. Try another product.';
  }

  setCheckout(memory, {
    items: cart.items,
    itemVendors,
    primaryItemId,
    selectedVendors: {},
    substitutions: []
  });

  const vendorLines = vendors.slice(0, 6).map((v, i) => formatVendorDetail(v, i));
  memory.setPendingAction({
    type: 'await_select_supplier',
    summary: 'select a supplier',
    payload: { itemId: primaryItemId, vendors }
  });

  return truncateForSpeech(promptSuppliers(vendors.length, vendorLines), VOICE_SPEECH_MAX_LEN);
}

export async function resumeCheckoutFromCart(toolCtx, memory, { forceStep = 'auto' } = {}) {
  enterCartCheckoutFlow(memory);
  const synced = await syncCheckoutFromCartDraft(toolCtx, memory);
  if (!synced.ok || !synced.items.length) {
    memory.setPendingAction(null);
    return promptCartEmpty();
  }

  const selectedVendors = synced.draft?.selectedVendors || {};
  const hasVendors = Object.keys(selectedVendors).length > 0;
  const draftSubs = synced.draft?.substitutions;
  const flow = 'cart';

  if (forceStep === 'cart') {
    memory.setPendingAction({
      type: 'await_cart_continue',
      summary: 'review cart',
      payload: { itemCount: synced.items.length }
    });
    return promptCartWithItems(synced.items.length, flow);
  }

  if (forceStep === 'supplier_select') {
    return startSupplierSelection(toolCtx, memory);
  }

  if (!hasVendors && forceStep === 'auto') {
    return startSupplierSelection(toolCtx, memory);
  }

  if (hasVendors) {
    if (Array.isArray(draftSubs)) {
      return advanceAfterSubstitution(toolCtx, memory, draftSubs);
    }
    const subs = await loadSubstitutions(toolCtx.client, synced.items, selectedVendors);
    if (!subs.length) {
      return advanceAfterSubstitution(toolCtx, memory, []);
    }
    setCheckout(memory, { substitutionSuggestions: subs });
    const subLines = subs
      .slice(0, 3)
      .map((s, i) => `Suggestion ${i + 1}, ${s.title || s.suggestedItem || 'alternative product'}`);
    memory.setPendingAction({
      type: 'await_substitution',
      summary: 'substitution choice',
      payload: { suggestions: subs }
    });
    return truncateForSpeech(
      promptSubstitutions('your supplier', subs.length, subLines, null),
      VOICE_SPEECH_MAX_LEN
    );
  }

  memory.setPendingAction({
    type: 'await_cart_continue',
    summary: 'review cart',
    payload: { itemCount: synced.items.length }
  });
  return promptCartWithItems(synced.items.length, flow);
}

export async function handleSupplierSelect(toolCtx, memory, utterance, pending) {
  const vendors = pending.payload?.vendors || [];
  const itemId = pending.payload?.itemId;
  if (!vendors.length) return startSupplierSelection(toolCtx, memory);

  let idx = parseSelectionIndex(utterance, vendors.length);
  if (idx == null) {
    const t = utterance.toLowerCase();
    idx = vendors.findIndex((v) => {
      const name = String(v.name || v.supplierName || v.company || '').toLowerCase();
      return name && t.includes(name.slice(0, 10));
    });
  }
  if (idx == null) {
    return promptSupplierRetry(vendors.length);
  }

  const chosen = vendors[idx];
  const supplierName = chosen.name || chosen.supplierName || chosen.company || 'this supplier';
  const token = chosen.supplierProductId || chosen.id || chosen.vendorId;
  const selectedVendors = { ...(getCheckout(memory).selectedVendors || {}) };
  selectedVendors[itemId] = String(token);
  if (chosen.productId) selectedVendors[String(chosen.productId)] = String(token);

  setCheckout(memory, { selectedVendors });

  const subs = await loadSubstitutions(toolCtx.client, getCheckout(memory).items, selectedVendors);
  if (!subs.length) {
    const next = await advanceAfterSubstitution(toolCtx, memory, []);
    return `${promptNoSubstitutions(supplierName, chosen)} ${next}`;
  }

  setCheckout(memory, { substitutionSuggestions: subs });
  const subLines = subs
    .slice(0, 3)
    .map((s, i) => `Suggestion ${i + 1}, ${s.title || s.suggestedItem || 'alternative product'}`);
  memory.setPendingAction({
    type: 'await_substitution',
    summary: 'substitution choice',
    payload: { suggestions: subs }
  });
  return truncateForSpeech(
    promptSubstitutions(supplierName, subs.length, subLines, chosen),
    VOICE_SPEECH_MAX_LEN
  );
}

export async function handleSubstitution(toolCtx, memory, utterance) {
  const t = utterance.toLowerCase().trim();
  if (
    /^(no|nope|skip|none)$/i.test(t) ||
    /\b(no substitution|skip substitution|skip|none|no substitute|without substitution)\b/.test(t)
  ) {
    return advanceAfterSubstitution(toolCtx, memory, []);
  }
  if (/\b(yes|accept|approve)\b/.test(t)) {
    const subs = getCheckout(memory).substitutionSuggestions || [];
    const approved = subs.map((s) => ({
      originalItem: s.originalItem,
      suggestedItem: s.suggestedItem
    }));
    return advanceAfterSubstitution(toolCtx, memory, approved);
  }
  return promptSubstitutionRetry();
}
