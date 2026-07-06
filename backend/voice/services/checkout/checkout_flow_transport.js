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
import {
  isTransportRetryPhrase,
  listTransportVendorEntriesFromCheckout,
  vendorsMissingTransport,
  hasMandatoryTransportSelected
} from '../../lib/transportGate.js';
import { isPlaceOrderPhrase, isTransportDonePhrase } from '../../lib/voiceIntentPhrases.js';
import { setVoiceUiScreenKey } from '../../lib/voice_ui_screens.js';
import { getCheckout, setCheckout, setAwaitTransport } from './checkout_flow_state.js';
import { voiceText } from '../../lib/voiceText.js';

function listTransportVendorEntries(checkout) {
  return listTransportVendorEntriesFromCheckout(checkout);
}

/** Same provider list as TransportSuggestion.jsx (logistics.providers on each shipment). */
function providersFromShipment(sh) {
  const lg = sh?.logistics;
  if (Array.isArray(lg?.providers) && lg.providers.length) return lg.providers;
  if (Array.isArray(sh?.providers) && sh.providers.length) return sh.providers;
  return [];
}

export function buildTransportSummary(byVendorId, optionsByVendor, memory) {
  const fallback = voiceText(memory, 'transport.summarySupplier');
  return Object.entries(byVendorId || {})
    .map(([vendorId, name]) => {
      const label = optionsByVendor[vendorId]?.vendorName || fallback;
      return `${label}, ${name}`;
    })
    .join('. ');
}

function beginTransportLoadingFeedback(toolCtx) {
  toolCtx?.emitStatus?.('status.transport', { speak: true });
  toolCtx?.armTransportStillWait?.();
}

function endTransportLoadingFeedback(toolCtx) {
  toolCtx?.clearTransportStillWait?.();
}

export async function loadTransportQuotes(toolCtx, memory) {
  const { client } = toolCtx;
  const checkout = getCheckout(memory);

  beginTransportLoadingFeedback(toolCtx);
  let logisticsRes;
  try {
    logisticsRes = await client.post(
    '/api/logistics/quote-transport-groups',
    {
      poGroups: checkout.poGroups,
      shippingAddress: checkout.shippingAddress,
      billingAddress: checkout.billingAddress || checkout.shippingAddress,
      deliveryDestination: checkout.deliveryDestination || 'shipping',
      hasGstin: Boolean(checkout.gstin)
    },
    { timeoutMs: 150000 }
    );
  } finally {
    endTransportLoadingFeedback(toolCtx);
  }

  if (!logisticsRes.ok) {
    setAwaitTransport(memory, { quotesLoaded: false, loadError: logisticsRes.error || 'unknown error' });
    return truncateForSpeech(promptTransportQuotesFailed(logisticsRes.error, memory));
  }

  const shipments = Array.isArray(logisticsRes.data?.shipments) ? logisticsRes.data.shipments : [];
  const optionsByVendor = {};
  for (const sh of shipments) {
    const vendorId = String(sh.transportGroupId || sh.vendorId || sh.supplierId || '');
    const providers = providersFromShipment(sh);
    optionsByVendor[vendorId] = {
      vendorName: sh.vendorName || sh.supplier,
      providers,
      logisticsSuccess: Boolean(sh?.logistics?.success)
    };
  }
  setCheckout(memory, { shipments, optionsByVendor });

  const hasAnyQuotes = shipments.some(
    (sh) => providersFromShipment(sh).length > 0 && (sh?.logistics?.success !== false)
  );
  if (!hasAnyQuotes || !shipments.length) {
    const logisticsMsg =
      shipments[0]?.logistics?.message || voiceText(memory, 'transport.logisticsDefault');
    setAwaitTransport(memory, { optionsByVendor, quotesLoaded: true, noQuotes: true });
    return truncateForSpeech(promptTransportNoQuotes(logisticsMsg, memory));
  }

  const vendorLines = [];
  for (const sh of shipments) {
    const vendorId = String(sh.transportGroupId || sh.vendorId || sh.supplierId || '');
    const vendorName = sh.vendorName || sh.supplier || voiceText(memory, 'transport.vendorFallback');
    const providers = providersFromShipment(sh).length
      ? providersFromShipment(sh)
      : optionsByVendor[vendorId]?.providers || [];
    const opts = providers.slice(0, 5).map((p, i) => {
      const rate =
        p.rate != null ? voiceText(memory, 'transport.rateRupees', { rate: String(p.rate) }) : '';
      return voiceText(memory, 'transport.optionLine', {
        index: String(i + 1),
        name: p.name || voiceText(memory, 'transport.courierDefault'),
        rate
      });
    });
    vendorLines.push(
      voiceText(memory, 'transport.forVendor', {
        vendorName,
        options: opts.join('. ') || voiceText(memory, 'transport.noQuotesLine')
      })
    );
  }

  setAwaitTransport(memory, { optionsByVendor, quotesLoaded: true });

  return truncateForSpeech(promptTransportOptions(vendorLines, memory));
}

export async function advanceToOrderConfirm(toolCtx, memory) {
  const checkout = getCheckout(memory);
  const missing = vendorsMissingTransport(checkout);
  if (missing.length) {
    setAwaitTransport(memory, {
      optionsByVendor: checkout.optionsByVendor,
      quotesLoaded: true
    });
    return truncateForSpeech(promptTransportPickRemaining(missing.length, memory));
  }

  if (!hasMandatoryTransportSelected(checkout)) {
    setAwaitTransport(memory, {
      optionsByVendor: checkout.optionsByVendor,
      quotesLoaded: Boolean(checkout.optionsByVendor)
    });
    return truncateForSpeech(promptTransportRequiredBeforeOrder(memory));
  }

  const transportSummary = buildTransportSummary(
    checkout.transportByVendor,
    checkout.optionsByVendor,
    memory
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
      formatPaymentLabel(checkout.paymentMethod, memory),
      transportSummary,
      memory
    )
  );
}

/**
 * Sync transport picked on the Transport suggestion UI into voice checkout memory.
 */
export async function applyUiTransportSelection(toolCtx, memory, selection = {}) {
  const byVendorId = selection.byVendorId || selection.by_vendor_id || {};
  const byVendorCourierDetail =
    selection.byVendorCourierDetail || selection.by_vendor_courier_detail || {};

  if (!Object.keys(byVendorId).length) {
    return truncateForSpeech(promptTransportRequiredBeforeOrder(memory));
  }

  setCheckout(memory, {
    transportByVendor: byVendorId,
    transportDetailByVendor: byVendorCourierDetail
  });

  const updated = getCheckout(memory);
  const missing = vendorsMissingTransport(updated);
  if (missing.length) {
    setAwaitTransport(memory, {
      optionsByVendor: updated.optionsByVendor,
      quotesLoaded: true
    });
    return truncateForSpeech(promptTransportPickRemaining(missing.length, memory));
  }

  setVoiceUiScreenKey(memory, 'create_po');
  return advanceToOrderConfirm(toolCtx, memory);
}

export async function selectTransport(toolCtx, memory, utterance, pending) {
  const checkoutNow = getCheckout(memory);
  if (isTransportDonePhrase(utterance) && hasMandatoryTransportSelected(checkoutNow)) {
    setVoiceUiScreenKey(memory, 'create_po');
    return advanceToOrderConfirm(toolCtx, memory);
  }

  if (isTransportRetryPhrase(utterance)) {
    const step = await loadTransportQuotes(toolCtx, memory);
    return truncateForSpeech(step);
  }

  if (isPlaceOrderPhrase(utterance)) {
    return truncateForSpeech(promptTransportRequiredBeforeOrder(memory));
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
        ? promptTransportQuotesFailed(pending.payload.loadError, memory)
        : promptTransportNoQuotes(undefined, memory)
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
    return promptTransportRetry(memory);
  }

  setCheckout(memory, { transportByVendor: byVendorId, transportDetailByVendor });

  const updated = getCheckout(memory);
  const missing = vendorsMissingTransport(updated);
  if (missing.length) {
    setAwaitTransport(memory, {
      optionsByVendor: updated.optionsByVendor,
      quotesLoaded: true
    });
    return truncateForSpeech(promptTransportPickRemaining(missing.length, memory));
  }

  setVoiceUiScreenKey(memory, 'create_po');
  return advanceToOrderConfirm(toolCtx, memory);
}

export async function handleTransport(toolCtx, memory, utterance, pending) {
  return selectTransport(toolCtx, memory, utterance, pending);
}
