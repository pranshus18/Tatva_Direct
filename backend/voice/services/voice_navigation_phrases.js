/** Screen keys aligned with VOICE_UI_SCREENS in voice_ui_screens.js */

const GO_TO_PATTERNS = [
  [/\b(go to|open|show|view|take me to|switch to)\s+(?:the\s+)?cart\b/i, 'cart'],
  [/\bmy cart\b/i, 'cart'],
  [/\bwhat(?:'s| is) in (?:the )?cart\b/i, 'cart'],
  [/\b(go to|open)\s+(?:the\s+)?product\s+discovery\b/i, 'product_discovery'],
  [/\b(go to|open)\s+(?:the\s+)?(?:supplier|vendor)\s*(?:select(?:ion)?)?\b/i, 'supplier_select'],
  [/\b(go to|open)\s+(?:the\s+)?substitution\b/i, 'substitution'],
  [/\b(go to|open)\s+(?:the\s+)?(?:create\s+)?(?:purchase\s+)?order\b/i, 'create_po'],
  [/\b(go to|open)\s+(?:the\s+)?transport\b/i, 'transport'],
  [/\b(go to|open)\s+(?:the\s+)?(?:my\s+)?orders\b/i, 'orders']
];

export function parseGoToScreenIntent(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  for (const [re, screen] of GO_TO_PATTERNS) {
    if (re.test(t)) return screen;
  }
  if (/\b(supplier|vendor)\s+select(?:ion)?\b/i.test(t) && /\b(go|open|show|start)\b/i.test(t)) {
    return 'supplier_select';
  }
  return null;
}

/** Explicit cart-checkout resume — not bare "continue" during discovery search/qty. */
export function isExplicitCartCheckoutResume(text) {
  const t = String(text || '').toLowerCase().trim();
  return (
    /\b(continue|resume|proceed with)\s+(?:the\s+)?(?:order|checkout|purchase)\b/i.test(t) ||
    /\b(checkout|check out)\s+(?:from\s+)?(?:the\s+)?cart\b/i.test(t) ||
    /\bcontinue from cart\b/i.test(t) ||
    /\bfinish (?:my )?order\b/i.test(t) ||
    /\b(order from cart|buy from cart)\b/i.test(t)
  );
}

export function isResumeCheckoutPhrase(text) {
  return isExplicitCartCheckoutResume(text);
}

export function isCartContinuePhrase(text) {
  const t = String(text || '').toLowerCase().trim();
  return (
    /^(yes|yeah|yep|ok|okay|sure|continue|next|proceed|go ahead|ready)\b/i.test(t) ||
    /\b(select supplier|choose supplier|pick supplier|supplier selection|continue to supplier)\b/i.test(t)
  );
}
