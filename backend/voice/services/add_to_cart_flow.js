import { productCatalogService } from './product_catalog_service.js';
import { toolCallingEngine } from './tool_calling_engine.js';
import { ActionType } from '../core/routeTypes.js';
import { truncateForSpeech } from '../summarizeForVoice.js';
import { isLikelyProductSearch } from '../lib/productQueryParser.js';
import {
  enterDiscoveryFlow,
  canRunDiscoveryAddFlow,
  getVoiceFlowMode,
  isCartFlowMode
} from '../lib/voice_flow_mode.js';
import { parseGoToScreenIntent } from './voice_navigation_phrases.js';
import {
  parseQuantity,
  parseVoicePickQuantity,
  parseSelectionIndex,
  isExplicitCancel,
  isQuantityOnlyUtterance
} from '../lib/spokenNumbers.js';
import { parseAddToCartUtterance } from '../lib/addToCartParse.js';
import {
  isAddToCartIntent as isAddToCartIntentPhrase,
  isAffirmShortPhrase,
  isPickConfirmPhrase,
  isSearchRestartPhrase,
  isShortControlUtterance
} from '../lib/voiceIntentPhrases.js';
import {
  isHelpPhrase,
  helpForPending,
  promptAskQuantity,
  promptPickProduct,
  promptAddedWithHandoff,
  promptCheckoutCancelled,
  formatProductChoiceLines
} from '../lib/voice_prompts.js';
import { getVoiceText } from '../i18n/index.js';
import { resolveVoiceLanguage } from '../lib/voiceLanguage.js';


async function runSearchFromUtterance(toolCtx, memory, utterance) {
  const lang = resolveVoiceLanguage(memory);
  const catalog = await productCatalogService.searchFromUtterance(
    toolCtx.client,
    utterance,
    memory
  );
  if (!catalog.ok) {
    return catalog.error === 'Request timed out'
      ? getVoiceText('search.requestTimeout', lang, {}, '')
      : getVoiceText('search.serviceUnavailable', lang, {}, '');
  }
  return productCatalogService.formatSearchSpeech(catalog, memory);
}

function shouldRestartProductSearch(utterance) {
  const t = String(utterance || '').trim();
  if (!t || isAddToCartIntent(t) || isHelpPhrase(t)) return false;
  if (isQuantityOnlyUtterance(t)) return false;
  if (isShortControlUtterance(t)) return false;
  return isSearchRestartPhrase(t) || isLikelyProductSearch(t);
}

export function isAddToCartIntent(text) {
  return isAddToCartIntentPhrase(text);
}

function normalizeProduct(p) {
  return {
    id: p.id || p.product_id,
    name: p.name || p.product_name || 'item'
  };
}

async function executeAdd(toolCtx, product, quantity) {
  const p = normalizeProduct(product);
  const result = await toolCallingEngine.execute(
    toolCtx,
    ActionType.ADD_TO_CART,
    {
      product_id: p.id,
      product_name: p.name,
      quantity: Math.max(1, Math.floor(quantity) || 1)
    },
    ''
  );
  if (!result?.ok) {
    const lang = resolveVoiceLanguage(toolCtx.memory);
    return result?.speech || getVoiceText('cart.addFailed', lang, { productName: p.name }, '');
  }

  try {
    await toolCtx.tools?.get_cart?.();
  } catch {
    /* cart refresh is best-effort */
  }
  if (typeof toolCtx.onCartUpdated === 'function') {
    try {
      toolCtx.onCartUpdated();
    } catch {
      /* ignore */
    }
  }

  enterDiscoveryFlow(toolCtx.memory);
  toolCtx.memory.setPendingAction({
    type: 'await_discovery_cart_handoff',
    summary: 'discovery cart handoff before supplier',
    payload: { productName: p.name }
  });
  return promptAddedWithHandoff(p.name, toolCtx.memory);
}

/**
 * Multi-step add-to-cart in the same voice call (after search).
 */
export async function tryAddToCartFlow(text, toolCtx, memory) {
  const utterance = String(text || '').trim();
  const pending = memory.getPendingAction();

  if (!canRunDiscoveryAddFlow(memory)) {
    if (parseGoToScreenIntent(utterance) === 'product_discovery') {
      enterDiscoveryFlow(memory);
      return null;
    }
    return null;
  }

  if (isCartFlowMode(memory)) {
    return null;
  }

  if (isHelpPhrase(utterance) && pending) {
    return helpForPending(pending.type, memory.getContext('checkout', {}), getVoiceFlowMode(memory), memory);
  }

  if (
    pending &&
    (pending.type === 'await_add_quantity' || pending.type === 'await_pick_product') &&
    isExplicitCancel(utterance, { pendingType: pending.type })
  ) {
    memory.setPendingAction(null);
    return promptCheckoutCancelled(memory);
  }

  if (pending?.type === 'await_add_quantity') {
    const lower = utterance.toLowerCase();
    if (isAffirmShortPhrase(lower)) {
      return promptAskQuantity(pending.payload.name, memory);
    }

    if (shouldRestartProductSearch(utterance)) {
      memory.setPendingAction(null);
      return runSearchFromUtterance(toolCtx, memory, utterance);
    }

    let qty = parseVoicePickQuantity(utterance);
    if (qty == null) qty = parseQuantity(utterance);
    if (qty == null) {
      return promptAskQuantity(pending.payload.name, memory);
    }
    memory.setPendingAction(null);
    const speech = await executeAdd(toolCtx, pending.payload, qty);
    return speech;
  }

  if (pending?.type === 'await_pick_product') {
    const products = pending.payload.products || [];
    if (!products.length) {
      memory.setPendingAction(null);
      return getVoiceText('cart.needSearchBeforeAdd', resolveVoiceLanguage(memory), {}, '');
    }

    let idx = parseSelectionIndex(utterance, products.length);

    if (idx == null) {
      const byName = productCatalogService.resolveProductFromSession(memory, utterance);
      if (byName) {
        idx = products.findIndex((p) => p.id === byName.id);
        if (idx < 0) idx = null;
      }
    }

    if (idx == null && isAddToCartIntent(utterance)) {
      if (products.length === 1) {
        idx = 0;
      } else {
        const addParsed = parseAddToCartUtterance(utterance);
        if (addParsed.productHint) {
          const byHint = productCatalogService.resolveProductFromSession(memory, addParsed.productHint);
          if (byHint) {
            idx = products.findIndex((p) => p.id === byHint.id);
            if (idx < 0) idx = null;
          }
        }
        if (idx == null && addParsed.quantity != null && products.length === 1) {
          memory.setPendingAction(null);
          return executeAdd(toolCtx, products[0], addParsed.quantity);
        }
      }
    }

    if (idx == null && products.length === 1) {
      const lower = utterance.toLowerCase();
      if (isPickConfirmPhrase(lower) || isAffirmShortPhrase(lower)) {
        idx = 0;
      }
    }

    if (idx == null && products.length === 1 && isQuantityOnlyUtterance(utterance)) {
      const qty = parseQuantity(utterance);
      memory.setPendingAction(null);
      return executeAdd(toolCtx, products[0], qty);
    }

    if (idx == null && isSearchRestartPhrase(utterance)) {
      memory.setPendingAction(null);
      return runSearchFromUtterance(toolCtx, memory, utterance);
    }

    if (idx == null) {
      return promptPickProduct(formatProductChoiceLines(products, memory), memory);
    }

    const product = products[idx];
    if (isQuantityOnlyUtterance(utterance) && products.length === 1) {
      const qty = parseQuantity(utterance);
      if (qty != null) {
        memory.setPendingAction(null);
        return executeAdd(toolCtx, product, qty);
      }
    }

    memory.setPendingAction({
      type: 'await_add_quantity',
      summary: `add ${product.name}`,
      payload: { id: product.id, name: product.name }
    });
    return promptAskQuantity(product.name, memory);
  }

  if (!isAddToCartIntent(utterance)) return null;

  if (isHelpPhrase(utterance)) {
    return getVoiceText('help.discoveryAddSteps', resolveVoiceLanguage(memory), {}, '');
  }

  const last = memory.getContext('last_search');
  const products = last?.products || [];
  const addParsed = parseAddToCartUtterance(utterance);
  let product =
    productCatalogService.resolveProductFromSession(memory, addParsed.productHint || utterance) ||
    productCatalogService.resolveProductFromSession(memory, utterance);
  const qtyInPhrase = addParsed.quantity ?? parseQuantity(utterance);

  if (product && qtyInPhrase != null) {
    memory.setPendingAction(null);
    return executeAdd(toolCtx, product, qtyInPhrase);
  }

  if (product && qtyInPhrase == null) {
    memory.setPendingAction({
      type: 'await_add_quantity',
      summary: `add ${product.name}`,
      payload: { id: product.id, name: product.name }
    });
    return promptAskQuantity(product.name, memory);
  }

  if (!products.length) {
    return getVoiceText('cart.searchProductNameFirst', resolveVoiceLanguage(memory), {}, '');
  }

  if (products.length === 1) {
    const p = products[0];
    if (qtyInPhrase != null) {
      memory.setPendingAction(null);
      return executeAdd(toolCtx, p, qtyInPhrase);
    }
    memory.setPendingAction({
      type: 'await_pick_product',
      summary: 'pick a product to add',
      payload: { products: [p] }
    });
    return promptPickProduct(`1. ${p.name}`, memory);
  }

  memory.setPendingAction({
    type: 'await_pick_product',
    summary: 'pick a product to add',
    payload: { products }
  });
  return truncateForSpeech(promptPickProduct(formatProductChoiceLines(products, memory), memory));
}
