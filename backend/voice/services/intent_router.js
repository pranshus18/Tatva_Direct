import { ActionType, RouteType } from '../core/routeTypes.js';
import { extractProductQuery, isLikelyProductSearch } from '../lib/productQueryParser.js';
import {
  resolveCancelOrderAction,
  resolveTrackOrderAction,
  shouldUseSupportRag
} from '../lib/supportIntent.js';

const SUPPORT_RE =
  /\b(refund|return|policy|policies|warranty|faq|help|how do i|can i return|shipping policy|delivery time|payment method|damaged|razorpay|cod|credit line|non-returnable)\b/i;

const SMART_RE =
  /\b(recommend|suggestion|compare|versus|vs\b|which (one|product)|best for|explain|tell me about|buying guide|what should i buy|difference between)\b/i;

const GREETING_RE = /^(hi|hello|hey|namaste|good\s+(morning|evening|afternoon))\b/i;
const THANKS_RE = /\b(thanks|thank you|bye|goodbye)\b/i;

const SEARCH_RE =
  /\b(search|find|look(?:ing)?\s+for|show\s+me|i\s+need|get\s+me|do\s+you\s+have|looking\s+for|products?\s+(?:like|for)|need\s+some|any\s+)\b/i;

const ADD_CART_RE = /\badd\s+.+\s+to\s+(?:the\s+)?cart\b/i;
const ADD_FIRST_RE = /\badd\s+(?:the\s+)?(first|1st|number\s*1)\b/i;

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

  return s;
}

function detectAction(text) {
  const t = String(text || '').trim();
  const lower = t.toLowerCase();

  if (GREETING_RE.test(lower)) return ActionType.UNKNOWN;
  if (THANKS_RE.test(lower)) return ActionType.UNKNOWN;

  if (/\b(clear|empty)\s+(?:the\s+)?cart\b/i.test(t)) return ActionType.CLEAR_CART;
  if (/\b(my cart|show cart|view cart|open cart|what'?s in (?:the )?cart)\b/i.test(t)) {
    return ActionType.OPEN_CART;
  }
  if (ADD_FIRST_RE.test(t)) return ActionType.ADD_TO_CART;
  if (ADD_CART_RE.test(t)) return ActionType.ADD_TO_CART;
  if (/\b(add|put)\s+(?:it|that|this)?\s*(?:to|in|into)\s+(?:the\s+)?cart\b/i.test(t)) {
    return ActionType.ADD_TO_CART;
  }
  if (/\badd\s+to\s+(?:the\s+)?cart\b/i.test(t)) return ActionType.ADD_TO_CART;
  if (/\bremove\s+.+\s+from\s+cart\b/i.test(t)) return ActionType.REMOVE_FROM_CART;

  if (/\b(checkout|place\s+(?:my\s+)?order|buy\s+now)\b/i.test(t)) return ActionType.CHECKOUT;

  const cancelAction = resolveCancelOrderAction(t);
  if (cancelAction) return cancelAction;

  const trackAction = resolveTrackOrderAction(t);
  if (trackAction) return trackAction;
  if (/\b(reorder|order again)\b/i.test(t)) return ActionType.REORDER;

  if (/\b(stock|inventory|in stock|availability)\b/i.test(t)) return ActionType.INVENTORY_CHECK;
  if (/\b(shipping address|my address|delivery address)\b/i.test(t)) return ActionType.ADDRESS_GET;

  if (SUPPORT_RE.test(t) || shouldUseSupportRag(t)) return ActionType.SUPPORT_RAG;

  if (SEARCH_RE.test(t) || isLikelyProductSearch(t)) return ActionType.SEARCH_PRODUCTS;

  if (/\b(recommend|suggestion|what should i buy)\b/i.test(t)) return ActionType.GET_RECOMMENDATIONS;
  if (SMART_RE.test(t)) return ActionType.GET_RECOMMENDATIONS;
  if (/\b(compare|versus|difference between)\b/i.test(t)) return ActionType.COMPARE_PRODUCTS;
  if (/\b(explain|tell me about)\b/i.test(t) && t.length > 12) return ActionType.PRODUCT_EXPLAIN;

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

    if (GREETING_RE.test(utterance.toLowerCase())) {
      return { route: RouteType.GREETING, action: ActionType.UNKNOWN, slots: {}, confidence: 1 };
    }

    if (THANKS_RE.test(utterance.toLowerCase())) {
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

    if (SMART_ACTIONS.has(action) || SMART_RE.test(utterance)) {
      return { route: RouteType.SMART, action, slots, confidence: 0.85 };
    }

    if (SUPPORT_RE.test(utterance)) {
      return { route: RouteType.SMART, action: ActionType.SUPPORT_RAG, slots, confidence: 0.9 };
    }

    return { route: RouteType.SMART, action: ActionType.CONVERSATIONAL, slots, confidence: 0.5 };
  }
};
