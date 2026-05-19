import { isConfirm } from '../../intents.js';
import {
  promptPoRequiredDate,
  promptPoPayment,
  promptPoAddress,
  promptPoDateRetry,
  promptPoPaymentRetry,
  promptPoAddressRetry,
  promptLoadingTransport
} from '../../lib/voice_prompts.js';
import {
  getCheckout,
  setCheckout,
  formatAddress,
  parsePaymentMethod,
  parseRequiredDate,
  defaultRequiredDate
} from './checkout_flow_state.js';
import { loadTransportQuotes } from './checkout_flow_transport.js';

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

function buildPoDetailsPrompt(checkout, field) {
  if (field === 'requiredDate') return promptPoRequiredDate();
  if (field === 'paymentMethod') return promptPoPayment();
  if (field === 'confirmAddresses') return promptPoAddress(formatAddress(checkout.shippingAddress));
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
  setCheckout(memory, { pendingPoField: field });
  memory.setPendingAction({
    type: 'await_po_details',
    summary: 'purchase order details',
    payload: { field }
  });
  return buildPoDetailsPrompt(checkout, field);
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
  if (!groupRes.ok) {
    return `I could not prepare your purchase order: ${groupRes.error}`;
  }
  const poGroups = groupRes.data?.groups || groupRes.data?.poGroups || [];
  if (!poGroups.length) {
    return 'No purchase order could be created. Please check your supplier selection.';
  }

  const grandTotal = poGroups.reduce((s, g) => s + (Number(g.total) || 0), 0);
  const groupText = poGroups
    .map((g, i) => `Order ${i + 1}, ${g.vendorName || 'supplier'}, ${Number(g.total || 0)} rupees`)
    .join('. ');
  setCheckout(memory, { poGroups, grandTotal, groupText });

  const loading = promptLoadingTransport();
  const transportStep = await loadTransportQuotes(toolCtx, memory);
  return `${loading} ${transportStep}`;
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
  return advancePoDetails(toolCtx, memory);
}

export async function handlePoDetails(toolCtx, memory, utterance, pending) {
  const field = pending.payload?.field;
  const checkout = getCheckout(memory);
  const nextIndex = (checkout.poFieldIndex || 0) + 1;

  if (field === 'requiredDate') {
    const d = parseRequiredDate(utterance) || (/\bdefault\b/i.test(utterance) ? defaultRequiredDate() : null);
    if (!d) return promptPoDateRetry();
    setCheckout(memory, { requiredDate: d, poFieldIndex: nextIndex });
    memory.setPendingAction(null);
    return advancePoDetails(toolCtx, memory);
  }

  if (field === 'paymentMethod') {
    const m = parsePaymentMethod(utterance);
    if (!m) return promptPoPaymentRetry();
    setCheckout(memory, { paymentMethod: m, poFieldIndex: nextIndex });
    memory.setPendingAction(null);
    return advancePoDetails(toolCtx, memory);
  }

  if (field === 'confirmAddresses') {
    if (!isConfirm(utterance) && !/\b(correct|ok|okay|yes)\b/i.test(utterance)) {
      return promptPoAddressRetry();
    }
    setCheckout(memory, { poFieldIndex: nextIndex });
    memory.setPendingAction(null);
    return finishPoGrouping(toolCtx, memory);
  }

  return advancePoDetails(toolCtx, memory);
}
