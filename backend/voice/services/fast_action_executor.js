import { ActionType, RouteType } from '../core/routeTypes.js';
import { isLikelyProductSearch } from '../lib/productQueryParser.js';
import { productCatalogService } from './product_catalog_service.js';
import { toolCallingEngine } from './tool_calling_engine.js';

const GREETING = 'Hi. I can search products, manage your cart, track orders, or answer policy questions.';
const THANKS = 'You are welcome. Anything else?';

/**
 * Fast path — direct backend APIs, no Gemini.
 */
export const fastActionExecutor = {
  async execute(routeDecision, text, toolCtx) {
    const { action, slots, route } = routeDecision;

    if (route === RouteType.GREETING) {
      if (/\b(thanks|bye)\b/i.test(text)) return THANKS;
      return GREETING;
    }

    if (action === ActionType.SUPPORT_RAG) return null;

    let resolvedAction = action;
    let resolvedSlots = { ...slots };

    if (
      (action === ActionType.UNKNOWN || action === ActionType.CONVERSATIONAL) &&
      isLikelyProductSearch(text)
    ) {
      resolvedAction = ActionType.SEARCH_PRODUCTS;
    }

    if (resolvedAction === ActionType.SEARCH_PRODUCTS && !resolvedSlots.query) {
      const fromUtterance = await productCatalogService.searchFromUtterance(
        toolCtx.client,
        text,
        toolCtx.memory
      );
      if (fromUtterance.ok || fromUtterance.error) {
        return productCatalogService.formatSearchSpeech(fromUtterance, toolCtx.memory);
      }
    }

    if (/\b(add|put)\s+(?:the\s+)?(first|1st|number\s*1)\b/i.test(text)) {
      resolvedAction = ActionType.ADD_TO_CART;
    }

    if (resolvedAction === ActionType.ADD_TO_CART) {
      return null;
    }

    const result = await toolCallingEngine.execute(
      toolCtx,
      resolvedAction,
      resolvedSlots,
      text
    );
    return result?.speech || null;
  }
};
