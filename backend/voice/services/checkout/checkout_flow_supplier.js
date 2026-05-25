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
import { getVoiceText } from '../../i18n/index.js';
import { resolveVoiceLanguage } from '../../lib/voiceLanguage.js';
import { enterCartCheckoutFlow } from '../../lib/voice_flow_mode.js';
import { getCheckout, setCheckout } from './checkout_flow_state.js';
import { loadCartItems, syncCheckoutFromCartDraft } from './checkout_flow_cart.js';
import { syncVoiceCheckoutToCart } from './checkout_flow_sync.js';
import { advanceAfterSubstitution, advancePoDetails } from './checkout_flow_po.js';
import {
  isNoSubstitutionPhrase,
  isSubstitutionAcceptPhrase
} from '../../lib/voiceIntentPhrases.js';

export async function loadSubstitutions(client, items, selectedVendors) {
  const res = await client.post('/api/substitutions/suggest', { items, selectedVendors });
  if (!res.ok) return [];
  return Array.isArray(res.data?.suggestions) ? res.data.suggestions : [];
}

export async function startSupplierSelection(toolCtx, memory) {
  enterCartCheckoutFlow(memory);
  const { client } = toolCtx;
  const lang = resolveVoiceLanguage(memory);
  const cart = await loadCartItems(client);
  if (!cart.ok || !cart.items.length) {
    return getVoiceText('checkout.emptyCartVoice', lang, {}, '');
  }

  const rank = await client.post('/api/vendors/rank', {
    items: cart.items,
    boqId: null,
    _timestamp: Date.now()
  });
  if (!rank.ok) {
    return getVoiceText('checkout.supplierRankFailed', lang, { error: rank.error }, '');
  }

  const itemVendors = rank.data?.itemVendors || {};
  const primaryItemId = Object.keys(itemVendors)[0];
  const vendors = Array.isArray(itemVendors[primaryItemId]) ? itemVendors[primaryItemId] : [];

  if (!vendors.length) {
    return getVoiceText('checkout.noSuppliersAvailable', lang, {}, '');
  }

  setCheckout(memory, {
    items: cart.items,
    itemVendors,
    primaryItemId,
    selectedVendors: {},
    substitutions: []
  });

  const vendorLines = vendors.slice(0, 6).map((v, i) => formatVendorDetail(v, i, memory));
  memory.setPendingAction({
    type: 'await_select_supplier',
    summary: 'select a supplier',
    payload: { itemId: primaryItemId, vendors }
  });

  return truncateForSpeech(promptSuppliers(vendors.length, vendorLines, memory), VOICE_SPEECH_MAX_LEN);
}

export async function resumeCheckoutFromCart(toolCtx, memory, { forceStep = 'auto' } = {}) {
  enterCartCheckoutFlow(memory);
  const synced = await syncCheckoutFromCartDraft(toolCtx, memory);
  if (!synced.ok || !synced.items.length) {
    memory.setPendingAction(null);
    return promptCartEmpty(memory);
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
    return promptCartWithItems(synced.items.length, flow, memory);
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
    const subLines = subs.slice(0, 3).map((s, i) =>
      getVoiceText(
        'sub.suggestionLine',
        resolveVoiceLanguage(memory),
        {
          index: String(i + 1),
          title: s.title || s.suggestedItem || getVoiceText('sub.defaultTitle', resolveVoiceLanguage(memory), {}, '')
        },
        ''
      )
    );
    memory.setPendingAction({
      type: 'await_substitution',
      summary: 'substitution choice',
      payload: { suggestions: subs }
    });
    return truncateForSpeech(
      promptSubstitutions(
        getVoiceText('sub.placeholderSupplier', resolveVoiceLanguage(memory), {}, ''),
        subs.length,
        subLines,
        null,
        memory
      ),
      VOICE_SPEECH_MAX_LEN
    );
  }

  memory.setPendingAction({
    type: 'await_cart_continue',
    summary: 'review cart',
    payload: { itemCount: synced.items.length }
  });
  return promptCartWithItems(synced.items.length, flow, memory);
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
    return promptSupplierRetry(vendors.length, memory);
  }

  const chosen = vendors[idx];
  const supplierName =
    chosen.name ||
    chosen.supplierName ||
    chosen.company ||
    getVoiceText('supplier.thisSupplier', resolveVoiceLanguage(memory), {}, 'this supplier');
  const token = chosen.supplierProductId || chosen.id || chosen.vendorId;
  const selectedVendors = { ...(getCheckout(memory).selectedVendors || {}) };
  selectedVendors[itemId] = String(token);
  if (chosen.productId) selectedVendors[String(chosen.productId)] = String(token);

  setCheckout(memory, { selectedVendors });
  await syncVoiceCheckoutToCart(toolCtx, memory);

  const subs = await loadSubstitutions(toolCtx.client, getCheckout(memory).items, selectedVendors);
  if (!subs.length) {
    const next = await advanceAfterSubstitution(toolCtx, memory, []);
    return `${promptNoSubstitutions(supplierName, chosen, memory)} ${next}`;
  }

  setCheckout(memory, { substitutionSuggestions: subs });
  const subLines = subs
    .slice(0, 3)
    .map((s, i) =>
      getVoiceText(
        'sub.suggestionLine',
        resolveVoiceLanguage(memory),
        {
          index: String(i + 1),
          title: s.title || s.suggestedItem || getVoiceText('sub.defaultTitle', resolveVoiceLanguage(memory), {}, '')
        },
        ''
      )
    );
  memory.setPendingAction({
    type: 'await_substitution',
    summary: 'substitution choice',
    payload: { suggestions: subs }
  });
  return truncateForSpeech(
    promptSubstitutions(supplierName, subs.length, subLines, chosen, memory),
    VOICE_SPEECH_MAX_LEN
  );
}

export async function handleSubstitution(toolCtx, memory, utterance) {
  if (isNoSubstitutionPhrase(utterance)) {
    return advanceAfterSubstitution(toolCtx, memory, []);
  }
  if (isSubstitutionAcceptPhrase(utterance)) {
    const subs = getCheckout(memory).substitutionSuggestions || [];
    const approved = subs.map((s) => ({
      originalItem: s.originalItem,
      suggestedItem: s.suggestedItem
    }));
    return advanceAfterSubstitution(toolCtx, memory, approved);
  }
  return promptSubstitutionRetry(memory);
}
