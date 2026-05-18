import { classifyIntent } from './intents.js';
import { answerSupportQuestion } from './supportRetriever.js';
import { summarizeToolResult, truncateForSpeech } from './summarizeForVoice.js';

/**
 * Run the right commerce tool from intent — skips Gemini (Retell/Vapi-style routing).
 */
export async function tryIntentRoute(text, toolCtx) {
  const t = String(text || '').trim();
  if (!t) return null;

  const intent = classifyIntent(t);
  const tools = toolCtx.tools;

  if (intent === 'support') {
    return answerSupportQuestion(t);
  }

  if (intent === 'checkout' || /\b(checkout|place (my )?order|buy now)\b/i.test(t)) {
    const raw = await tools.create_order({ payment_method: 'cod' });
    return summarizeToolResult('create_order', raw) || truncateForSpeech(String(raw));
  }

  if (intent === 'cart') {
    if (/\b(clear|empty)\s+(the\s+)?cart\b/i.test(t)) {
      const raw = await tools.remove_from_cart({ clear_all: true });
      return truncateForSpeech(String(raw).includes('success') ? 'Cart cleared.' : String(raw));
    }

    const addMatch = t.match(/\badd\s+(.+?)\s+to\s+(?:the\s+)?cart\b/i) || t.match(/\badd\s+(\d+)\s+(.+)/i);
    if (addMatch) {
      const q = (addMatch[2] || addMatch[1] || '').replace(/\bto cart\b/i, '').trim();
      if (q.length >= 2) {
        const search = await tools.search_products({ query: q, limit: 1 });
        let data;
        try {
          data = typeof search === 'string' ? JSON.parse(search) : search;
        } catch {
          return null;
        }
        const pid = data?.products?.[0]?.id;
        if (pid) {
          const raw = await tools.add_to_cart({ product_id: pid, quantity: 1 });
          const name = data.products[0].name || 'item';
          return truncateForSpeech(
            String(raw).includes('success') || String(raw).includes('status')
              ? `Added ${name} to your cart.`
              : String(raw)
          );
        }
        return `Could not find "${q}" to add.`;
      }
    }

    if (/\b(my cart|show cart|view cart|what'?s in (the )?cart|open cart)\b/i.test(t)) {
      const raw = await tools.get_cart({});
      return summarizeToolResult('get_cart', raw);
    }
  }

  if (intent === 'order_mgmt') {
    const trackMatch = t.match(/\b(?:track|status of|where is)\s+(?:order\s+)?([A-Za-z0-9-]+)/i);
    if (trackMatch) {
      const raw = await tools.track_order({ order_id: trackMatch[1] });
      return summarizeToolResult('track_order', raw) || truncateForSpeech(String(raw));
    }
    if (/\b(my orders?|recent orders?|order history)\b/i.test(t)) {
      const raw = await toolCtx.client.get('/api/dashboard/service-provider');
      if (!raw.ok) return 'Could not load your orders.';
      const orders = (raw.data?.yourOrders || raw.data?.orders || []).slice(0, 3);
      if (!orders.length) return 'You have no recent orders.';
      const lines = orders.map((o, i) => {
        const id = o.order_number || o.id || 'order';
        const st = o.status || o.order_status || 'unknown';
        return `${i + 1}. ${id}, ${st}`;
      });
      return truncateForSpeech(`Recent orders: ${lines.join('. ')}`);
    }
  }

  if (intent === 'search') {
    const q = t
      .replace(/^(search|find|look for|show me|i need|get me)\s+/i, '')
      .replace(/\b(please|now)\b/gi, '')
      .trim()
      .slice(0, 80);
    if (q.length >= 2) {
      const raw = await tools.search_products({ query: q, limit: 3 });
      return summarizeToolResult('search_products', raw);
    }
  }

  if (intent === 'address' && /\b(address|shipping|delivery)\b/i.test(t)) {
    const raw = await tools.get_profile_addresses();
    return summarizeToolResult('get_profile_addresses', raw) || truncateForSpeech(String(raw));
  }

  return null;
}
