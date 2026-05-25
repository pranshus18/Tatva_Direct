import { getVoiceText } from '../i18n/index.js';
import { resolveVoiceLanguage } from './voiceLanguage.js';
import { isHelpPhrase as isHelpPhraseIntent } from './voiceIntentPhrases.js';
import { wrapEngaging, joinEngaging, engagementSeed } from './conversationalVoice.js';

/**
 * Spoken prompts for the one-call voice shopping + checkout flow.
 * Keep replies short for TTS; each prompt ends with what to say next.
 */

export const FLOW_STEPS = {
  search: { n: 1, label: 'Product search' },
  quantity: { n: 2, label: 'Quantity' },
  cart: { n: 3, label: 'Cart' },
  suppliers: { n: 4, label: 'Supplier selection' },
  substitution: { n: 5, label: 'Substitution' },
  po_details: { n: 6, label: 'Purchase order details' },
  transport: { n: 7, label: 'Transport selection' },
  confirm_order: { n: 8, label: 'Order confirmation' },
  done: { n: 9, label: 'Complete' }
};

function languageOf(memoryOrLanguage = null) {
  if (typeof memoryOrLanguage === 'string') return memoryOrLanguage;
  return resolveVoiceLanguage(memoryOrLanguage);
}

/** Spoken + parsed by the app to open the matching page (see voice_ui_screens.js). */
export function stepPrefix(stepKey, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const step = FLOW_STEPS[stepKey];
  if (!step) return '';
  const label = getVoiceText(`flow.stepLabel.${stepKey}`, lang, {}, step.label);
  const prefix = getVoiceText(
    'flow.stepPrefix',
    lang,
    { n: String(step.n), label },
    `Step ${step.n}, ${label}. `
  );
  return prefix.endsWith(' ') ? prefix : `${prefix} `;
}

export function formatProductChoiceLines(products, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  return (Array.isArray(products) ? products : [])
    .slice(0, 5)
    .map((p, i) =>
      getVoiceText(
        'search.productLine',
        lang,
        { index: String(i + 1), name: p.name || p.product_name || 'item' },
        `${i + 1}. ${p.name || 'item'}`
      )
    )
    .join('. ');
}

function engage(lang, body, opts = {}) {
  return wrapEngaging(lang, body, opts);
}

export function isHelpPhrase(text) {
  return isHelpPhraseIntent(text);
}

function poHelp(checkout, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const field = checkout.pendingPoField;
  if (field === 'requiredDate') {
    return `${stepPrefix('po_details', memoryOrLanguage)}${getVoiceText('help.await_po_requiredDate', lang, {}, '')}`;
  }
  if (field === 'paymentMethod') {
    return `${stepPrefix('po_details', memoryOrLanguage)}${getVoiceText('help.await_po_payment', lang, {}, '')}`;
  }
  if (field === 'confirmAddresses') {
    return `${stepPrefix('po_details', memoryOrLanguage)}${getVoiceText('help.await_po_addresses', lang, {}, '')}`;
  }
  return `${stepPrefix('po_details', memoryOrLanguage)}${getVoiceText('help.await_po_generic', lang, {}, '')}`;
}

export function helpForPending(pendingType, checkout = {}, flowMode = 'discovery', memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const helpLead = getVoiceText('help.lead', lang, {}, 'No worries — here\'s where we are.');
  if (!pendingType && flowMode === 'cart') {
    return joinEngaging([helpLead, getVoiceText('help.cartMode', lang, {}, '')]);
  }
  if (!pendingType) {
    return joinEngaging([helpLead, getVoiceText('help.discoveryMode', lang, {}, '')]);
  }
  const map = {
    await_add_quantity: `${stepPrefix('quantity', memoryOrLanguage)}${getVoiceText('help.await_add_quantity', lang, {}, '')}`,
    await_pick_product: `${stepPrefix('search', memoryOrLanguage)}${getVoiceText('help.await_pick_product', lang, {}, '')}`,
    await_discovery_cart_handoff: `${stepPrefix('cart', memoryOrLanguage)}${getVoiceText(
      'help.await_discovery_cart_handoff',
      lang,
      {},
      ''
    )}`,
    await_cart_continue: `${stepPrefix('cart', memoryOrLanguage)}${getVoiceText('help.await_cart_continue', lang, {}, '')}`,
    await_select_supplier: `${stepPrefix('suppliers', memoryOrLanguage)}${getVoiceText(
      'help.await_select_supplier',
      lang,
      {},
      ''
    )}`,
    await_substitution: `${stepPrefix('substitution', memoryOrLanguage)}${getVoiceText('help.await_substitution', lang, {}, '')}`,
    await_po_details: poHelp(checkout, memoryOrLanguage),
    await_place_confirm: `${stepPrefix('confirm_order', memoryOrLanguage)}${getVoiceText(
      'help.await_place_confirm',
      lang,
      {},
      ''
    )}`,
    await_transport: `${stepPrefix('transport', memoryOrLanguage)}${getVoiceText('help.await_transport', lang, {}, '')}`
  };
  const body = map[pendingType] || getVoiceText('help.fallback', lang, {}, '');
  return joinEngaging([helpLead, body]);
}

// —— Search ——

export function promptSearchSingle(productName, memoryOrLanguage = null) {
  const language = languageOf(memoryOrLanguage);
  const fallback = `Nice — I found ${productName}. Say add to cart, or number 1.`;
  const body = `${stepPrefix('search', memoryOrLanguage)}${getVoiceText('search.single', language, { productName }, fallback)}`;
  return engage(language, body, {
    leadPool: 'searchLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null,
    seed: engagementSeed(typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null)
  });
}

export function promptSearchMultiple(lines, total, memoryOrLanguage = null) {
  const language = languageOf(memoryOrLanguage);
  const fallback = `I found ${total} options for you. ${lines}. Which one — number or name?`;
  const body = getVoiceText('search.multiple', language, { total, lines }, fallback);
  return engage(language, body, {
    leadPool: 'searchLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null,
    seed: engagementSeed(typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null)
  });
}

export function promptSearchNotFound(query, memoryOrLanguage = null) {
  const language = languageOf(memoryOrLanguage);
  const key = query ? 'search.notFound.withQuery' : 'search.notFound.noQuery';
  const fallback = query
    ? `I could not find a close match for "${query}". Say the product name again.`
    : 'I could not find that product. Say the product name you need.';
  const body = getVoiceText(key, language, { query }, fallback);
  return engage(language, body, {
    leadPool: 'notFoundLead',
    ack: true,
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptSearchFuzzy(query, lines, total, memoryOrLanguage = null) {
  const language = languageOf(memoryOrLanguage);
  const fallback = `I heard "${query}". Here are ${total} close matches: ${lines}. Say the product number or name.`;
  const body = getVoiceText('search.fuzzy', language, { query, total, lines }, fallback);
  return engage(language, body, {
    leadPool: 'searchLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

// —— Cart / quantity ——

export function promptAskQuantity(productName, memoryOrLanguage = null) {
  const language = languageOf(memoryOrLanguage);
  const fallback = `Great pick. How many ${productName}? Just say the number.`;
  const body = `${stepPrefix('quantity', memoryOrLanguage)}${getVoiceText('search.askQuantity', language, { productName }, fallback)}`;
  return engage(language, body, {
    leadPool: 'qtyLead',
    ack: true,
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null,
    seed: engagementSeed(typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null)
  });
}

export function promptPickProduct(choices, memoryOrLanguage = null) {
  const language = languageOf(memoryOrLanguage);
  const fallback = `Which product do you want? ${choices}. Say the number or product name.`;
  const body = `${stepPrefix('search', memoryOrLanguage)}${getVoiceText('search.pickProduct', language, { choices }, fallback)}`;
  return engage(language, body, {
    leadPool: 'searchLead',
    ack: true,
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptAddedToCart(productName, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const body = getVoiceText('cart.added', lang, { productName }, `${productName} is in your cart now.`);
  return engage(lang, body, {
    leadPool: 'cartLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptCartContinue(memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const body = `${stepPrefix('cart', memoryOrLanguage)}${getVoiceText('cart.continue', lang, {}, '')}`;
  return engage(lang, body, { ack: true, memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null });
}

export function promptDiscoveryCartHandoff(memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const body = `${stepPrefix('cart', memoryOrLanguage)}${getVoiceText('cart.discoveryHandoff', lang, {}, '')}`;
  return engage(lang, body, {
    leadPool: 'cartLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptQtyIncreasedInCart(productName, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const body = getVoiceText(
    'cart.qtyIncreased',
    lang,
    { productName },
    `Added more ${productName} to your cart.`
  );
  return engage(lang, body, {
    leadPool: 'cartLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

/** Added or qty bump + what to do next — one natural breath for TTS. */
export function promptAddedOrQtyWithHandoff(productName, quantityMerged, memoryOrLanguage = null) {
  return joinEngaging([
    quantityMerged
      ? promptQtyIncreasedInCart(productName, memoryOrLanguage)
      : promptAddedToCart(productName, memoryOrLanguage),
    promptDiscoveryCartHandoff(memoryOrLanguage)
  ]);
}

/** @deprecated Use promptAddedOrQtyWithHandoff */
export function promptAddedWithHandoff(productName, memoryOrLanguage = null) {
  return promptAddedOrQtyWithHandoff(productName, false, memoryOrLanguage);
}

export function promptCartWithItems(count, flowMode = 'discovery', memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const n = Math.max(0, Number(count) || 0);
  const items =
    n === 1
      ? getVoiceText('cart.itemsCountOne', lang, {}, '1 item')
      : getVoiceText('cart.itemsCountMany', lang, { count: String(n) }, `${n} items`);
  const key = flowMode === 'cart' ? 'cart.withItems.cart' : 'cart.withItems.discovery';
  const body = getVoiceText(key, lang, { items }, '');
  return engage(lang, body, {
    leadPool: 'cartLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptCartCheckoutOnly(memoryOrLanguage = null) {
  return getVoiceText('cart.checkoutOnly', languageOf(memoryOrLanguage), {}, '');
}

export function promptCartEmpty(memoryOrLanguage = null) {
  return getVoiceText('cart.empty', languageOf(memoryOrLanguage), {}, '');
}

const GO_TO_STEP_KEY = {
  product_discovery: 'search',
  cart: 'cart',
  supplier_select: 'suppliers',
  substitution: 'substitution',
  create_po: 'po_details',
  transport: 'transport',
  orders: 'done'
};

export function promptGoToScreen(screenKey, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const stepKey = GO_TO_STEP_KEY[screenKey];
  let body = '';
  if (screenKey === 'product_discovery') {
    body = getVoiceText('nav.productDiscovery', lang, {}, '');
  } else if (screenKey === 'orders') {
    body = getVoiceText('nav.orders', lang, {}, '');
  } else {
    const labelKey = `nav.screen.${screenKey}`;
    const label = getVoiceText(labelKey, lang, {}, 'Page');
    body = getVoiceText('nav.generic', lang, { label }, '');
  }
  const prefixed = stepKey ? `${stepPrefix(stepKey, memoryOrLanguage)}${body}` : body;
  return engage(lang, prefixed, {
    leadPool: 'navLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptResumeCheckout(memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const body = getVoiceText('nav.resumeCheckout', lang, {}, '');
  return engage(lang, body, { leadPool: 'navLead', ack: true, memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null });
}

// —— Suppliers ——

const LOCATION_UNKNOWN = /^(location not specified|n\/a|na|unknown)$/i;

function cleanLocationForSpeech(loc) {
  return String(loc || '')
    .replace(/\s*\(road route\)\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSpeakableLocation(loc) {
  const s = cleanLocationForSpeech(loc);
  if (!s || LOCATION_UNKNOWN.test(s)) return false;
  if (/^outlet geo location/i.test(s)) return false;
  return true;
}

function extractPincodeFromVendor(v) {
  const direct = String(v?.pincode || v?.supplierPincode || v?.postalCode || '').replace(/\D/g, '');
  if (/^\d{6}$/.test(direct)) return direct;
  if (/^\d{5,6}$/.test(direct)) return direct.slice(0, 6);

  const sources = [v?.location, v?.supplierLocation, v?.distanceSourceLocation];
  for (const raw of sources) {
    const match = String(raw || '').match(/\b(\d{6})\b/);
    if (match) return match[1];
  }
  return '';
}

/** Speak pincode digit-by-digit for clearer TTS (e.g. "4 1 1 0 0 7"). */
export function formatPincodeForSpeech(pincode) {
  const digits = String(pincode || '').replace(/\D/g, '');
  if (digits.length < 5) return '';
  return digits.split('').join(' ');
}

/** Human-readable supplier location for TTS (city/state + pincode). */
export function formatVendorLocation(v, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const pincode = extractPincodeFromVendor(v);
  const digits = formatPincodeForSpeech(pincode);
  const pinPhrase = pincode
    ? getVoiceText('supplier.pincodeIs', lang, { digits }, `pincode is ${digits}`)
    : '';

  const candidates = [v?.location, v?.supplierLocation, v?.distanceSourceLocation];
  for (const raw of candidates) {
    if (!isSpeakableLocation(raw)) continue;
    let loc = cleanLocationForSpeech(raw);
    if (pincode) {
      loc = loc
        .replace(new RegExp(`\\b${pincode}\\b`, 'g'), '')
        .replace(/,\s*,/g, ',')
        .replace(/^,\s*|\s*,\s*$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    const locOk = loc && !/^,|,\s*$/.test(loc) && loc.toLowerCase() !== 'india';
    if (locOk && pinPhrase) {
      return getVoiceText(
        'supplier.locatedWithPin',
        lang,
        { loc, pinPart: pinPhrase },
        `located in ${loc}, ${pinPhrase}`
      );
    }
    if (locOk) {
      return getVoiceText('supplier.locatedOnly', lang, { loc }, `located in ${loc}`);
    }
    if (pinPhrase) {
      return getVoiceText('supplier.pinOnly', lang, { pinPart: pinPhrase }, pinPhrase);
    }
  }

  return pinPhrase;
}

export function formatVendorDetail(v, i, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const name = v.name || v.supplierName || v.company || getVoiceText('supplier.fallbackName', lang, {}, 'Supplier');
  const location = formatVendorLocation(v, memoryOrLanguage);
  const price =
    v.price != null
      ? getVoiceText('supplier.partPrice', lang, { price: v.price }, `price ${v.price} rupees`)
      : '';
  const stock =
    v.stock != null
      ? getVoiceText('supplier.partStock', lang, { stock: v.stock }, `${v.stock} in stock`)
      : '';
  const dist =
    v.distanceKm != null
      ? getVoiceText(
          'supplier.partDist',
          lang,
          { distKm: String(Math.round(v.distanceKm)) },
          `${Math.round(v.distanceKm)} kilometres away`
        )
      : '';
  const rating =
    v.rating != null
      ? getVoiceText('supplier.partRating', lang, { rating: String(v.rating) }, `rating ${v.rating} out of 5`)
      : '';
  const lead =
    v.leadTime != null
      ? getVoiceText('supplier.partLead', lang, { days: String(v.leadTime) }, `delivery about ${v.leadTime} days`)
      : '';
  const parts = [location, price, stock, dist, rating, lead].filter(Boolean);
  const index = String(i + 1);
  return getVoiceText(
    'supplier.detailLine',
    lang,
    { index, name, parts: parts.join('. ') },
    `Supplier ${i + 1}, ${name}. ${parts.join('. ')}.`
  );
}

export function promptSuppliers(count, vendorLines, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const intro =
    count === 1
      ? getVoiceText('supplier.introOne', lang, {}, '')
      : getVoiceText('supplier.introMany', lang, { count: String(count) }, '');
  const pick = getVoiceText('supplier.pickInstruction', lang, {}, '');
  const body = `${stepPrefix('suppliers', memoryOrLanguage)}${intro} ${vendorLines.join(' ')} ${pick}`;
  return engage(lang, truncate(body), {
    leadPool: 'supplierLead',
    ack: true,
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptSupplierRetry(max, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  return getVoiceText('supplier.retry', lang, { max: String(max) }, '');
}

export function promptSupplierChosen(name, vendor = null, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const loc = vendor ? formatVendorLocation(vendor, memoryOrLanguage) : '';
  const body = loc
    ? getVoiceText('supplier.chosenWithLoc', lang, { name, loc }, '')
    : getVoiceText('supplier.chosenNoLoc', lang, { name }, '');
  return engage(lang, body, {
    leadPool: 'supplierLead',
    alwaysAck: true,
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

// —— Substitution ——

export function promptNoSubstitutions(supplierName, vendor = null, memoryOrLanguage = null) {
  const chosen = promptSupplierChosen(supplierName, vendor, memoryOrLanguage);
  const rest = getVoiceText('sub.noAfterChosen', languageOf(memoryOrLanguage), {}, '');
  return `${chosen} ${rest}`;
}

export function promptSubstitutions(supplierName, count, subLines, vendor = null, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const chosen = promptSupplierChosen(supplierName, vendor, memoryOrLanguage);
  const lines = subLines.join('. ');
  const introKey = count === 1 ? 'sub.introOne' : 'sub.introMany';
  const intro = getVoiceText(
    introKey,
    lang,
    count === 1 ? { lines } : { count: String(count), lines },
    ''
  );
  return truncate(`${chosen} ${stepPrefix('substitution', memoryOrLanguage)}${intro}`);
}

export function promptSubstitutionRetry(memoryOrLanguage = null) {
  return `${stepPrefix('substitution', memoryOrLanguage)}${getVoiceText('sub.retry', languageOf(memoryOrLanguage), {}, '')}`;
}

// —— PO details ——

export function promptPoRequiredDate(memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const body = getVoiceText('po.requiredDate', lang, {}, '');
  return engage(lang, body, {
    leadPool: 'poLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptPoPayment(memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const body = getVoiceText('po.payment', lang, {}, '');
  return engage(lang, body, {
    leadPool: 'poLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptPoAddress(shipLine, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const line =
    shipLine ||
    getVoiceText('po.addressFromProfile', lang, {}, 'from your profile');
  const body = getVoiceText('po.address', lang, { shipLine: line }, '');
  return engage(lang, body, {
    leadPool: 'poLead',
    ack: true,
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptPoDateRetry(memoryOrLanguage = null) {
  return getVoiceText('po.dateRetry', languageOf(memoryOrLanguage), {}, '');
}

export function promptPoPaymentRetry(memoryOrLanguage = null) {
  return getVoiceText('po.paymentRetry', languageOf(memoryOrLanguage), {}, '');
}

export function promptPoAddressRetry(memoryOrLanguage = null) {
  return getVoiceText('po.addressRetry', languageOf(memoryOrLanguage), {}, '');
}

export function formatPaymentLabel(method, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const m = String(method || '').toLowerCase();
  if (m === 'cod') return getVoiceText('pay.cod', lang, {}, 'cash on delivery');
  if (m === 'online') return getVoiceText('pay.online', lang, {}, 'online payment');
  if (m === 'bank_transfer') return getVoiceText('pay.bank', lang, {}, 'bank transfer');
  return method ? String(method) : getVoiceText('pay.notSet', lang, {}, 'not set');
}

export function promptOrderSummary(
  groups,
  grandTotal,
  requiredDate,
  paymentMethod,
  transportSummary,
  memoryOrLanguage = null
) {
  const lang = languageOf(memoryOrLanguage);
  const pay = formatPaymentLabel(paymentMethod, memoryOrLanguage);
  const transportPart = transportSummary
    ? getVoiceText('confirm.transportPart', lang, { transportSummary }, ` Transport: ${transportSummary}.`)
    : '';
  const body = getVoiceText(
    'confirm.summary',
    lang,
    {
      groups,
      grandTotal,
      requiredDate,
      pay,
      transportPart
    },
    ''
  );
  return engage(lang, truncate(body), {
    leadPool: 'confirmLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptPlaceOrderRetry(memoryOrLanguage = null) {
  return `${stepPrefix('confirm_order', memoryOrLanguage)}${getVoiceText(
    'confirm.placeRetry',
    languageOf(memoryOrLanguage),
    {},
    ''
  )}`;
}

export function promptPlacingOrder(memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const body = getVoiceText('confirm.placing', lang, {}, '');
  return engage(lang, body, {
    leadPool: 'waitLead',
    alwaysAck: true,
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptLoadingTransport(memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const body = getVoiceText('transport.loading', lang, {}, '');
  return engage(lang, body, {
    leadPool: 'waitLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

// —— Transport ——

export function promptTransportOptions(vendorLines, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const joined = vendorLines.join(' ');
  const body = getVoiceText('transport.optionsIntro', lang, { vendorLines: joined }, '');
  return engage(lang, truncate(body), {
    leadPool: 'transportLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptTransportRetry(memoryOrLanguage = null) {
  return `${stepPrefix('transport', memoryOrLanguage)}${getVoiceText('transport.retry', languageOf(memoryOrLanguage), {}, '')}`;
}

export function promptTransportQuotesFailed(error, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const detail = error ? ` ${error}.` : '';
  return truncate(
    `${stepPrefix('transport', memoryOrLanguage)}${getVoiceText('transport.quotesFailed', lang, { detail }, '')}`
  );
}

export function promptTransportNoQuotes(message, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const detail = message ? ` ${message}.` : '';
  return truncate(
    `${stepPrefix('transport', memoryOrLanguage)}${getVoiceText('transport.noQuotes', lang, { detail }, '')}`
  );
}

export function promptTransportPickRemaining(count, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const extra =
    count > 1
      ? getVoiceText('transport.pickRemainingMany', lang, { count: String(count) }, '')
      : getVoiceText('transport.pickRemainingOne', lang, {}, '');
  return `${stepPrefix('transport', memoryOrLanguage)}${getVoiceText('transport.pickIntro', lang, { extra }, '')}`;
}

export function promptTransportRequiredBeforeOrder(memoryOrLanguage = null) {
  return `${stepPrefix('transport', memoryOrLanguage)}${getVoiceText(
    'transport.requiredBeforeOrder',
    languageOf(memoryOrLanguage),
    {},
    ''
  )}`;
}

export function promptOrderComplete(orderNumbers, memoryOrLanguage = null) {
  const lang = languageOf(memoryOrLanguage);
  const key = orderNumbers ? 'done.withNumber' : 'done.withoutNumber';
  const body = getVoiceText(key, lang, { orderNumbers: orderNumbers || '' }, '');
  if (typeof memoryOrLanguage === 'object' && memoryOrLanguage?.setJson) {
    memoryOrLanguage.setJson('voice_navigate_orders', true);
  }
  return engage(lang, body, {
    leadPool: 'doneLead',
    memory: typeof memoryOrLanguage === 'object' ? memoryOrLanguage : null
  });
}

export function promptCheckoutCancelled(memoryOrLanguage = null) {
  return getVoiceText('cart.checkoutCancelled', languageOf(memoryOrLanguage), {}, '');
}

function truncate(text, max = 4500) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
