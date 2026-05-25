import { ActionType, RouteType } from '../core/routeTypes.js';
import { extractProductQuery, isLikelyProductSearch } from '../lib/productQueryParser.js';
import {
  resolveCancelOrderAction,
  resolveTrackOrderAction,
  shouldUseSupportRag
} from '../lib/supportIntent.js';
import { parseAddToCartUtterance } from '../lib/addToCartParse.js';
import {
  isAddToCartIntent,
  isCheckoutCommandPhrase,
  isClearCartPhrase,
  isComparePhrase,
  isExplainPhrase,
  isGreetingPhrase,
  isAddressPhrase,
  isInventoryPhrase,
  isOpenCartPhrase,
  isOrderReorderPhrase,
  isRecommendPhrase,
  isRemoveFromCartPhrase,
  isSearchCommandPhrase,
  isSmartConversationPhrase,
  isSupportTopicPhrase,
  isThanksPhrase
} from '../lib/voiceIntentPhrases.js';

function slotsFromText(text) {
  const t = String(text || '').trim();
  const s = {};
  const parsed = extractProductQuery(t);
  if (parsed.query) s.query = parsed.query;
  if (parsed.category) s.category = parsed.category;

  const track = t.match(/\b(?:track|status of|where is)\s+(?:order\s+)?([A-Za-z0-9-]+)/i);
  if (track) s.order_id = track[1];

  const cancel = t.match(/\bcancel\s+(?:order\s+)?([A-Za-z0-9-]+)/i);
  if (cancel) s.order_id = cancel[1];

  const reorder = t.match(/\breorder\s+(?:order\s+)?([A-Za-z0-9-]+)/i);
  if (reorder) s.order_id = reorder[1];

  const inv = t.match(/\b(?:stock|inventory)\s+(?:for\s+)?([a-f0-9-]{36})/i);
  if (inv) s.product_id = inv[1];

  const addQty = t.match(/\badd\s+(\d+)\s+(.+?)\s+to\s+cart\b/i);
  if (addQty) {
    s.quantity = Number.parseInt(addQty[1], 10);
    s.query = addQty[2].trim();
  }

  if (isAddToCartIntent(t)) {
    const parsed = parseAddToCartUtterance(t);
    if (parsed.quantity != null) s.quantity = parsed.quantity;
    if (parsed.productHint && !s.query) s.query = parsed.productHint;
  }

  return s;
}

function detectAction(text) {
  const t = String(text || '').trim();

  if (isGreetingPhrase(t)) return ActionType.UNKNOWN;
  if (isThanksPhrase(t)) return ActionType.UNKNOWN;

  if (isClearCartPhrase(t)) return ActionType.CLEAR_CART;
  if (isOpenCartPhrase(t)) return ActionType.OPEN_CART;
  if (/\badd\s+(?:the\s+)?(first|1st|number\s*1)\b/i.test(t)) return ActionType.ADD_TO_CART;
  if (/\badd\s+.+\s+to\s+(?:the\s+)?cart\b/i.test(t)) return ActionType.ADD_TO_CART;
  if (isAddToCartIntent(t)) return ActionType.ADD_TO_CART;
  if (isRemoveFromCartPhrase(t)) return ActionType.REMOVE_FROM_CART;

  if (isCheckoutCommandPhrase(t)) return ActionType.CHECKOUT;

  const cancelAction = resolveCancelOrderAction(t);
  if (cancelAction) return cancelAction;

  const trackAction = resolveTrackOrderAction(t);
  if (trackAction) return trackAction;
  if (isOrderReorderPhrase(t)) return ActionType.REORDER;

  if (isInventoryPhrase(t)) return ActionType.INVENTORY_CHECK;
  if (isAddressPhrase(t)) return ActionType.ADDRESS_GET;

  if (isSupportTopicPhrase(t) || shouldUseSupportRag(t)) return ActionType.SUPPORT_RAG;

  if (isSearchCommandPhrase(t) || isLikelyProductSearch(t)) return ActionType.SEARCH_PRODUCTS;

  if (isRecommendPhrase(t)) return ActionType.GET_RECOMMENDATIONS;
  if (isSmartConversationPhrase(t)) return ActionType.GET_RECOMMENDATIONS;
  if (isComparePhrase(t)) return ActionType.COMPARE_PRODUCTS;
  if (isExplainPhrase(t) && t.length > 12) return ActionType.PRODUCT_EXPLAIN;

  return ActionType.UNKNOWN;
}

const FAST_ACTIONS = new Set([
  ActionType.ADD_TO_CART,
  ActionType.REMOVE_FROM_CART,
  ActionType.UPDATE_CART,
  ActionType.OPEN_CART,
  ActionType.CLEAR_CART,
  ActionType.PLACE_ORDER,
  ActionType.CHECKOUT,
  ActionType.SELECT_PAYMENT,
  ActionType.TRACK_ORDER,
  ActionType.CANCEL_ORDER,
  ActionType.REORDER,
  ActionType.INVENTORY_CHECK,
  ActionType.ADDRESS_GET,
  ActionType.ADDRESS_UPDATE,
  ActionType.SEARCH_PRODUCTS
]);

const SMART_ACTIONS = new Set([
  ActionType.GET_RECOMMENDATIONS,
  ActionType.SUPPORT_RAG,
  ActionType.COMPARE_PRODUCTS,
  ActionType.PRODUCT_EXPLAIN,
  ActionType.CONVERSATIONAL
]);

export const intentRouter = {
  route(text, { pendingAction = null } = {}) {
    const utterance = String(text || '').trim();
    if (!utterance) {
      return { route: RouteType.FAST, action: ActionType.UNKNOWN, slots: {}, confidence: 0 };
    }

    const confirmPending =
      pendingAction &&
      ['place_order', 'cancel_order', 'payment'].includes(pendingAction.type);
    if (confirmPending) {
      return { route: RouteType.CONFIRM, action: ActionType.UNKNOWN, slots: {}, confidence: 1 };
    }

    if (isGreetingPhrase(utterance)) {
      return { route: RouteType.GREETING, action: ActionType.UNKNOWN, slots: {}, confidence: 1 };
    }

    if (isThanksPhrase(utterance)) {
      return { route: RouteType.GREETING, action: ActionType.UNKNOWN, slots: {}, confidence: 1 };
    }

    const action = detectAction(utterance);
    const slots = slotsFromText(utterance);

    if (FAST_ACTIONS.has(action)) {
      return { route: RouteType.FAST, action, slots, confidence: 0.95 };
    }

    if (isLikelyProductSearch(utterance) && !SMART_ACTIONS.has(action)) {
      return {
        route: RouteType.FAST,
        action: ActionType.SEARCH_PRODUCTS,
        slots,
        confidence: 0.88
      };
    }

    if (SMART_ACTIONS.has(action) || isSmartConversationPhrase(utterance)) {
      return { route: RouteType.SMART, action, slots, confidence: 0.85 };
    }

    if (isSupportTopicPhrase(utterance)) {
      return { route: RouteType.SMART, action: ActionType.SUPPORT_RAG, slots, confidence: 0.9 };
    }

    return { route: RouteType.SMART, action: ActionType.CONVERSATIONAL, slots, confidence: 0.5 };
  }
};
