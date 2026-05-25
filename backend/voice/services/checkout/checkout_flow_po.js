import { isConfirm } from '../../intents.js';
import { isDefaultDatePhrase, isAddressOkPhrase } from '../../lib/voiceIntentPhrases.js';
import {
  promptPoRequiredDate,
  promptPoPayment,
  promptPoAddress,
  promptPoDateRetry,
  promptPoPaymentRetry,
  promptPoAddressRetry
} from '../../lib/voice_prompts.js';
import { truncateForSpeech } from '../../summarizeForVoice.js';
import { getVoiceText } from '../../i18n/index.js';
import { resolveVoiceLanguage } from '../../lib/voiceLanguage.js';
import {
  getCheckout,
  setCheckout,
  formatAddress,
  parsePaymentMethod,
  parseRequiredDate,
  defaultRequiredDate
} from './checkout_flow_state.js';
import { loadTransportQuotes } from './checkout_flow_transport.js';
import { syncVoiceCheckoutToCart } from './checkout_flow_sync.js';

async function loadProfile(client) {
  const res = await client.get('/api/profile');
  if (!res.ok) return null;
  const profile = res.data?.profile || res.data?.user?.profile || res.data;
  const user = res.data?.user || res.data;
  const address = user?.address || profile?.address || {};
  const gstin = String(profile?.gstin || profile?.mainGstin || user?.gstin || '').trim();
  const billingAddresses = Array.isArray(profile?.billingAddresses) ? profile.billingAddresses : [];
  return { address, gstin, billingAddresses };
}

async function groupPurchaseOrders(client, items, selectedVendors, substitutions) {
  return client.post('/api/po/group', { items, selectedVendors, substitutions });
}

function buildPoDetailsPrompt(checkout, field, memory) {
  if (field === 'requiredDate') return promptPoRequiredDate(memory);
  if (field === 'paymentMethod') return promptPoPayment(memory);
  if (field === 'confirmAddresses') {
    return promptPoAddress(formatAddress(checkout.shippingAddress), memory);
  }
  return '';
}

export async function advancePoDetails(toolCtx, memory) {
  const checkout = getCheckout(memory);
  const fields = checkout.poFieldsQueue || ['requiredDate', 'paymentMethod', 'confirmAddresses'];
  const idx = checkout.poFieldIndex || 0;

  if (idx >= fields.length) {
    return finishPoGrouping(toolCtx, memory);
  }

  const field = fields[idx];
  const lang = resolveVoiceLanguage(memory);
  setCheckout(memory, { pendingPoField: field });
  memory.setPendingAction({
    type: 'await_po_details',
    summary: getVoiceText('confirm.pendingPoDetails', lang, {}, 'purchase order details'),
    payload: { field }
  });
  return buildPoDetailsPrompt(checkout, field, memory);
}

export async function finishPoGrouping(toolCtx, memory) {
  const { client } = toolCtx;
  const checkout = getCheckout(memory);
  const groupRes = await groupPurchaseOrders(
    client,
    checkout.items,
    checkout.selectedVendors,
    checkout.substitutions || []
  );
  const lang = resolveVoiceLanguage(memory);
  if (!groupRes.ok) {
    return getVoiceText('checkout.poPrepareFailed', lang, { error: groupRes.error }, '');
  }
  const poGroups = groupRes.data?.groups || groupRes.data?.poGroups || [];
  if (!poGroups.length) {
    return getVoiceText('checkout.noPoGroups', lang, {}, '');
  }

  const grandTotal = poGroups.reduce((s, g) => s + (Number(g.total) || 0), 0);
  const groupText = poGroups
    .map((g, i) =>
      getVoiceText(
        'confirm.groupLine',
        lang,
        {
          index: String(i + 1),
          vendor: g.vendorName || getVoiceText('supplier.fallbackName', lang, {}, 'supplier'),
          total: String(Number(g.total || 0))
        },
        `Order ${i + 1}, ${g.vendorName || 'supplier'}, ${Number(g.total || 0)} rupees`
      )
    )
    .join('. ');
  setCheckout(memory, { poGroups, grandTotal, groupText });
  await syncVoiceCheckoutToCart(toolCtx, memory);

  const transportStep = await loadTransportQuotes(toolCtx, memory);
  return truncateForSpeech(transportStep);
}

export async function advanceAfterSubstitution(toolCtx, memory, substitutions) {
  setCheckout(memory, { substitutions });
  const profile = await loadProfile(toolCtx.client);
  const ship = profile?.address || {};
  setCheckout(memory, {
    shippingAddress: ship,
    billingAddress: profile?.billingAddresses?.[0]?.address || ship,
    gstin: profile?.gstin || '',
    deliveryDestination: 'shipping',
    poFieldsQueue: ['requiredDate', 'paymentMethod', 'confirmAddresses'],
    poFieldIndex: 0,
    requiredDate: defaultRequiredDate(),
    paymentMethod: 'cod'
  });
  await syncVoiceCheckoutToCart(toolCtx, memory);
  return advancePoDetails(toolCtx, memory);
}

export async function handlePoDetails(toolCtx, memory, utterance, pending) {
  const field = pending.payload?.field;
  const checkout = getCheckout(memory);
  const nextIndex = (checkout.poFieldIndex || 0) + 1;

  if (field === 'requiredDate') {
    const d =
      parseRequiredDate(utterance) || (isDefaultDatePhrase(utterance) ? defaultRequiredDate() : null);
    if (!d) return promptPoDateRetry(memory);
    setCheckout(memory, { requiredDate: d, poFieldIndex: nextIndex });
    memory.setPendingAction(null);
    await syncVoiceCheckoutToCart(toolCtx, memory);
    return advancePoDetails(toolCtx, memory);
  }

  if (field === 'paymentMethod') {
    const m = parsePaymentMethod(utterance);
    if (!m) return promptPoPaymentRetry(memory);
    setCheckout(memory, { paymentMethod: m, poFieldIndex: nextIndex });
    memory.setPendingAction(null);
    await syncVoiceCheckoutToCart(toolCtx, memory);
    return advancePoDetails(toolCtx, memory);
  }

  if (field === 'confirmAddresses') {
    if (!isAddressOkPhrase(utterance)) {
      return promptPoAddressRetry(memory);
    }
    setCheckout(memory, { poFieldIndex: nextIndex });
    memory.setPendingAction(null);
    await syncVoiceCheckoutToCart(toolCtx, memory);
    return finishPoGrouping(toolCtx, memory);
  }

  return advancePoDetails(toolCtx, memory);
}
