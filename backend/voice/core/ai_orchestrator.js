import logger from '../../utils/logger.js';
import { handleConfirmationGate } from '../confirmations.js';
import { RouteType } from './routeTypes.js';
import { createVoiceToolContext } from '../voiceTools.js';
import { truncateForSpeech } from '../summarizeForVoice.js';
import { intentRouter } from '../services/intent_router.js';
import { fastActionExecutor } from '../services/fast_action_executor.js';
import { smartAiExecutor } from '../services/smart_ai_executor.js';
import { productCatalogService } from '../services/product_catalog_service.js';
import { isLikelyProductSearch } from '../lib/productQueryParser.js';
import { tryAddToCartFlow } from '../services/add_to_cart_flow.js';
import { tryCheckoutFlow } from '../services/checkout_flow.js';
import { tryVoiceNavigationFlow } from '../services/voice_navigation_flow.js';
import { isHelpPhrase, helpForPending } from '../lib/voice_prompts.js';
import {
  enterDiscoveryFlow,
  getVoiceFlowMode,
  isCartFlowMode,
  isDiscoveryOnlyPending,
  shouldBlockAmbientProductSearch
} from '../lib/voice_flow_mode.js';
import { ActionType } from './routeTypes.js';
import {
  getLanguageConfirmation,
  getLanguageSelectionPrompt,
  isVoiceMultilingualEnabled,
  parseVoiceLanguageFromText,
  resolveVoiceLanguage
} from '../lib/voiceLanguage.js';
import { getVoiceText } from '../i18n/index.js';

const VOICE_DEBUG = String(process.env.VOICE_DEBUG || '').toLowerCase() === 'true';

/**
 * Amazon-style orchestrator:
 * Intent Router → Fast Path (API) OR Smart Path (RAG+Gemini)
 */
export class AiOrchestrator {
  constructor(token, memory) {
    this.token = token;
    this.memory = memory;
    this.toolCtx = createVoiceToolContext(token, memory);
  }

  async runPending(pending) {
    const ptype = pending.type;
    const payload = pending.payload || {};
    this.memory.setPendingAction(null);

    if (ptype === 'place_order') {
      return truncateForSpeech(await this.toolCtx.executePlaceOrder(payload));
    }
    if (ptype === 'cancel_order') {
      return truncateForSpeech(await this.toolCtx.executeCancelOrder(payload));
    }
    if (ptype === 'payment') {
      return truncateForSpeech(await this.toolCtx.executeOnlinePayment(payload.order_id));
    }
    return getVoiceText('error.unknownPending', resolveVoiceLanguage(this.memory), {}, '');
  }

  async handleTranscript(userText, { onChunk } = {}) {
    const t0 = Date.now();
    const text = String(userText || '').trim();
    const currentLang = resolveVoiceLanguage(this.memory);
    if (!text) {
      return getVoiceText('error.noCatch', currentLang, {}, '');
    }

    const pending = this.memory.getPendingAction();

    const isEndCallIntent =
      /\b(end (the |this )?call|hang ?up|stop (the )?call|disconnect call|call band karo|कॉल बंद करो|కాల్ ముగించు|ಕಾಲ್ ಮುಗಿಸಿ)\b/i.test(
        text
      );
    if (isEndCallIntent) {
      const bye = getVoiceText('call.ending', currentLang, {}, '');
      this.memory.appendCompact('user', text);
      this.memory.appendCompact('assistant', bye);
      if (onChunk) onChunk(bye);
      return bye;
    }

    if (isVoiceMultilingualEnabled() && !this.memory.isVoiceLanguageSelected()) {
      const chosen = parseVoiceLanguageFromText(text);
      if (!chosen) {
        const ask = getLanguageSelectionPrompt();
        this.memory.appendCompact('user', text);
        this.memory.appendCompact('assistant', ask);
        if (onChunk) onChunk(ask);
        return ask;
      }
      this.memory.setVoiceLanguage(chosen);
      this.memory.setVoiceLanguageSelected(true);
      const switched = getLanguageConfirmation(chosen);
      this.memory.appendCompact('user', text);
      this.memory.appendCompact('assistant', switched);
      if (onChunk) onChunk(switched);
      return switched;
    }

    const switchIntent =
      /\b(switch|change|language|bhasha|ಭಾಷೆ|భాష|भाषा)\b/i.test(text) ||
      /^(english|hinglish|hindi|kannada|telugu)$/i.test(text);
    if (isVoiceMultilingualEnabled() && switchIntent) {
      const requested = parseVoiceLanguageFromText(text);
      if (requested && requested !== currentLang) {
        this.memory.setVoiceLanguage(requested);
        this.memory.setVoiceLanguageSelected(true);
        const switched = getLanguageConfirmation(requested);
        this.memory.appendCompact('user', text);
        this.memory.appendCompact('assistant', switched);
        if (onChunk) onChunk(switched);
        return switched;
      }
    }

    if (isHelpPhrase(text)) {
      const flowMode = getVoiceFlowMode(this.memory);
      const help =
        (await tryCheckoutFlow(text, this.toolCtx, this.memory)) ||
        (!isCartFlowMode(this.memory) &&
          (await tryAddToCartFlow(text, this.toolCtx, this.memory))) ||
        helpForPending(pending?.type, this.memory.getContext('checkout', {}), flowMode, this.memory);
      if (help) {
        this.memory.appendCompact('user', text);
        this.memory.appendCompact('assistant', help);
        if (onChunk) onChunk(help);
        this._log('help', t0);
        return help;
      }
    }

    const navFlow = await tryVoiceNavigationFlow(text, this.toolCtx, this.memory);
    if (navFlow) {
      this.memory.appendCompact('user', text);
      this.memory.appendCompact('assistant', navFlow);
      if (onChunk) onChunk(navFlow);
      this._log('nav', t0);
      return navFlow;
    }

    if (isDiscoveryOnlyPending(pending)) {
      const addFirst = await tryAddToCartFlow(text, this.toolCtx, this.memory);
      if (addFirst) {
        this.memory.appendCompact('user', text);
        this.memory.appendCompact('assistant', addFirst);
        if (onChunk) onChunk(addFirst);
        this._log('add_cart', t0);
        return addFirst;
      }
    }

    const checkoutFlow = await tryCheckoutFlow(text, this.toolCtx, this.memory);
    if (checkoutFlow) {
      this.memory.appendCompact('user', text);
      this.memory.appendCompact('assistant', checkoutFlow);
      if (onChunk) onChunk(checkoutFlow);
      this._log('checkout', t0);
      return checkoutFlow;
    }

    const addFlow = await tryAddToCartFlow(text, this.toolCtx, this.memory);
    if (addFlow) {
      this.memory.appendCompact('user', text);
      this.memory.appendCompact('assistant', addFlow);
      if (onChunk) onChunk(addFlow);
      this._log('add_cart', t0);
      return addFlow;
    }

    const gate = await handleConfirmationGate(text, pending, {
      memory: this.memory,
      onConfirm: (p) => this.runPending(p),
      onReject: async () => {
        this.memory.setPendingAction(null);
        return getVoiceText('call.cancelled', resolveVoiceLanguage(this.memory), {}, '');
      }
    });
    if (gate.handled && gate.reply) {
      const reply = truncateForSpeech(gate.reply);
      this.memory.appendCompact('user', text);
      this.memory.appendCompact('assistant', reply);
      this._log('confirm', t0);
      return reply;
    }

    const decision = intentRouter.route(text, { pendingAction: pending });
    this._log(`route:${decision.route}:${decision.action}`, t0);

    if (decision.route === RouteType.FAST || decision.route === RouteType.GREETING) {
      const fast = await fastActionExecutor.execute(decision, text, this.toolCtx);
      if (fast) {
        if (onChunk) onChunk(fast);
        this.memory.appendCompact('user', text);
        this.memory.appendCompact('assistant', fast);
        this._log('fast', t0);
        return fast;
      }
    }

    if (
      isLikelyProductSearch(text) &&
      !shouldBlockAmbientProductSearch(this.memory, pending) &&
      decision.action === ActionType.CONVERSATIONAL
    ) {
      const catalog = await productCatalogService.searchFromUtterance(
        this.toolCtx.client,
        text,
        this.memory
      );
      if (catalog.ok) {
        enterDiscoveryFlow(this.memory);
        const speech = productCatalogService.formatSearchSpeech(catalog, this.memory);
        if (onChunk) onChunk(speech);
        this.memory.appendCompact('user', text);
        this.memory.appendCompact('assistant', speech);
        this._log('catalog', t0);
        return speech;
      }
    }

    const smart = await smartAiExecutor.execute(text, this.toolCtx, this.memory, {
      onChunk,
      action: decision.action,
      route: decision.route
    });
    this._log('smart', t0);
    return smart;
  }

  _log(label, t0) {
    if (VOICE_DEBUG) logger.info(`[voice] ${label} ${Date.now() - t0}ms`);
  }
}

export { AiOrchestrator as VoiceOrchestrator };
