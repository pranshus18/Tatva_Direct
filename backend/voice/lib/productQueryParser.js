import {
  isSearchCommandPhrase,
  isShortControlUtterance,
  isPickConfirmPhrase,
  isConfirmPhrase,
  isRejectPhrase
} from './voiceIntentPhrases.js';

const SEARCH_VERBS =
  /^(?:search(?:\s+for)?|find(?:\s+for)?|look(?:ing)?\s+for|show\s+me|i\s+need|get\s+me|do\s+you\s+have|got\s+any|any|looking\s+for|products?\s+(?:like|for)|need\s+some|khojo|dhoondo|dhundho|hudi|shodhisu|vethuku)\s+/i;

const CATEGORY_WORDS =
  /\b(cement|steel|rod|rods|rebar|pipe|pipes|paint|tile|tiles|sand|gravel|brick|bricks|wire|cable|plywood|lumber|aggregate|concrete|mortar|सीमेंट|ಸಿಮೆಂಟ್|సిమెంట్)\b/i;

const NOT_PRODUCT =
  /\b(cart|checkout|order|track|cancel|refund|policy|address|payment|hello|thanks|bye|madad|sahayata|sahayam|jodo|daal|serisu|haak|pettu)\b|कार्ट|ऑर्डर|जोड़|जोड़ो|ಚೆಕ್|ಕಾರ್ಟ್|ಆರ್ಡರ್|ಸೇರಿಸ|కార్ట్|ఆర్డర్|జోడించ/i;

const ADD_CART_CONTEXT =
  /\b(add\s+to\s+cart|cart\s+mein?\s+(add|jod|daal)|cart\s+ge\s+(serisu|haak)|cart\s+lo\s+(add|pettu)|jodo|daal\s+do)\b|कार्ट\s+में?\s+(जोड़|डाल)|ಕಾರ್ಟ್\s+ಗೆ?\s+(ಸೇರಿಸ|ಹಾಕ)|కార్ట్\s+లో?\s+(చేర్చ|జోడించ)/i;

/** Bare numbers / quantity words — not a product search. */
const QUANTITY_OR_STEP_WORD =
  /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a couple|couple|pair|dozen|ek|do|teen|char|chaar|paanch|ondu|eradu|mooru|okati|rendu|moodu|naalugu|दो|तीन|रेंडु|మూడు|ಎರಡು|\d{1,4})$/i;

function isStepLikeResponse(t) {
  return (
    isShortControlUtterance(t) ||
    isPickConfirmPhrase(t) ||
    isConfirmPhrase(t) ||
    isRejectPhrase(t)
  );
}

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
  if (QUANTITY_OR_STEP_WORD.test(t) || isStepLikeResponse(t)) return false;
  if (NOT_PRODUCT.test(t)) return false;
  if (ADD_CART_CONTEXT.test(t)) return false;
  if (/^[a-z0-9][a-z0-9.\-\s]{0,14}$/i.test(t)) return true;
  if (isSearchCommandPhrase(t) || SEARCH_VERBS.test(t) || CATEGORY_WORDS.test(t)) return true;
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
