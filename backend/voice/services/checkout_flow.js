import { truncateForSpeech } from '../summarizeForVoice.js';
import { isReject, isConfirm } from '../intents.js';
import { parseSelectionIndex, isExplicitCancel } from '../lib/spokenNumbers.js';
import {
  isHelpPhrase,
  helpForPending,
  formatVendorDetail,
  promptSuppliers,
  promptSupplierRetry,
  promptNoSubstitutions,
  promptSubstitutions,
  promptSubstitutionRetry,
  promptPoRequiredDate,
  promptPoPayment,
  promptPoAddress,
  promptPoDateRetry,
  promptPoPaymentRetry,
  promptPoAddressRetry,
  promptOrderSummary,
  promptPlaceOrderRetry,
  promptPlacingOrder,
  promptLoadingTransport,
  promptTransportOptions,
  promptTransportRetry,
  promptOrderComplete,
  promptCheckoutCancelled,
  formatPaymentLabel
} from '../lib/voice_prompts.js';

const CHECKOUT_TYPES = new Set([
  'await_select_supplier',
  'await_substitution',
  'await_po_details',
  'await_transport',
  'await_place_confirm'
]);

function flattenCartItems(draft) {
  const items = [];
  for (const g of draft?.boqGroups || []) {
    for (const it of g.items || []) items.push(it);
  }
  return items;
}

function getCheckout(memory) {
  return memory.getContext('checkout', {});
}

function setCheckout(memory, patch) {
  memory.setContext('checkout', { ...getCheckout(memory), ...patch });
}

function formatAddress(addr) {
  if (!addr) return '';
  return [addr.line1, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
}

function parsePaymentMethod(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(cod|cash on delivery|cash)\b/.test(t)) return 'cod';
  if (/\b(online|upi|card|razorpay)\b/.test(t)) return 'online';
  if (/\b(bank transfer|neft|rtgs)\b/.test(t)) return 'bank_transfer';
  return null;
}

function parseRequiredDate(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (/\btomorrow\b/i.test(t)) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = t.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](20\d{2})\b/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  const parsed = Date.parse(t);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function defaultRequiredDate() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export async function loadCartItems(client) {
  const cartRes = await client.get('/api/po/cart');
  if (!cartRes.ok) return { ok: false, error: cartRes.error, items: [] };
  const items = flattenCartItems(cartRes.data?.cart?.draft || {});
  return { ok: true, items, draft: cartRes.data?.cart?.draft };
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

  return truncateForSpeech(promptSuppliers(vendors.length, vendorLines));
}

async function loadSubstitutions(client, items, selectedVendors) {
  const res = await client.post('/api/substitutions/suggest', { items, selectedVendors });
  if (!res.ok) return [];
  return Array.isArray(res.data?.suggestions) ? res.data.suggestions : [];
}

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

async function advancePoDetails(toolCtx, memory) {
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

async function finishPoGrouping(toolCtx, memory) {
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

async function loadTransportQuotes(toolCtx, memory) {
  const { client } = toolCtx;
  const checkout = getCheckout(memory);

  const logisticsRes = await client.post(
    '/api/logistics/service-providers',
    {
      poGroups: checkout.poGroups,
      shippingAddress: checkout.shippingAddress,
      billingAddress: checkout.billingAddress || checkout.shippingAddress,
      deliveryDestination: checkout.deliveryDestination || 'shipping',
      hasGstin: Boolean(checkout.gstin)
    },
    { timeoutMs: 150000 }
  );

  if (!logisticsRes.ok) {
    memory.setPendingAction({
      type: 'await_place_confirm',
      summary: 'place the order',
      payload: { skipTransport: true }
    });
    return truncateForSpeech(
      `Transport quotes could not be loaded: ${logisticsRes.error}. ${promptOrderSummary(
        checkout.groupText || '',
        checkout.grandTotal?.toLocaleString?.('en-IN') || String(checkout.grandTotal),
        checkout.requiredDate,
        formatPaymentLabel(checkout.paymentMethod),
        'not selected'
      )}`
    );
  }

  const shipments = Array.isArray(logisticsRes.data?.shipments) ? logisticsRes.data.shipments : [];
  const optionsByVendor = {};
  for (const sh of shipments) {
    const vendorId = String(sh.vendorId || sh.supplierId || '');
    const providers = Array.isArray(sh.providers) && sh.providers.length
      ? sh.providers
      : Array.isArray(sh.logistics?.providers)
        ? sh.logistics.providers
        : [];
    optionsByVendor[vendorId] = {
      vendorName: sh.vendorName || sh.supplier,
      providers
    };
  }
  setCheckout(memory, { shipments, optionsByVendor });

  const hasAnyQuotes = Object.values(optionsByVendor).some((e) => e.providers?.length > 0);
  if (!hasAnyQuotes) {
    const logisticsMsg =
      shipments[0]?.logistics?.message ||
      'No transport quotes for your delivery address. Update your profile pincode on the website.';
    memory.setPendingAction({
      type: 'await_place_confirm',
      summary: 'place the order',
      payload: { skipTransport: true }
    });
    return truncateForSpeech(
      `${logisticsMsg} Say place the order to continue, or update your shipping address first. ${promptOrderSummary(
        checkout.groupText || '',
        checkout.grandTotal?.toLocaleString?.('en-IN') || String(checkout.grandTotal),
        checkout.requiredDate,
        formatPaymentLabel(checkout.paymentMethod),
        'skipped, no quotes'
      )}`
    );
  }

  if (!shipments.length) {
    memory.setPendingAction({
      type: 'await_place_confirm',
      summary: 'place the order',
      payload: { skipTransport: true }
    });
    return truncateForSpeech(
      `${promptOrderSummary(
        checkout.groupText || '',
        checkout.grandTotal?.toLocaleString?.('en-IN') || String(checkout.grandTotal),
        checkout.requiredDate,
        formatPaymentLabel(checkout.paymentMethod),
        'not selected, no quotes available'
      )}`
    );
  }

  const vendorLines = [];
  for (const sh of shipments) {
    const vendorId = String(sh.vendorId || sh.supplierId || '');
    const vendorName = sh.vendorName || sh.supplier || 'Supplier';
    const providers = optionsByVendor[vendorId]?.providers || [];
    const opts = providers.slice(0, 5).map((p, i) => {
      const rate = p.rate != null ? `${p.rate} rupees` : '';
      return `option ${i + 1}, ${p.name || 'Courier'}, ${rate}`;
    });
    vendorLines.push(`For ${vendorName}: ${opts.join('. ') || 'no quotes'}`);
  }

  memory.setPendingAction({
    type: 'await_transport',
    summary: 'select transport',
    payload: { optionsByVendor }
  });

  return truncateForSpeech(promptTransportOptions(vendorLines));
}

function buildTransportSummary(byVendorId, optionsByVendor) {
  return Object.entries(byVendorId || {})
    .map(([vendorId, name]) => {
      const label = optionsByVendor[vendorId]?.vendorName || 'supplier';
      return `${label}, ${name}`;
    })
    .join('. ');
}

async function advanceToOrderConfirm(toolCtx, memory) {
  const checkout = getCheckout(memory);
  const transportSummary = buildTransportSummary(
    checkout.transportByVendor,
    checkout.optionsByVendor
  );

  memory.setPendingAction({
    type: 'await_place_confirm',
    summary: 'place the order',
    payload: {}
  });

  return truncateForSpeech(
    promptOrderSummary(
      checkout.groupText || '',
      checkout.grandTotal?.toLocaleString?.('en-IN') || String(checkout.grandTotal || ''),
      checkout.requiredDate,
      formatPaymentLabel(checkout.paymentMethod),
      transportSummary
    )
  );
}

function providersFromShipment(sh) {
  if (Array.isArray(sh?.providers) && sh.providers.length) return sh.providers;
  if (Array.isArray(sh?.logistics?.providers) && sh.logistics.providers.length) {
    return sh.logistics.providers;
  }
  return [];
}

function listTransportVendorEntries(checkout) {
  const optionsByVendor = checkout.optionsByVendor || {};
  const fromOptions = Object.entries(optionsByVendor)
    .filter(([id]) => id)
    .map(([vendorId, entry]) => ({
      vendorId,
      providers: Array.isArray(entry.providers) ? entry.providers : []
    }));
  if (fromOptions.length) return fromOptions;

  return (checkout.shipments || [])
    .map((sh) => ({
      vendorId: String(sh.vendorId || sh.supplierId || sh.vendor_id || ''),
      providers: providersFromShipment(sh)
    }))
    .filter((e) => e.vendorId);
}

async function selectTransport(toolCtx, memory, utterance, pending) {
  const checkout = getCheckout(memory);
  setCheckout(memory, {
    optionsByVendor: pending.payload?.optionsByVendor || checkout.optionsByVendor
  });

  const entries = listTransportVendorEntries(getCheckout(memory));
  const hasProviders = entries.some((e) => e.providers.length > 0);
  if (!hasProviders && /\b(place (the )?order|skip transport|continue)\b/i.test(utterance)) {
    return advanceToOrderConfirm(toolCtx, memory);
  }

  const idx = parseSelectionIndex(utterance, 20);
  const t = utterance.toLowerCase();
  const byVendorId = { ...(checkout.transportByVendor || {}) };
  const transportDetailByVendor = { ...(checkout.transportDetailByVendor || {}) };
  let matched = false;

  for (const { vendorId, providers } of entries) {
    if (!providers.length) continue;

    let pick = null;
    if (idx != null && idx < providers.length) {
      pick = providers[idx];
    }
    if (!pick) {
      pick = providers.find((p) => t.includes(String(p.name || '').toLowerCase().slice(0, 8)));
    }
    if (!pick && entries.length === 1 && /^\d{1,2}$/.test(t.trim())) {
      const n = Number.parseInt(t.trim(), 10);
      if (n >= 1 && n <= providers.length) pick = providers[n - 1];
    }
    if (!pick) continue;

    matched = true;
    byVendorId[vendorId] = String(pick.name || pick.courier_name || '').trim();
    transportDetailByVendor[vendorId] = pick;
  }

  if (!matched) {
    return promptTransportRetry();
  }

  setCheckout(memory, { transportByVendor: byVendorId, transportDetailByVendor });
  return advanceToOrderConfirm(toolCtx, memory);
}

async function placeOrderAndConfirmTransport(toolCtx, memory) {
  const { client } = toolCtx;
  const checkout = getCheckout(memory);

  const createRes = await client.post('/api/po/create', {
    poGroups: checkout.poGroups,
    requiredDate: checkout.requiredDate,
    paymentMethod: checkout.paymentMethod,
    deliveryDestination: checkout.gstin ? checkout.deliveryDestination || 'shipping' : 'shipping',
    shippingAddress: checkout.shippingAddress,
    billingAddress: checkout.billingAddress || checkout.shippingAddress,
    gstin: checkout.gstin || null
  });
  if (!createRes.ok) {
    return `Order creation failed: ${createRes.error}`;
  }

  const orders = createRes.data?.orders || [];
  if (!orders.length) {
    return 'Orders were not created. Please finish on the website.';
  }

  const byVendorId = checkout.transportByVendor || {};
  const transportDetailByVendor = checkout.transportDetailByVendor || {};

  if (Object.keys(byVendorId).length > 0) {
    const orderIds = orders.map((o) => o.id).filter(Boolean);
    const perOrderTransport = orders.map((o) => {
      const sid = String(o.supplierId || '');
      const det = transportDetailByVendor[sid];
      const row = {
        orderId: o.id,
        shippingProvider: byVendorId[sid] || '',
        trackingNumber: null,
        trackingUrl: null,
        transportNotes: 'Voice checkout'
      };
      if (det?.courier_company_id) row.courierCompanyId = Number(det.courier_company_id);
      if (det?.vehicle_type_id) row.vehicleTypeId = Number(det.vehicle_type_id);
      if (det?.rate != null) {
        row.quotedTransportAmount = Number(String(det.rate).replace(/,/g, '')) || null;
      }
      return row;
    });

    const confirmRes = await client.post('/api/po/transport/confirm', {
      orderIds,
      perOrderTransport
    });
    if (!confirmRes.ok) {
      const nums = orders.map((o) => o.order_number || o.id).join(', ');
      return `Order created${nums ? ` (${nums})` : ''}, but transport booking failed: ${confirmRes.error}. Finish transport on the website.`;
    }
  }

  memory.setPendingAction(null);
  const nums = orders.map((o) => o.order_number || o.id).join(', ');
  return truncateForSpeech(promptOrderComplete(nums));
}

async function handleSupplierSelect(toolCtx, memory, utterance, pending) {
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
    return `${promptNoSubstitutions(supplierName)} ${next}`;
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
  return truncateForSpeech(promptSubstitutions(supplierName, subs.length, subLines));
}

async function advanceAfterSubstitution(toolCtx, memory, substitutions) {
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

async function handleSubstitution(toolCtx, memory, utterance) {
  const t = utterance.toLowerCase().trim();
  if (
    /^(no|nope|skip|none)$/i.test(t) ||
    /\b(no substitution|skip|none|no substitute|without substitution)\b/.test(t)
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

async function handlePoDetails(toolCtx, memory, utterance, pending) {
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

async function handlePlaceConfirm(toolCtx, memory, utterance) {
  if (isReject(utterance)) {
    memory.setPendingAction(null);
    return 'Order not placed. Say a product name to start again.';
  }
  if (!isConfirm(utterance) && !/\b(place (the )?order|confirm order|submit)\b/i.test(utterance)) {
    return promptPlaceOrderRetry();
  }
  memory.setPendingAction(null);
  const placing = promptPlacingOrder();
  const result = await placeOrderAndConfirmTransport(toolCtx, memory);
  return `${placing} ${result}`;
}

async function handleTransport(toolCtx, memory, utterance, pending) {
  return selectTransport(toolCtx, memory, utterance, pending);
}

export async function tryCheckoutFlow(text, toolCtx, memory) {
  const utterance = String(text || '').trim();
  const pending = memory.getPendingAction();

  if (isHelpPhrase(utterance)) {
    const checkout = getCheckout(memory);
    if (pending?.type) {
      return helpForPending(pending.type, checkout);
    }
    return 'Step 1, search. Say a product name. Then quantity, supplier, substitution, PO details, transport, and finally say place the order to confirm — all in this call.';
  }

  if (pending && CHECKOUT_TYPES.has(pending.type)) {
    const pendingType = pending.type;
    const isNumericPick =
      pendingType === 'await_select_supplier' || pendingType === 'await_transport';
    const selectionMax =
      pendingType === 'await_select_supplier'
        ? (pending.payload?.vendors || []).length
        : 20;
    const parsedSelection =
      isNumericPick && selectionMax > 0 ? parseSelectionIndex(utterance, selectionMax) : null;

    if (
      pendingType !== 'await_substitution' &&
      parsedSelection == null &&
      isExplicitCancel(utterance, { pendingType })
    ) {
      memory.setPendingAction(null);
      return promptCheckoutCancelled();
    }
  }

  if (!pending) {
    if (/\b(place (the )?order|checkout|complete order)\b/i.test(utterance)) {
      const checkout = getCheckout(memory);
      if (checkout.poGroups?.length) {
        return handlePlaceConfirm(toolCtx, memory, utterance);
      }
      return 'Add a product and choose a supplier before placing an order.';
    }
    return null;
  }

  if (!CHECKOUT_TYPES.has(pending.type)) return null;

  switch (pending.type) {
    case 'await_select_supplier':
      return handleSupplierSelect(toolCtx, memory, utterance, pending);
    case 'await_substitution':
      return handleSubstitution(toolCtx, memory, utterance);
    case 'await_po_details':
      return handlePoDetails(toolCtx, memory, utterance, pending);
    case 'await_place_confirm':
      return handlePlaceConfirm(toolCtx, memory, utterance);
    case 'await_transport':
      return handleTransport(toolCtx, memory, utterance, pending);
    default:
      return null;
  }
}
