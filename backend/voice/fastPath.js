import { classifyIntent } from './intents.js';
import { answerSupportQuestion } from './supportRetriever.js';
import { summarizeToolResult, truncateForSpeech } from './summarizeForVoice.js';

const GREETING =
  'Hi. I can search products, manage your cart, track orders, or answer policy questions. What do you need?';

const SUPPORT_RE =
  /\b(refund|return|policy|policies|shipping|delivery time|warranty|faq|help me with|how do i|can i cancel|payment method)\b/i;

/**
 * Regex fast path — target under ~500ms (no LLM).
 */
export async function tryFastPath(text, toolCtx) {
  const t = String(text || '').trim();
  const lower = t.toLowerCase();
  const tools = toolCtx.tools;

  if (/^(hi|hello|hey|namaste|good\s+(morning|evening))\b/.test(lower)) {
    return GREETING;
  }

  if (SUPPORT_RE.test(t) || classifyIntent(t) === 'support') {
    return answerSupportQuestion(t);
  }

  if (/\b(my cart|show cart|view cart|what'?s in (the )?cart|open cart)\b/i.test(t)) {
    const raw = await tools.get_cart({});
    return summarizeToolResult('get_cart', raw);
  }

  if (/\b(recommend|suggestions?|what should i buy)\b/i.test(t)) {
    const raw = await tools.get_recommendations({ limit: 3 });
    return summarizeToolResult('search_products', raw);
  }

  const searchMatch = t.match(
    /\b(?:search(?:ing)?|find|look(?:ing)? for|show me|i need|get me)\s+(.+)/i
  );
  if (searchMatch) {
    const q = searchMatch[1].replace(/\b(please|now|for me)\b/gi, '').trim().slice(0, 80);
    if (q.length >= 2) {
      const raw = await tools.search_products({ query: q, limit: 3 });
      return summarizeToolResult('search_products', raw);
    }
  }

  const trackMatch = t.match(/\b(?:track|status of|where is)\s+(?:order\s+)?([A-Za-z0-9-]+)/i);
  if (trackMatch) {
    const raw = await tools.track_order({ order_id: trackMatch[1] });
    return truncateForSpeech(String(raw));
  }

  if (/\b(thanks|thank you|bye|goodbye)\b/i.test(lower)) {
    return 'You are welcome. Anything else?';
  }

  return null;
}
