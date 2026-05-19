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
  parseSelectionIndex,
  isExplicitCancel,
  isQuantityOnlyUtterance
} from '../lib/spokenNumbers.js';
import {
  isHelpPhrase,
  helpForPending,
  promptAskQuantity,
  promptPickProduct,
  promptAddedToCart,
  promptDiscoveryCartHandoff,
  promptCheckoutCancelled
} from '../lib/voice_prompts.js';

const ADD_INTENT_RE =
  /\b(add|put)\s+(?:it|that|this|them)?\s*(?:to|in|into)\s+(?:the\s+)?cart\b|\badd\s+to\s+(?:the\s+)?cart\b|\bput\s+(?:it\s+)?in\s+(?:the\s+)?cart\b/i;

const SEARCH_RESTART_RE = /\b(search|find|look(?:ing)?\s+for|show\s+me)\b/i;

async function runSearchFromUtterance(toolCtx, memory, utterance) {
  const catalog = await productCatalogService.searchFromUtterance(
    toolCtx.client,
    utterance,
    memory
  );
  if (!catalog.ok) {
    return catalog.error === 'Request timed out'
      ? 'Search timed out. Try a shorter product name.'
      : 'I could not search right now. Please try again.';
  }
  return productCatalogService.formatSearchSpeech(catalog, memory);
}

function shouldRestartProductSearch(utterance) {
  const t = String(utterance || '').trim();
  if (!t || isAddToCartIntent(t) || isHelpPhrase(t)) return false;
  if (isQuantityOnlyUtterance(t)) return false;
  if (/^(yes|no|ok|okay|cancel|stop|skip|none)$/i.test(t)) return false;
  return SEARCH_RESTART_RE.test(t) || isLikelyProductSearch(t);
}

export function isAddToCartIntent(text) {
  const t = String(text || '');
  if (ADD_INTENT_RE.test(t)) return true;
  if (/\badd\s+.+\s+to\s+(?:the\s+)?cart\b/i.test(t)) return true;
  if (/\badd\s+(?:the\s+)?(first|1st|number\s*\d+)\b/i.test(t)) return true;
  return false;
}

function formatProductChoices(products) {
  return products
    .slice(0, 5)
    .map((p, i) => `${i + 1}. ${p.name}`)
    .join('. ');
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
  if (!result?.ok) return result?.speech || `Could not add ${p.name} to cart.`;

  enterDiscoveryFlow(toolCtx.memory);
  const addedMsg = promptAddedToCart(p.name);
  toolCtx.memory.setPendingAction({
    type: 'await_discovery_cart_handoff',
    summary: 'discovery cart handoff before supplier',
    payload: { productName: p.name }
  });
  return `${addedMsg} ${promptDiscoveryCartHandoff()}`;
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
    return helpForPending(pending.type, memory.getContext('checkout', {}), getVoiceFlowMode(memory));
  }

  if (
    pending &&
    (pending.type === 'await_add_quantity' || pending.type === 'await_pick_product') &&
    isExplicitCancel(utterance, { pendingType: pending.type })
  ) {
    memory.setPendingAction(null);
    return promptCheckoutCancelled();
  }

  if (pending?.type === 'await_add_quantity') {
    const lower = utterance.toLowerCase();
    if (/^(yes|yeah|yep|sure|ok|okay|add it|please add)\b/i.test(lower)) {
      return promptAskQuantity(pending.payload.name);
    }

    if (shouldRestartProductSearch(utterance)) {
      memory.setPendingAction(null);
      return runSearchFromUtterance(toolCtx, memory, utterance);
    }

    const qty = parseQuantity(utterance);
    if (qty == null) {
      return promptAskQuantity(pending.payload.name);
    }
    memory.setPendingAction(null);
    const speech = await executeAdd(toolCtx, pending.payload, qty);
    return speech;
  }

  if (pending?.type === 'await_pick_product') {
    const products = pending.payload.products || [];
    if (!products.length) {
      memory.setPendingAction(null);
      return 'Search for a product first, then say add to cart.';
    }

    let idx = parseSelectionIndex(utterance, products.length);
    if (idx == null) {
      const byName = productCatalogService.resolveProductFromSession(memory, utterance);
      if (byName) {
        idx = products.findIndex((p) => p.id === byName.id);
      }
    }

    if (idx == null && isAddToCartIntent(utterance) && products.length === 1) {
      idx = 0;
    }

    if (idx == null && products.length === 1) {
      const lower = utterance.toLowerCase();
      if (/^(yes|yeah|yep|sure|ok|okay|that one|this one|select|confirm)\b/i.test(lower)) {
        idx = 0;
      }
    }

    if (idx == null && products.length === 1 && isQuantityOnlyUtterance(utterance)) {
      const qty = parseQuantity(utterance);
      memory.setPendingAction(null);
      return executeAdd(toolCtx, products[0], qty);
    }

    if (idx == null && shouldRestartProductSearch(utterance)) {
      memory.setPendingAction(null);
      return runSearchFromUtterance(toolCtx, memory, utterance);
    }

    if (idx == null) {
      return promptPickProduct(formatProductChoices(products));
    }

    const product = products[idx];
    memory.setPendingAction({
      type: 'await_add_quantity',
      summary: `add ${product.name}`,
      payload: { id: product.id, name: product.name }
    });
    return promptAskQuantity(product.name);
  }

  if (!isAddToCartIntent(utterance)) return null;

  if (isHelpPhrase(utterance)) {
    return 'Step 1, search. Step 2, quantity. Step 3, cart. Then supplier, substitution, PO details, transport, and confirm order — all in this call.';
  }

  const last = memory.getContext('last_search');
  const products = last?.products || [];
  let product = productCatalogService.resolveProductFromSession(memory, utterance);
  const qtyInPhrase = parseQuantity(utterance);

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
    return promptAskQuantity(product.name);
  }

  if (!products.length) {
    return 'Step 1, search. Say a product name first, for example Mac Air M2.';
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
    return promptPickProduct(`1. ${p.name}`);
  }

  memory.setPendingAction({
    type: 'await_pick_product',
    summary: 'pick a product to add',
    payload: { products }
  });
  return truncateForSpeech(promptPickProduct(formatProductChoices(products)));
}
