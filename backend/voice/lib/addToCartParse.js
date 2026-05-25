import { isAddToCartIntent } from './voiceIntentPhrases.js';
import { parseQuantity } from './spokenNumbers.js';

const CART_PHRASE_RE =
  /\b(add\s+to\s+cart|cart\s+mein?\s+(add|jod|daal)|cart\s+me\s+(add|jod|daal)|cart\s+ge\s+(serisu|haak|iddu)|cart\s+lo\s+(add|pettu|join)|jodo|daal\s+do|serisu|haak|pettu)\b/gi;

const DEVANAGARI_CART_RE = /कार्ट\s+में?\s+(जोड़|डाल|जोड़ो|डालो)/g;
const KANNADA_CART_RE = /ಕಾರ್ಟ್\s+ಗೆ?\s+(ಸೇರಿಸ|ಹಾಕ)/g;
const TELUGU_CART_RE = /కార్ట్\s+లో?\s+(చేర్చ|జోడించ|పెట్ట)/g;

/**
 * Parse "add X to cart" / "cart mein 2 jodo" with optional quantity (all call languages).
 * @returns {{ quantity: number|null, productHint: string }}
 */
export function parseAddToCartUtterance(text) {
  const raw = String(text || '').trim();
  if (!raw || !isAddToCartIntent(raw)) {
    return { quantity: null, productHint: '' };
  }

  const quantity = parseQuantity(raw);
  let hint = raw
    .replace(CART_PHRASE_RE, ' ')
    .replace(DEVANAGARI_CART_RE, ' ')
    .replace(KANNADA_CART_RE, ' ')
    .replace(TELUGU_CART_RE, ' ')
    .replace(/\b(add|put|to|the|in|into|cart|mein|me|ge|lo|jod|daal|jodo|serisu|haak|pettu|join|it|this|that)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (quantity != null) {
    const qtyTokens = [
      'one',
      'two',
      'three',
      'four',
      'five',
      'ek',
      'do',
      'teen',
      'char',
      'paanch',
      'ondu',
      'eradu',
      'rendu',
      'moodu',
      'एक',
      'दो',
      'तीन',
      'ಒಂದು',
      'ಎರಡು',
      'రెండు',
      'మూడు',
      String(quantity)
    ];
    for (const tok of qtyTokens) {
      hint = hint.replace(new RegExp(`\\b${tok}\\b`, 'gi'), ' ');
    }
    hint = hint.replace(/\s+/g, ' ').trim();
  }

  return { quantity, productHint: hint };
}
