/**
 * Multilingual voice intents (English, Hindi, Kannada, Telugu + common roman STT).
 * Keeps discovery → quantity → cart flow working in every call language.
 */

const ADD_TO_CART_PATTERNS = [
  /\b(add|put)\s+(?:it|that|this|them)?\s*(?:to|in|into)\s+(?:the\s+)?cart\b/i,
  /\badd\s+.+\s+to\s+(?:the\s+)?cart\b/i,
  /\badd\s+(?:the\s+)?(?:first|1st|number\s*\d+)\b/i,
  /\badd\s+to\s+(?:the\s+)?cart\b/i,
  /\bput\s+(?:it\s+)?in\s+(?:the\s+)?cart\b/i,
  // Hindi (roman + Devanagari)
  /\b(cart\s+me\s+add|cart\s+mein\s+add|add\s+to\s+cart|cart\s+me\s+jod|cart\s+mein\s+jod|jodo|daal\s+do)\b/i,
  /कार्ट\s+में\s+(जोड़|डाल|डालो|जोड़ो|जोड़िए)/,
  /कार्ट\s+मे\s+(जोड़|डाल)/,
  // Kannada
  /\b(cart\s+ge\s+(serisu|add|haak|iddu)|add\s+to\s+cart)\b/i,
  /ಕಾರ್ಟ್‌ಗೆ\s+(ಸೇರಿಸ|ಹಾಕ)/,
  /ಕಾರ್ಟ್\s+ಗೆ\s+(ಸೇರಿಸ|ಹಾಕ)/,
  // Telugu
  /\b(cart\s+lo\s+(add|pettu|join)|add\s+to\s+cart)\b/i,
  /కార్ట్‌లో\s+(చేర్చ|జోడించ|పెట్ట)/,
  /కార్ట్\s+లో\s+(చేర్చ|జోడించ)/
];

const HELP_PATTERNS = [
  /\b(what('?s)? next|what do i say|help|where am i|which step|repeat)\b/i,
  /\b(agla\s+kya|aage\s+kya|kya\s+bolu|madad|sahayata|guide\s+karo)\b/i,
  /\b(mundina\s+enu|yaava\s+hatvu|sahaya\s+beku|marali\s+heli)\b/i,
  /\b(taruvata\s+emiti|em\s+cheppali|sahayam|malli\s+cheppu)\b/i,
  /मदद|सहायता|आगे\s+क्या|क्या\s+बोलू|दोहराएं/,
  /ಸಹಾಯ|ಮುಂದೆ\s+ಏನು|ಮತ್ತೆ\s+ಹೇಳಿ/,
  /సహాయం|తర్వాత\s+ఏమి|మళ్ళీ\s+చెప్పు/
];

const CONFIRM_PATTERNS = [
  /\b(yes|yeah|yep|confirm|confirmed|go ahead|proceed|ok|okay|do it|place it|place order|place the order)\b/i,
  /^(haan|haanji|han|ji|theek\s+hai|thik\s+hai|bilkul|sahi|kar\s+do|kar\s+dijiye)$/i,
  /\b(haan|haanji|han|ji|theek\s+hai|sahi|bilkul)\b/i,
  /^(howdu|sari|sariyaagi|houdu|ok|okay)$/i,
  /\b(howdu|sari|sariyaagi|houdu)\b/i,
  /^(avunu|sare|ade|ok|okay)$/i,
  /\b(avunu|sare|ade)\b/i,
  /^(ಹೌದು|ಸರಿ|ಆಯಿತು|ಒಕೆ)$/,
  /^(అవును|సరే|ఆయింది|ఒకే)$/
];

const REJECT_PATTERNS = [
  /\b(no|nope|cancel that|don't|do not|stop|never mind|nevermind)\b/i,
  /^(nahi|nahin|mat|ruk|band)\b/i,
  /\b(nahi|nahin|mat\s+karo|cancel\s+karo)\b/i,
  /^(illa|beda|baradu|nope)$/i,
  /\b(illa|beda|baradu)\b/i,
  /^(ledu|vaddu|cheyaku)$/i,
  /\b(ledu|vaddu)\b/i,
  /^(ನಹಿ|ಬೇಡ|ಇಲ್ಲ|ರದ್ದು)$/,
  /^(లేదు|వద్దు|ఆపు|రద్దు)$/
];

const AFFIRM_SHORT = [
  /^(yes|yeah|yep|sure|ok|okay|add it|please add)\b/i,
  /^(haan|haanji|han|ji|theek|sahi)\b/i,
  /^(howdu|sari|houdu)\b/i,
  /^(avunu|sare|ade)\b/i,
  /^(ಹೌದು|ಸರಿ)$/,
  /^(అవును|సరే)$/
];

const PICK_CONFIRM = [
  /^(yes|yeah|yep|sure|ok|okay|that one|this one|select|confirm)\b/i,
  /^(haan|haanji|han|ji|yeh|yehi|wahi)\b/i,
  /^(howdu|sari|adu|ide)\b/i,
  /^(avunu|sare|ade|idi)\b/i,
  /^(ಹೌದು|ಸರಿ|ಅದು|ಇದು)$/,
  /^(అవును|సరే|అదే|ఇది)$/
];

const CART_CONTINUE_PATTERNS = [
  /^(yes|yeah|yep|ok|okay|sure|continue|next|proceed|go ahead|ready|done)\b/i,
  /\b(select supplier|choose supplier|pick supplier|supplier selection|continue to supplier|next step)\b/i,
  /^(haan|ji|aage\s+badho|jari\s+rakho|continue|chaliye|chalo)\b/i,
  /\b(supplier\s+select|supplier\s+chun|supplier\s+chuniye|aage\s+badho|cart\s+se\s+aage)\b/i,
  /^(howdu|sari|munduvarisu|continue|haggu|mundhe)\b/i,
  /\b(supplier\s+select\s+maadi|mundu\s+heli|cart\s+inda\s+mundu)\b/i,
  /^(avunu|sare|continue|munduku|sare\s+munduku)\b/i,
  /\b(supplier\s+select\s+cheyyandi|munduku|cart\s+nundi\s+munduku)\b/i,
  /^(जारी\s+रख|आगे\s+बढ़|सप्लायर|ठीक\s+है|हाँ|हां)/,
  /^(ಮುಂದುವರಿಸ|ಸರಿ|ಸಪ್ಲೈಯರ್|ಹೌದು)/,
  /^(కొనసాగ|సరే|సప్లైయర్|అవును)/
];

const RESUME_CHECKOUT_PATTERNS = [
  /\b(continue|resume|proceed with)\s+(?:the\s+)?(?:order|checkout|purchase)\b/i,
  /\b(checkout|check out)\s+(?:from\s+)?(?:the\s+)?cart\b/i,
  /\bcontinue from cart\b/i,
  /\bfinish (?:my )?order\b/i,
  /\b(order from cart|buy from cart)\b/i,
  /\b(cart\s+se\s+checkout|checkout\s+continue|order\s+place)\b/i,
  /\b(cart\s+inda\s+checkout|checkout\s+munduvarisu)\b/i,
  /\b(cart\s+nundi\s+checkout|checkout\s+continue)\b/i
];

const GO_TO_PATTERNS = [
  [/\b(go to|open|show|view|take me to|switch to)\s+(?:the\s+)?cart\b/i, 'cart'],
  [/\bmy cart\b/i, 'cart'],
  [/\bwhat(?:'s| is) in (?:the )?cart\b/i, 'cart'],
  [/\b(go to|open)\s+(?:the\s+)?product\s+discovery\b/i, 'product_discovery'],
  [/\b(go to|open)\s+(?:the\s+)?(?:supplier|vendor)\s*(?:select(?:ion)?)?\b/i, 'supplier_select'],
  [/\b(go to|open)\s+(?:the\s+)?substitution\b/i, 'substitution'],
  [/\b(go to|open)\s+(?:the\s+)?(?:create\s+)?(?:purchase\s+)?order\b/i, 'create_po'],
  [/\b(go to|open)\s+(?:the\s+)?transport\b/i, 'transport'],
  [/\b(go to|open)\s+(?:the\s+)?(?:my\s+)?orders\b/i, 'orders'],
  [/\b(cart\s+(?:par|me|mein)\s+jao|mera\s+cart|my\s+cart|cart\s+dikhao)\b/i, 'cart'],
  [/ನನ್ನ\s+ಕಾರ್ಟ್/i, 'cart'],
  [/నా\s+కార్ట్/i, 'cart'],
  [/ಕಾರ್ಟ್\s+(ತೆರೆ|ತೋರಿಸ)/i, 'cart'],
  [/కార్ట్\s+(ఓపెన్|చూపించ)/i, 'cart'],
  [/\b(product\s+discovery|product\s+khojo|product\s+search)\b/i, 'product_discovery'],
  [/ಉತ್ಪನ್ನ\s+ಹುಡುಕಾಟ/i, 'product_discovery'],
  [/ఉత్పత్తి\s+అన్వేషణ/i, 'product_discovery']
];

const SEARCH_RESTART_PATTERNS = [
  /\b(search|find|look(?:ing)?\s+for|show\s+me)\b/i,
  /\b(dhoondo|khojo|search\s+karo|dhundho)\b/i,
  /\b(hudi|search\s+maadi|shodhisu)\b/i,
  /\b(vethuku|search\s+cheyyandi|kanu)\b/i,
  /खोज|ढूंढ/,
  /ಹುಡುಕ|ಶೋಧಿಸ/,
  /వెతక|శోధించ/
];

const SHORT_CONTROL =
  /^(yes|no|ok|okay|cancel|stop|skip|none|haan|nahi|howdu|illa|avunu|ledu|sari|sare|ಹೌದು|ಸರಿ|ಇಲ್ಲ|ಅವును|లేదు)$/i;

const PLACE_ORDER_PATTERNS = [
  /\b(place (the )?order|confirm order|submit order|buy now)\b/i,
  /\b(order\s+place|order\s+karo|order\s+confirm)\b/i,
  /ऑर्डर\s+(प्लेस|कन्फर्म|कर|करो|कीजिए)/,
  /ಆರ್ಡರ್\s+(ಪ್ಲೇಸ್|ಕನ್ಫರ್ಮ್|ಮಾಡಿ)/,
  /ఆర్డర్\s+(ప్లేస్|కన్ఫర్మ్|చేయ)/,
  /ఆర్డర్\s+పెట్ట/
];

const NO_SUBSTITUTION_PATTERNS = [
  /^(no|nope|skip|none)$/i,
  /\b(no substitution|skip substitution|skip|none|no substitute|without substitution|not needed)\b/i,
  /\b(substitution\s+nahi|substitute\s+mat|skip\s+karo|nahi\s+chahiye|mat\s+chahiye)\b/i,
  /\b(substitution\s+illa|beda|baradu|skip\s+maadi)\b/i,
  /\b(substitution\s+ledu|vaddu|skip\s+cheyyandi)\b/i,
  /ಬದಲಿ\s+(ಬೇಡ|ಇಲ್ಲ)|ಪರ್ಯಾಯ\s+ಬೇಡ/,
  /ప్రత్యామ్నాయం\s+(వద్దు|లేదు)|సబ్స్టిట్యూషన్\s+లేదు/,
  /प्रतिस्थापन\s+नहीं|बदलाव\s+नहीं|विकल्प\s+नहीं|substitution\s+nahi|नहीं\s+चाहिए/
];

const SUBSTITUTION_ACCEPT_PATTERNS = [
  /\b(yes|accept|approve|ok|okay)\b/i,
  /\b(haan|sab\s+accept|theek\s+hai)\b/i,
  /\b(howdu|sari|sweekarisu)\b/i,
  /\b(avunu|sare|accept\s+cheyyi)\b/i,
  /ಸ್ವೀಕರಿಸ|ಒಪ್ಪು/,
  /అంగీకరించ|అవును\s+అన్ని/
];

const DEFAULT_DATE_PATTERNS = [
  /\bdefault\b/i,
  /\b(jaisa\s+default|default\s+date|default\s+rakho)\b/i,
  /\b(default\s+heli|default\s+date)\b/i,
  /\b(default\s+cheppandi|default\s+pettu)\b/i,
  /डिफ़ॉल्ट|डिफॉल्ट|डिफाल्ट/,
  /ಡೀಫಾಲ್ಟ್|ಡಿಫಾಲ್ಟ್/,
  /డిఫాల్ట్|డీఫాల్ట్/
];

const TRANSPORT_RETRY_PATTERNS = [
  /\b(retry|reload|try again|refresh|load (?:quotes|transport) again)\b/i,
  /\b(dobara|phir\s+se|retry\s+karo)\b/i,
  /\b(matte|swalpa\s+hinde|retry\s+maadi)\b/i,
  /\b(malli|retry\s+cheyyandi)\b/i,
  /दोबारा|पुनः\s+प्रयास/,
  /ಮತ್ತೆ\s+ಪ್ರಯತ್ನ/,
  /మళ్ళీ\s+ప్రయత్నించ/
];

const PAYMENT_COD_PATTERNS = [
  /\b(cod|cash on delivery|cash)\b/i,
  /\b(cash\s+on\s+delivery|delivery\s+par\s+cash|cod)\b/i,
  /कैश\s+ऑन\s+डिलीवरी|डिलीवरी\s+पर\s+नकद|सीओडी/,
  /ಕ್ಯಾಶ್\s+ಆನ್\s+ಡೆಲಿವರಿ|ನಗದು/,
  /క్యాష్\s+ఆన్\s+డెలివరీ|నగదు/
];

const PAYMENT_ONLINE_PATTERNS = [
  /\b(online|upi|card|razorpay|digital)\b/i,
  /\b(online\s+payment|upi|card)\b/i,
  /ऑनलाइन|यूपीआई|कार्ड/,
  /ಆನ್‌ಲೈನ್|ಯುಪಿಐ/,
  /ఆన్‌లైన్|యుపిఐ/
];

const PAYMENT_BANK_PATTERNS = [
  /\b(bank transfer|neft|rtgs|bank)\b/i,
  /\b(bank\s+transfer|neft)\b/i,
  /बैंक\s+ट्रांसफर|एनईएफटी/,
  /ಬ್ಯಾಂಕ್\s+ಟ್ರಾನ್ಸ್ಫರ್/,
  /బ్యాంక్\s+ట్రాన్స్ఫర్/
];

const ADDRESS_OK_PATTERNS = [
  /\b(correct|ok|okay|yes|right|fine)\b/i,
  /\b(haan|sahi|theek)\b/i,
  /\b(howdu|sari)\b/i,
  /\b(avunu|sare)\b/i,
  /सही|ठीक\s+है|हाँ/,
  /ಸರಿ|ಹೌದು/,
  /సరే|అవును/
];

function matchesAny(text, patterns) {
  const t = String(text || '').trim();
  if (!t) return false;
  return patterns.some((re) => re.test(t));
}

export function isAddToCartIntent(text) {
  return matchesAny(text, ADD_TO_CART_PATTERNS);
}

export function isHelpPhrase(text) {
  return matchesAny(text, HELP_PATTERNS);
}

export function isConfirmPhrase(text) {
  return matchesAny(text, CONFIRM_PATTERNS);
}

export function isRejectPhrase(text) {
  return matchesAny(text, REJECT_PATTERNS);
}

export function isAffirmShortPhrase(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return AFFIRM_SHORT.some((re) => re.test(t));
}

export function isPickConfirmPhrase(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return false;
  return PICK_CONFIRM.some((re) => re.test(t));
}

export function isCartContinuePhrase(text) {
  return matchesAny(text, CART_CONTINUE_PATTERNS);
}

/** User finished picking couriers on the transport screen (UI or voice). */
export function isTransportDonePhrase(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isCartContinuePhrase(t)) return true;
  return (
    /^(done|finished|complete|ready|okay|ok|yes|sure|next|proceed|go ahead|that'?s all|all set|ho gaya|sab ho gaya)\b/i.test(
      t
    ) ||
    /\b(transport\s+done|done with transport|courier\s+selected|selected transport|use this transport|continue to po|purchase order)\b/i.test(
      t
    )
  );
}

export function isResumeCheckoutPhrase(text) {
  return matchesAny(text, RESUME_CHECKOUT_PATTERNS);
}

export function isExplicitCartCheckoutResume(text) {
  return isResumeCheckoutPhrase(text);
}

export function isSearchRestartPhrase(text) {
  return matchesAny(text, SEARCH_RESTART_PATTERNS);
}

export function isShortControlUtterance(text) {
  return SHORT_CONTROL.test(String(text || '').trim());
}

export function parseGoToScreenIntent(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  for (const [re, screen] of GO_TO_PATTERNS) {
    if (re.test(t)) return screen;
  }
  if (/\b(supplier|vendor)\s+select(?:ion)?\b/i.test(t) && /\b(go|open|show|start|jao|heli|cheppu)\b/i.test(t)) {
    return 'supplier_select';
  }
  if (/सप्लायर|ಸಪ್ಲೈಯರ್|సప్లైయర్/.test(t) && /खोल|ತೆರೆ|ఓపెన్|चुन|ಆಯ್ಕೆ|ఎంచు/.test(t)) {
    return 'supplier_select';
  }
  return null;
}

export function isPlaceOrderPhrase(text) {
  return matchesAny(text, PLACE_ORDER_PATTERNS) || isConfirmPhrase(text);
}

export function isNoSubstitutionPhrase(text) {
  return matchesAny(text, NO_SUBSTITUTION_PATTERNS);
}

export function isSubstitutionAcceptPhrase(text) {
  return matchesAny(text, SUBSTITUTION_ACCEPT_PATTERNS);
}

export function isDefaultDatePhrase(text) {
  return matchesAny(text, DEFAULT_DATE_PATTERNS);
}

export function isTransportRetryPhrase(utterance) {
  return matchesAny(utterance, TRANSPORT_RETRY_PATTERNS);
}

export function isAddressOkPhrase(text) {
  return matchesAny(text, ADDRESS_OK_PATTERNS) || isConfirmPhrase(text);
}

/** @returns {'cod'|'online'|'bank_transfer'|null} */
export function parsePaymentMethodPhrase(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  if (matchesAny(t, PAYMENT_COD_PATTERNS)) return 'cod';
  if (matchesAny(t, PAYMENT_ONLINE_PATTERNS)) return 'online';
  if (matchesAny(t, PAYMENT_BANK_PATTERNS)) return 'bank_transfer';
  return null;
}

// --- FAST / SMART intent routing (all call languages) ---

const GREETING_PATTERNS = [
  /^(hi|hello|hey|namaste|namaskar|good\s+(morning|evening|afternoon))\b/i,
  /^(ನಮಸ್ಕಾರ|ಹಲೋ|ಹೇ)/,
  /^(నమస్కారం|హలో|హే)/,
  /^(नमस्ते|नमस्कार|हे|हैलो|प्रणाम)/
];

const THANKS_PATTERNS = [
  /\b(thanks|thank you|dhanyavad|shukriya)\b/i,
  /\b(bye|goodbye|alvida)\b/i,
  /ಧನ್ಯವಾದ/,
  /ధన్యవాద|వీడ్కోలు/,
  /धन्यवाद|शुक्रिया|अलविदा|बाय|नमस्ते\s+फिर/
];

const SUPPORT_TOPIC_PATTERNS = [
  /\b(refund|return|policy|policies|warranty|faq|support|help|shipping|delivery|payment method|how do i|damaged|razorpay|cod|credit line|cancel(?:lation)?|timeline|eligible|non-returnable|incorrect)\b/i,
  /\b(wapsi|refund\s+kaise|return\s+policy)\b/i,
  /ರಿಫಂಡ್|ರിടರ್ನ್|ನೀತಿ|ವಾರಂಟಿ|ಶಿಪ್ಪಿಂಗ್|ಸಹಾಯ/,
  /రిఫండ్|రిటర్న్|పాలసీ|వారంటీ|షిప్పింగ్|సహాయం/,
  /रिफंड|वापसी|नीति|वारंटी|शिपिंग|मदद|सहायता/
];

const ORDER_TRACK_PATTERNS = [
  /\b(track|order status|where is my order|my orders?|recent orders?|order history)\b/i,
  /\b(mera\s+order|order\s+track|order\s+kaha)\b/i,
  /ಆರ್ಡರ್\s+(ಸ್ಥಿತಿ|ಟ್ರ್ಯಾಕ್|ಎಲ್ಲಿದೆ)|ನನ್ನ\s+ಆರ್ಡರ್/,
  /నా\s+ఆర్డర్|ఆర్డర్\s+స్థితి|ట్రాక్/,
  /मेरा\s+ऑर्डर|ऑर्डर\s+स्थिति|ट्रैक|कहाँ\s+है/
];

const ORDER_CANCEL_CMD_PATTERNS = [
  /\bcancel\s+order\b/i,
  /\border\s+cancel\b/i,
  /ऑर्डर\s+रद्द|रद्द\s+कर/,
  /ಆರ್ಡರ್\s+ರದ್ದು/,
  /ఆర్డర్\s+రద్దు/
];

const ORDER_REORDER_PATTERNS = [
  /\b(reorder|order again)\b/i,
  /फिर\s+ऑर्डर|दोबारा\s+ऑर्डर/,
  /ಮತ್ತೆ\s+ಆರ್ಡರ್/,
  /మళ్ళీ\s+ఆర్డర్/
];

const CHECKOUT_CMD_PATTERNS = [
  /\b(checkout|place\s+(?:my\s+)?order|buy\s+now|check\s+out)\b/i,
  /\b(order\s+place|checkout\s+karo|payment\s+karo)\b/i,
  /ಚೆಕ್‌ಔಟ್|ಆರ್ಡರ್\s+ಪ್ಲೇಸ್/,
  /చెక్‌అవుట్|ఆర్డర్\s+ప్లేస్/,
  /चेकआउट|ऑर्डर\s+प्लेस|खरीद/
];

const CLEAR_CART_PATTERNS = [
  /\b(clear|empty)\s+(?:the\s+)?cart\b/i,
  /कार्ट\s+(खाली|साफ)/,
  /ಕಾರ್ಟ್\s+ಖಾಲಿ/,
  /కార్ట్\s+ఖాళీ/
];

const OPEN_CART_PATTERNS = [
  /\b(my cart|show cart|view cart|open cart|what'?s in (?:the )?cart)\b/i,
  /\b(mera\s+cart|cart\s+dikhao)\b/i,
  /ನನ್ನ\s+ಕಾರ್ಟ್|ಕಾರ್ಟ್\s+ತೋರಿಸ/,
  /నా\s+కార్ట్|కార్ట్\s+చూపించ/
];

const REMOVE_FROM_CART_PATTERNS = [
  /\bremove\s+.+\s+from\s+(?:the\s+)?cart\b/i,
  /कार्ट\s+से\s+हटा/,
  /ಕಾರ್ಟ್\s+ನಿಂದ\s+ತೆಗೆ/,
  /కార్ట్\s+నుండి\s+తీసి/
];

const INVENTORY_PATTERNS = [
  /\b(stock|inventory|in stock|availability)\b/i,
  /स्टॉक|उपलब्धता/,
  /ಸ್ಟಾಕ್|ಲಭ್ಯತೆ/,
  /స్టాక్|అందుబాటు/
];

const ADDRESS_PATTERNS = [
  /\b(shipping address|my address|delivery address|billing address)\b/i,
  /शिपिंग\s+पता|डिलीवरी\s+पता/,
  /ಶಿಪ್ಪಿಂಗ್\s+ವಿಳಾಸ/,
  /షిప్పింగ్\s+చిరునామా/
];

const RECOMMEND_PATTERNS = [
  /\b(recommend|suggestion|what should i buy|buying guide)\b/i,
  /सुझाव|सलाह|क्या\s+खरीदूं/,
  /ಸಲಹೆ|ಶಿಫಾರಸು/,
  /సూచన|సలహా|ఏమి\s+కొనాలి/
];

const COMPARE_PATTERNS = [
  /\b(compare|versus|vs\b|difference between|which (one|product)|best for)\b/i,
  /तुलना|अंतर|कौन\s+सा\s+बेहतर/,
  /ಹೋಲಿಕೆ|ಯಾವುದು\s+ಒಳ್ಳೆಯದು/,
  /పోల్చ|ఏది\s+మంచిది/
];

const EXPLAIN_PATTERNS = [
  /\b(explain|tell me about)\b/i,
  /समझाइए|बताइए|विवरण/,
  /ವಿವರಿಸ|ತಿಳಿಸಿ/,
  /వివరించ|చెప్పండి/
];

const PROCEDURAL_START_PATTERNS = [
  /^(how|what|when|where|why|can i|could i|do you|does|is there|tell me|explain|i want to know)/i,
  /^(kaise|kya|kab|kahan|kyun|batao|bataiye)/i,
  /^(hege|yaavaga|elli|yaake|helu)/i,
  /^(ela|emi|eppudu|ekkada|enduku)/i,
  /^(कैसे|क्या|कब|कहाँ|क्यों|बताइए)/,
  /\b(how do i|how can i|how does|what is the|what are the|tell me about|explain the|walk me through)\b/i,
  /\b(kaise\s+kare|kya\s+hai|em\s+cheyyali|hege\s+madodu)\b/i
];

const COMMANDING_ORDER_PATTERNS = [
  /\b(cancel order|track order|pay online|place order|checkout|add .+ to cart)\b/i,
  /ऑर्डर\s+(रद्द|ट्रैक|प्लेस)/,
  /ಆರ್ಡರ್\s+(ರದ್ದು|ಟ್ರ್ಯಾಕ್)/,
  /ఆర్డర్\s+(రద్దు|ట్రాక్)/
];

const SEARCH_CMD_PATTERNS = [
  /\b(search|find|look(?:ing)?\s+for|show\s+me|i\s+need|get\s+me|do\s+you\s+have|looking\s+for|products?\s+(?:like|for)|need\s+some|any\s+)\b/i,
  /\b(dhoondo|khojo|dhundho|chahiye)\b/i,
  /\b(hudi|shodhisu|beku)\b/i,
  /\b(vethuku|kanu|kavali)\b/i
];

const SMART_EXTRA_PATTERNS = [
  /\b(recommend|suggestion|compare|versus|vs\b|which (one|product)|best for|explain|tell me about|buying guide|what should i buy|difference between)\b/i
];

export function isGreetingPhrase(text) {
  return matchesAny(text, GREETING_PATTERNS);
}

export function isThanksPhrase(text) {
  return matchesAny(text, THANKS_PATTERNS);
}

export function isSupportTopicPhrase(text) {
  return matchesAny(text, SUPPORT_TOPIC_PATTERNS);
}

export function isOrderTrackPhrase(text) {
  return matchesAny(text, ORDER_TRACK_PATTERNS);
}

export function isOrderCancelPhrase(text) {
  return matchesAny(text, ORDER_CANCEL_CMD_PATTERNS);
}

export function isOrderReorderPhrase(text) {
  return matchesAny(text, ORDER_REORDER_PATTERNS);
}

export function isCheckoutCommandPhrase(text) {
  return matchesAny(text, CHECKOUT_CMD_PATTERNS) || isResumeCheckoutPhrase(text);
}

export function isClearCartPhrase(text) {
  return matchesAny(text, CLEAR_CART_PATTERNS);
}

export function isOpenCartPhrase(text) {
  return matchesAny(text, OPEN_CART_PATTERNS) || parseGoToScreenIntent(text) === 'cart';
}

export function isRemoveFromCartPhrase(text) {
  return matchesAny(text, REMOVE_FROM_CART_PATTERNS);
}

export function isInventoryPhrase(text) {
  return matchesAny(text, INVENTORY_PATTERNS);
}

export function isAddressPhrase(text) {
  return matchesAny(text, ADDRESS_PATTERNS);
}

export function isRecommendPhrase(text) {
  return matchesAny(text, RECOMMEND_PATTERNS);
}

export function isComparePhrase(text) {
  return matchesAny(text, COMPARE_PATTERNS);
}

export function isExplainPhrase(text) {
  return matchesAny(text, EXPLAIN_PATTERNS);
}

export function isProceduralStartPhrase(text) {
  return matchesAny(text, PROCEDURAL_START_PATTERNS);
}

export function isCommandingOrderPhrase(text) {
  return matchesAny(text, COMMANDING_ORDER_PATTERNS);
}

export function isSearchCommandPhrase(text) {
  return matchesAny(text, SEARCH_RESTART_PATTERNS) || matchesAny(text, SEARCH_CMD_PATTERNS);
}

export function isSmartConversationPhrase(text) {
  return (
    matchesAny(text, SMART_EXTRA_PATTERNS) ||
    isRecommendPhrase(text) ||
    isComparePhrase(text) ||
    (isExplainPhrase(text) && String(text || '').trim().length > 12)
  );
}
