/**
 * Voice checkout flow — thin orchestrator; step handlers live in ./checkout/.
 */
import { truncateForSpeech } from '../summarizeForVoice.js';
import { parseSelectionIndex, isExplicitCancel } from '../lib/spokenNumbers.js';
import {
  isHelpPhrase,
  helpForPending,
  promptCheckoutCancelled,
  promptLoadingTransport
} from '../lib/voice_prompts.js';
import {
  isResumeCheckoutPhrase,
  parseGoToScreenIntent
} from './voice_navigation_phrases.js';
import { getVoiceFlowMode, isCartFlowMode } from '../lib/voice_flow_mode.js';
import { hasMandatoryTransportSelected } from '../lib/transportGate.js';
import { CHECKOUT_TYPES, getCheckout } from './checkout/checkout_flow_state.js';
import {
  beginCartCheckoutSession,
  handleDiscoveryCartHandoff as handleDiscoveryCartHandoffStep,
  handleCartContinue as handleCartContinueStep
} from './checkout/checkout_flow_cart.js';
import {
  startSupplierSelection,
  resumeCheckoutFromCart,
  handleSupplierSelect,
  handleSubstitution
} from './checkout/checkout_flow_supplier.js';
import { handlePoDetails } from './checkout/checkout_flow_po.js';
import { loadTransportQuotes, handleTransport } from './checkout/checkout_flow_transport.js';
import { handlePlaceConfirm } from './checkout/checkout_flow_place.js';

export { loadCartItems, beginCartCheckoutSession, syncCheckoutFromCartDraft } from './checkout/checkout_flow_cart.js';
export { resumeCheckoutFromCart, startSupplierSelection } from './checkout/checkout_flow_supplier.js';
export { placeOrderAndConfirmTransport } from './checkout/checkout_flow_place.js';

export async function handleDiscoveryCartHandoff(toolCtx, memory, utterance) {
  return handleDiscoveryCartHandoffStep(toolCtx, memory, utterance, startSupplierSelection);
}

export async function handleCartContinue(toolCtx, memory, utterance) {
  return handleCartContinueStep(toolCtx, memory, utterance, startSupplierSelection);
}

export async function tryCheckoutFlow(text, toolCtx, memory) {
  const utterance = String(text || '').trim();
  const pending = memory.getPendingAction();

  if (isHelpPhrase(utterance)) {
    const checkout = getCheckout(memory);
    const flowMode = getVoiceFlowMode(memory);
    if (pending?.type) {
      return helpForPending(pending.type, checkout, flowMode);
    }
    return helpForPending(null, checkout, flowMode);
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
    if (parseGoToScreenIntent(utterance) || isResumeCheckoutPhrase(utterance)) {
      return null;
    }

    if (/\b(place (the )?order|complete order)\b/i.test(utterance)) {
      const checkout = getCheckout(memory);
      if (!checkout.poGroups?.length) {
        return 'Add a product and choose a supplier before placing an order.';
      }
      if (!hasMandatoryTransportSelected(checkout)) {
        const loading = promptLoadingTransport();
        const step = await loadTransportQuotes(toolCtx, memory);
        return truncateForSpeech(`${loading} ${step}`);
      }
      return handlePlaceConfirm(toolCtx, memory, utterance);
    }

    if (/\b(checkout|check out)\b/i.test(utterance) && isCartFlowMode(memory)) {
      return resumeCheckoutFromCart(toolCtx, memory, { forceStep: 'auto' });
    }

    return null;
  }

  if (!CHECKOUT_TYPES.has(pending.type)) return null;

  switch (pending.type) {
    case 'await_discovery_cart_handoff':
      return handleDiscoveryCartHandoff(toolCtx, memory, utterance);
    case 'await_cart_continue':
      return handleCartContinue(toolCtx, memory, utterance);
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
