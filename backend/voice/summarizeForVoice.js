/** Max chars sent to the client for TTS (full checkout prompts, suppliers, etc.). */
export const VOICE_SPEECH_MAX_LEN =
  Number.parseInt(String(process.env.VOICE_SPEECH_MAX_LEN || '4500'), 10) || 4500;

/** Trim only when extremely long; default allows full spoken checkout flows. */
export function truncateForSpeech(text, maxLen = VOICE_SPEECH_MAX_LEN) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, maxLen);
  const lastStop = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
  if (lastStop > 80) return cut.slice(0, lastStop + 1);
  return `${cut.trim()}…`;
}

export function summarizeToolResult(toolName, raw) {
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return truncateForSpeech(String(raw).replace(/[{}\[\]"]/g, ' '));
  }

  if (toolName === 'get_cart') {
    const items = data?.items || [];
    if (!items.length || data?.empty) return 'Your cart is empty.';
    const names = items.slice(0, 3).map((i) => `${i.name || 'item'} × ${i.quantity || 1}`);
    const more = items.length > 3 ? ` and ${items.length - 3} more.` : '';
    return truncateForSpeech(`Cart has ${items.length} items: ${names.join(', ')}${more}`);
  }

  if (toolName === 'search_products' || toolName === 'get_recommendations') {
    const products = data?.products || data?.suggestions || [];
    if (!products.length) {
      const q = String(data?.searchQuery || '').trim();
      return q
        ? `I am not able to find the product "${q}".`
        : 'I am not able to find the product.';
    }
    const lines = products.slice(0, 3).map((p, i) => {
      const bits = [p.name || 'Product'];
      if (p.brand) bits.push(p.brand);
      if (p.unit) bits.push(p.unit);
      return `${i + 1}. ${bits.join(', ')}`;
    });
    const total = data.total ?? products.length;
    return truncateForSpeech(
      `Found ${total} product${total === 1 ? '' : 's'}. ${lines.join('. ')}. Say add to cart, then tell me how many.`
    );
  }

  if (toolName === 'answer_support_question') {
    if (typeof raw === 'string' && !raw.startsWith('{')) return truncateForSpeech(raw);
    const ctx = data?.context;
    if (Array.isArray(ctx) && ctx[0]) {
      const snip = typeof ctx[0] === 'string' ? ctx[0] : ctx[0].snippet;
      return truncateForSpeech(String(snip || '').replace(/^\[[^\]]+\]\s*/, ''));
    }
  }

  if (data?.message && typeof data.message === 'string') {
    return truncateForSpeech(data.message);
  }

  return truncateForSpeech(JSON.stringify(data));
}
