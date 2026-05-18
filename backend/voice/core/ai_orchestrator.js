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
import { isHelpPhrase, helpForPending } from '../lib/voice_prompts.js';
import { ActionType } from './routeTypes.js';

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
    return 'Unknown pending action.';
  }

  async handleTranscript(userText, { onChunk } = {}) {
    const t0 = Date.now();
    const text = String(userText || '').trim();
    if (!text) return "I didn't catch that. Please try again.";

    const pending = this.memory.getPendingAction();

    if (isHelpPhrase(text)) {
      const help =
        (await tryCheckoutFlow(text, this.toolCtx, this.memory)) ||
        (await tryAddToCartFlow(text, this.toolCtx, this.memory)) ||
        helpForPending(pending?.type, this.memory.getContext('checkout', {}));
      if (help) {
        this.memory.appendCompact('user', text);
        this.memory.appendCompact('assistant', help);
        if (onChunk) onChunk(help);
        this._log('help', t0);
        return help;
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
      onConfirm: (p) => this.runPending(p),
      onReject: async () => {
        this.memory.setPendingAction(null);
        return 'Okay, cancelled.';
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

    if (isLikelyProductSearch(text) && decision.action === ActionType.CONVERSATIONAL) {
      const catalog = await productCatalogService.searchFromUtterance(
        this.toolCtx.client,
        text,
        this.memory
      );
      if (catalog.ok) {
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
