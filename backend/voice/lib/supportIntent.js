import { ActionType } from '../core/routeTypes.js';

/** User is asking how something works, not commanding an action. */
export function isProceduralPolicyQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    /^(how|what|when|where|why|can i|could i|do you|does|is there|tell me|explain|i want to know)/i.test(t) ||
    /\b(how do i|how can i|how does|what is the|what are the|tell me about|explain the|walk me through)\b/i.test(t)
  );
}

/** Order id present for track/cancel/pay actions. */
export function extractOrderId(text) {
  const t = String(text || '');
  const patterns = [
    /\b(?:track|cancel|pay(?:ment)? for|status of)\s+(?:order\s+)?#?([A-Za-z0-9-]{4,})\b/i,
    /\border\s+#?([A-Za-z0-9-]{4,})\b/i
  ];
  for (const pattern of patterns) {
    const m = t.match(pattern);
    if (m?.[1] && m[1].toLowerCase() !== 'order') return m[1];
  }
  return null;
}

const SUPPORT_TOPIC_RE =
  /\b(refund|return|policy|policies|warranty|faq|shipping|delivery|payment method|damaged|incorrect|razorpay|cod|credit line|cancel(?:lation)?|timeline|eligible|non-returnable)\b/i;

/**
 * Route to grounded support RAG (not cart/order APIs).
 */
export function shouldUseSupportRag(utterance, action = null) {
  const t = String(utterance || '').trim();
  if (!t) return false;
  if (action === ActionType.SUPPORT_RAG) return true;
  if (SUPPORT_TOPIC_RE.test(t)) return true;
  if (isProceduralPolicyQuestion(t)) {
    const commanding =
      /\b(cancel order|track order|pay online|place order|checkout|add .+ to cart)\b/i.test(t) &&
      extractOrderId(t);
    return !commanding;
  }
  return false;
}

/**
 * Intent router: distinguish "how do I track?" (support) vs "track order ABC" (API).
 */
export function resolveTrackOrderAction(text) {
  const t = String(text || '').trim();
  const isTrackTopic =
    /\b(track|order status|where is my order)\b/i.test(t) ||
    /\b(my orders?|recent orders?|order history)\b/i.test(t);
  if (!isTrackTopic) return null;

  const orderId = extractOrderId(t);
  if (/\b(my orders?|recent orders?|order history)\b/i.test(t) && !isProceduralPolicyQuestion(t)) {
    return ActionType.TRACK_ORDER;
  }
  if (orderId && !isProceduralPolicyQuestion(t)) return ActionType.TRACK_ORDER;
  if (isProceduralPolicyQuestion(t) || /\bwhere is my order\b/i.test(t)) {
    return ActionType.SUPPORT_RAG;
  }
  if (orderId) return ActionType.TRACK_ORDER;
  return ActionType.SUPPORT_RAG;
}

export function resolveCancelOrderAction(text) {
  const t = String(text || '').trim();
  if (!/\bcancel\b/i.test(t) || !/\border\b/i.test(t)) return null;

  const orderId = extractOrderId(t);
  if (orderId && !isProceduralPolicyQuestion(t)) return ActionType.CANCEL_ORDER;
  if (isProceduralPolicyQuestion(t)) return ActionType.SUPPORT_RAG;
  return ActionType.CANCEL_ORDER;
}
