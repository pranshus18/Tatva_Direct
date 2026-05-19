import {
  promptGoToScreen,
  promptResumeCheckout,
  promptCartEmpty
} from '../lib/voice_prompts.js';
import {
  parseGoToScreenIntent,
  isExplicitCartCheckoutResume,
  isCartContinuePhrase
} from './voice_navigation_phrases.js';
import {
  enterCartCheckoutFlow,
  enterDiscoveryFlow,
  isCartFlowMode,
  isDiscoveryFlowMode
} from '../lib/voice_flow_mode.js';
import {
  beginCartCheckoutSession,
  syncCheckoutFromCartDraft,
  resumeCheckoutFromCart,
  handleCartContinue
} from './checkout_flow.js';

async function goToCartCheckout(toolCtx, memory, utterance) {
  enterCartCheckoutFlow(memory);
  const synced = await syncCheckoutFromCartDraft(toolCtx, memory);
  if (!synced.ok || !synced.items.length) {
    memory.setPendingAction(null);
    return promptCartEmpty();
  }

  if (isCartContinuePhrase(utterance)) {
    return handleCartContinue(toolCtx, memory, utterance);
  }

  return resumeCheckoutFromCart(toolCtx, memory, { forceStep: 'cart' });
}

/**
 * Jump to a screen or resume checkout — respects discovery vs cart-only flows.
 */
export async function tryVoiceNavigationFlow(text, toolCtx, memory) {
  const utterance = String(text || '').trim();
  if (!utterance) return null;

  const screen = parseGoToScreenIntent(utterance);
  const explicitCartResume = isExplicitCartCheckoutResume(utterance);

  if (!screen && !explicitCartResume) return null;

  if (screen === 'product_discovery') {
    enterDiscoveryFlow(memory);
    memory.setPendingAction(null);
    return promptGoToScreen('product_discovery');
  }

  if (screen === 'orders') {
    memory.setPendingAction(null);
    return promptGoToScreen('orders');
  }

  if (screen === 'cart') {
    return goToCartCheckout(toolCtx, memory, utterance);
  }

  if (explicitCartResume && !screen) {
    if (isDiscoveryFlowMode(memory)) {
      return null;
    }
    return `${promptResumeCheckout()} ${await resumeCheckoutFromCart(toolCtx, memory, { forceStep: 'auto' })}`;
  }

  if (screen === 'supplier_select' || screen === 'substitution' || screen === 'create_po' || screen === 'transport') {
    const synced = await syncCheckoutFromCartDraft(toolCtx, memory);
    if (!synced.items.length) {
      return promptCartEmpty();
    }
    if (!isCartFlowMode(memory)) {
      enterCartCheckoutFlow(memory);
    }
    if (screen === 'supplier_select') {
      return resumeCheckoutFromCart(toolCtx, memory, { forceStep: 'supplier_select' });
    }
    return resumeCheckoutFromCart(toolCtx, memory, { forceStep: 'auto' });
  }

  return null;
}
