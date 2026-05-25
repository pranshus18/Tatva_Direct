import { ActionType } from '../core/routeTypes.js';
import {
  isCommandingOrderPhrase,
  isOrderCancelPhrase,
  isOrderTrackPhrase,
  isProceduralStartPhrase,
  isSupportTopicPhrase
} from './voiceIntentPhrases.js';

/** User is asking how something works, not commanding an action. */
export function isProceduralPolicyQuestion(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return isProceduralStartPhrase(t);
}

/** Order id present for track/cancel/pay actions. */
export function extractOrderId(text) {
  const t = String(text || '');
  const patterns = [
    /\b(?:track|cancel|pay(?:ment)? for|status of)\s+(?:order\s+)?#?([A-Za-z0-9-]{4,})\b/i,
    /\border\s+#?([A-Za-z0-9-]{4,})\b/i,
    /(?:ऑर्डर|ಆರ್ಡರ್|ఆర్డర్)\s+#?([A-Za-z0-9-]{4,})/i
  ];
  for (const pattern of patterns) {
    const m = t.match(pattern);
    if (m?.[1] && m[1].toLowerCase() !== 'order') return m[1];
  }
  return null;
}

/**
 * Route to grounded support RAG (not cart/order APIs).
 */
export function shouldUseSupportRag(utterance, action = null) {
  const t = String(utterance || '').trim();
  if (!t) return false;
  if (action === ActionType.SUPPORT_RAG) return true;
  if (isSupportTopicPhrase(t)) return true;
  if (isProceduralPolicyQuestion(t)) {
    return !(isCommandingOrderPhrase(t) && extractOrderId(t));
  }
  return false;
}

/**
 * Intent router: distinguish "how do I track?" (support) vs "track order ABC" (API).
 */
export function resolveTrackOrderAction(text) {
  const t = String(text || '').trim();
  if (!isOrderTrackPhrase(t)) return null;

  const orderId = extractOrderId(t);
  const listOrders =
    /\b(my orders?|recent orders?|order history)\b/i.test(t) ||
    /ನನ್ನ\s+ಆರ್ಡರ್|నా\s+ఆర్డర್|मेरा\s+ऑर्डर/.test(t);

  if (listOrders && !isProceduralPolicyQuestion(t)) return ActionType.TRACK_ORDER;
  if (orderId && !isProceduralPolicyQuestion(t)) return ActionType.TRACK_ORDER;
  if (isProceduralPolicyQuestion(t) || /\bwhere is my order\b/i.test(t)) {
    return ActionType.SUPPORT_RAG;
  }
  if (orderId) return ActionType.TRACK_ORDER;
  return ActionType.SUPPORT_RAG;
}

export function resolveCancelOrderAction(text) {
  const t = String(text || '').trim();
  if (!isOrderCancelPhrase(t)) return null;

  const orderId = extractOrderId(t);
  if (orderId && !isProceduralPolicyQuestion(t)) return ActionType.CANCEL_ORDER;
  if (isProceduralPolicyQuestion(t)) return ActionType.SUPPORT_RAG;
  return ActionType.CANCEL_ORDER;
}
