const SEARCH_VERBS =
  /^(?:search(?:\s+for)?|find(?:\s+for)?|look(?:ing)?\s+for|show\s+me|i\s+need|get\s+me|do\s+you\s+have|got\s+any|any|looking\s+for|products?\s+(?:like|for)|need\s+some)\s+/i;

const CATEGORY_WORDS =
  /\b(cement|steel|rod|rods|rebar|pipe|pipes|paint|tile|tiles|sand|gravel|brick|bricks|wire|cable|plywood|lumber|aggregate|concrete|mortar)\b/i;

const NOT_PRODUCT =
  /\b(cart|checkout|order|track|cancel|refund|policy|address|payment|hello|thanks|bye)\b/i;

/** Pull product search terms from natural speech. */
export function extractProductQuery(text) {
  const original = String(text || '').trim();
  if (!original) return { query: '', category: '' };

  let q = original.replace(SEARCH_VERBS, '').trim();
  if (!q) q = original;
  q = q.replace(/^\s*for\s+/i, '').replace(/\b(please|now|for me|in stock|available)\b/gi, '').trim();

  const categoryMatch = q.match(/\b(?:in|under)\s+([a-z\s]{3,40})\s+category\b/i);
  if (categoryMatch) {
    return {
      query: q.replace(categoryMatch[0], '').trim().slice(0, 120),
      category: categoryMatch[1].trim()
    };
  }

  return { query: q.slice(0, 120), category: '' };
}

/** Short utterance that is probably a product search (FAST path). */
export function isLikelyProductSearch(text) {
  const t = String(text || '').trim();
  if (!t || t.length < 1 || t.length > 100) return false;
  if (/^[a-z0-9][a-z0-9.\-\s]{0,14}$/i.test(t)) return true;
  if (NOT_PRODUCT.test(t)) return false;
  if (SEARCH_VERBS.test(t) || CATEGORY_WORDS.test(t)) return true;
  if (/^\d+\s+/.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 6 && !/\?/.test(t)) return true;
  return false;
}

export function parseCategoryFromText(text) {
  const m = String(text || '').match(
    /\b(?:category|type)\s+([a-z][a-z\s]{2,30})|(?:in|under)\s+([a-z][a-z\s]{2,30})\b/i
  );
  return (m?.[1] || m?.[2] || '').trim().toLowerCase();
}
