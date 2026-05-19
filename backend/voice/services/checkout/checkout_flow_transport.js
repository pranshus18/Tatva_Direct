import { truncateForSpeech, VOICE_SPEECH_MAX_LEN } from '../../summarizeForVoice.js';
import { parseSelectionIndex } from '../../lib/spokenNumbers.js';
import {
  promptLoadingTransport,
  promptTransportOptions,
  promptTransportRetry,
  promptTransportQuotesFailed,
  promptTransportNoQuotes,
  promptTransportPickRemaining,
  promptTransportRequiredBeforeOrder,
  promptOrderSummary,
  formatPaymentLabel
} from '../../lib/voice_prompts.js';
import { isTransportRetryPhrase, listTransportVendorEntriesFromCheckout, vendorsMissingTransport, hasMandatoryTransportSelected } from '../../lib/transportGate.js';
import { getCheckout, setCheckout, setAwaitTransport } from './checkout_flow_state.js';

function listTransportVendorEntries(checkout) {
  return listTransportVendorEntriesFromCheckout(checkout);
}

export function buildTransportSummary(byVendorId, optionsByVendor) {
  return Object.entries(byVendorId || {})
    .map(([vendorId, name]) => {
      const label = optionsByVendor[vendorId]?.vendorName || 'supplier';
      return `${label}, ${name}`;
    })
    .join('. ');
}

export async function loadTransportQuotes(toolCtx, memory) {
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
    setAwaitTransport(memory, { quotesLoaded: false, loadError: logisticsRes.error || 'unknown error' });
    return truncateForSpeech(promptTransportQuotesFailed(logisticsRes.error));
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
  if (!hasAnyQuotes || !shipments.length) {
    const logisticsMsg =
      shipments[0]?.logistics?.message ||
      'No transport quotes for your delivery address. Update your profile pincode on the website.';
    setAwaitTransport(memory, { optionsByVendor, quotesLoaded: true, noQuotes: true });
    return truncateForSpeech(promptTransportNoQuotes(logisticsMsg));
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

  setAwaitTransport(memory, { optionsByVendor, quotesLoaded: true });

  return truncateForSpeech(promptTransportOptions(vendorLines));
}

export async function advanceToOrderConfirm(toolCtx, memory) {
  const checkout = getCheckout(memory);
  const missing = vendorsMissingTransport(checkout);
  if (missing.length) {
    setAwaitTransport(memory, {
      optionsByVendor: checkout.optionsByVendor,
      quotesLoaded: true
    });
    return truncateForSpeech(promptTransportPickRemaining(missing.length));
  }

  if (!hasMandatoryTransportSelected(checkout)) {
    setAwaitTransport(memory, {
      optionsByVendor: checkout.optionsByVendor,
      quotesLoaded: Boolean(checkout.optionsByVendor)
    });
    return truncateForSpeech(promptTransportRequiredBeforeOrder());
  }

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

export async function selectTransport(toolCtx, memory, utterance, pending) {
  if (isTransportRetryPhrase(utterance)) {
    const loading = promptLoadingTransport();
    const step = await loadTransportQuotes(toolCtx, memory);
    return truncateForSpeech(`${loading} ${step}`);
  }

  if (/\b(place (the )?order|skip transport|continue without transport)\b/i.test(utterance)) {
    return truncateForSpeech(promptTransportRequiredBeforeOrder());
  }

  const checkout = getCheckout(memory);
  setCheckout(memory, {
    optionsByVendor: pending.payload?.optionsByVendor || checkout.optionsByVendor
  });

  const entries = listTransportVendorEntries(getCheckout(memory));
  const hasProviders = entries.some((e) => e.providers.length > 0);
  if (!hasProviders) {
    return truncateForSpeech(
      pending.payload?.loadError
        ? promptTransportQuotesFailed(pending.payload.loadError)
        : promptTransportNoQuotes()
    );
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

  const updated = getCheckout(memory);
  const missing = vendorsMissingTransport(updated);
  if (missing.length) {
    setAwaitTransport(memory, {
      optionsByVendor: updated.optionsByVendor,
      quotesLoaded: true
    });
    return truncateForSpeech(promptTransportPickRemaining(missing.length));
  }

  return advanceToOrderConfirm(toolCtx, memory);
}

export async function handleTransport(toolCtx, memory, utterance, pending) {
  return selectTransport(toolCtx, memory, utterance, pending);
}
