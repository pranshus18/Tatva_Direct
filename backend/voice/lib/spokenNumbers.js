/**
 * Parse spoken quantities and option numbers (STT-friendly).
 * Handles homophones: "to"/"too" → 2, "won" → 1, etc.
 */

const WORD_NUMBERS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  dozen: 12,
  couple: 2,
  pair: 2,
  // Hindi (roman STT)
  ek: 1,
  do: 2,
  teen: 3,
  char: 4,
  chaar: 4,
  paanch: 5,
  panch: 5,
  chhe: 6,
  che: 6,
  saat: 7,
  aath: 8,
  nau: 9,
  das: 10,
  gyarah: 11,
  barah: 12,
  // Kannada (roman)
  ondu: 1,
  eradu: 2,
  mooru: 3,
  naalku: 4,
  aidu: 5,
  aaru: 6,
  elu: 7,
  entu: 8,
  ombattu: 9,
  hattu: 10,
  // Telugu (roman)
  okati: 1,
  rendu: 2,
  moodu: 3,
  naalugu: 4,
  aidu: 5,
  aaru: 6,
  edu: 7,
  enimidi: 8,
  tommidi: 9,
  padi: 10
};

/** Devanagari / Kannada / Telugu digits as spoken words */
const NATIVE_WORD_NUMBERS = {
  एक: 1,
  दो: 2,
  तीन: 3,
  चार: 4,
  पांच: 5,
  छह: 6,
  सात: 7,
  आठ: 8,
  नौ: 9,
  दस: 10,
  ಒಂದು: 1,
  ಎರಡು: 2,
  ಮೂರು: 3,
  ನಾಲ್ಕು: 4,
  ಐದು: 5,
  ಆರು: 6,
  ಏಳು: 7,
  ಎಂಟು: 8,
  ಒಂಬತ್ತು: 9,
  ಹತ್ತು: 10,
  ఒకటి: 1,
  రెండు: 2,
  మూడు: 3,
  నాలుగు: 4,
  ఐదు: 5,
  ఆరు: 6,
  ఏడు: 7,
  ఎనిమిది: 8,
  తొమ్మిది: 9,
  పది: 10
};

/** Common mis-hearings when user says a digit (especially "two" → "to"/"no"). */
const HOMOPHONE_QTY = {
  to: 2,
  too: 2,
  tu: 2,
  true: 2,
  do: 2,
  won: 1,
  one: 1,
  free: 3,
  tree: 3,
  for: 4,
  fore: 4,
  ate: 8,
  eight: 8,
  sex: 6,
  tin: 10
};

const FILLER_PREFIX =
  /^(?:i\s+)?(?:want|need|order|get|give\s+me|just|only|please|add|put|chahiye|beku|kavali|kodi|heli|boliye|cheppandi)\s+/i;
const FILLER_SUFFIX =
  /\s+(?:please|thanks|thank\s+you|units?|pieces?|items?|pcs?|nos?|numbers?|qty|quantity|maal|pieces|jodi|serisu|add)\s*$/i;
/** Indian English: "two in nos", "2 in number" — STT often drops or garbles this. */
const IN_NOS_SUFFIX = /\s+in\s+(?:nos?|numbers?)\s*$/i;

/** STT often hears "two nos" as "not two". */
function tryMisheardQuantity(t) {
  const notTwo = t.match(/^not\s+(two|to|too|tu)$/);
  if (notTwo) return 2;

  const twoNos = t.match(/^(two|to|too|tu)\s+nos$/);
  if (twoNos) return 2;

  const digitNos = t.match(/^(\d{1,4})\s+nos$/);
  if (digitNos) return clampQty(Number.parseInt(digitNos[1], 10));

  const labeled = t.match(/^(?:number|option|item)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d{1,4})$/);
  if (labeled) {
    const token = labeled[1];
    if (WORD_NUMBERS[token] != null) return clampQty(WORD_NUMBERS[token]);
    if (HOMOPHONE_QTY[token] != null) return clampQty(HOMOPHONE_QTY[token]);
    if (/^\d+$/.test(token)) return clampQty(Number.parseInt(token, 10));
  }

  return null;
}

/** True for bare digits, spoken numbers, and short qty phrases (used by STT noise filter). */
export function isQuantityLikeUtterance(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/^\d{1,4}$/.test(raw)) return true;
  return parseQuantity(raw) != null;
}

export function normalizeQuantityUtterance(text) {
  return String(text || '')
    .trim()
    .replace(/[.,!?]+$/g, '')
    .replace(FILLER_PREFIX, '')
    .replace(IN_NOS_SUFFIX, '')
    .replace(FILLER_SUFFIX, '')
    .trim()
    .toLowerCase();
}

/**
 * STT often merges two short "one" utterances into "11" during quantity pick.
 * @returns {number|null}
 */
export function parseVoicePickQuantity(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const t = normalizeQuantityUtterance(raw);
  if (!t) return null;

  const twinParts = t.split(/\s+/).filter(Boolean);
  if (twinParts.length === 2) {
    const a = parseQuantity(twinParts[0]);
    const b = parseQuantity(twinParts[1]);
    if (a != null && b != null && a === b && a <= 9) return a;
  }

  if (/^(\d)\1+$/.test(t) && t.length >= 2 && t.length <= 4) {
    const digit = Number.parseInt(t[0], 10);
    if (digit >= 1 && digit <= 9) return clampQty(digit);
  }

  return parseQuantity(raw);
}

/**
 * @returns {number|null} positive integer quantity, or null
 */
export function parseQuantity(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const t = normalizeQuantityUtterance(raw);
  if (!t) return null;

  const misheard = tryMisheardQuantity(t);
  if (misheard != null) return misheard;

  const labeledQty = t.match(/^(?:number|no|qty|quantity|nos?)\s+(\d{1,4})$/);
  if (labeledQty) return clampQty(Number.parseInt(labeledQty[1], 10));

  const labeledWord = t.match(
    /^(?:number|no|qty|quantity)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/
  );
  if (labeledWord) {
    const w = labeledWord[1];
    if (WORD_NUMBERS[w] != null) return clampQty(WORD_NUMBERS[w]);
    if (HOMOPHONE_QTY[w] != null) return clampQty(HOMOPHONE_QTY[w]);
  }

  const direct = t.match(/^(\d{1,4})$/);
  if (direct) return clampQty(Number.parseInt(direct[1], 10));

  const hom = HOMOPHONE_QTY[t];
  if (hom != null) return clampQty(hom);

  const embedded = t.match(/\b(\d{1,4})\s*(?:units?|pieces?|items?|pcs?|nos?)?\b/);
  if (embedded) return clampQty(Number.parseInt(embedded[1], 10));

  const homInPhrase = t.match(
    /\b(too|two|to|tu|one|won|three|tree|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|pair|dozen)\b/
  );
  if (homInPhrase) {
    const w = homInPhrase[1];
    if (WORD_NUMBERS[w] != null) return clampQty(WORD_NUMBERS[w]);
    if (HOMOPHONE_QTY[w] != null) return clampQty(HOMOPHONE_QTY[w]);
  }

  for (const [word, num] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(t)) return clampQty(num);
  }

  for (const [word, num] of Object.entries(NATIVE_WORD_NUMBERS)) {
    if (t.includes(word)) return clampQty(num);
  }

  const aCouple = /\b(a\s+)?couple\b/.test(t);
  if (aCouple) return 2;

  return null;
}

/**
 * Last-resort: pull the first bare digit/number from any text, ignoring surrounding noise.
 */
export function extractAnyNumber(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;

  const digit = t.match(/(\d{1,4})/);
  if (digit) return clampQty(Number.parseInt(digit[1], 10));

  for (const [word, num] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(t)) return clampQty(num);
  }
  for (const [word, num] of Object.entries(HOMOPHONE_QTY)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(t)) return clampQty(num);
  }
  for (const [word, num] of Object.entries(NATIVE_WORD_NUMBERS)) {
    if (t.includes(word)) return clampQty(num);
  }

  return null;
}

/**
 * Pick option 1..max from speech (supplier, product, transport).
 * @returns {number|null} zero-based index
 */
/** True when the utterance is only a quantity (not "number 2" / "supplier 2"). */
export function isQuantityOnlyUtterance(text) {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (/\b(?:number|option|item|#|supplier|transport|sankhye|ank|nambar)\s*\d+\b/i.test(raw)) {
    return false;
  }
  if (/\b(first|second|third|1st|2nd|3rd|pehla|dusra|teesra|modala|eradaneya)\b/i.test(raw)) {
    return false;
  }
  return parseQuantity(raw) != null;
}

export function parseSelectionIndex(text, max) {
  const maxN = Math.max(1, Number(max) || 1);
  const raw = String(text || '').trim();
  if (!raw) return null;

  const t = normalizeQuantityUtterance(raw);

  const only = t.match(/^(\d{1,2})$/);
  if (only) {
    const n = Number.parseInt(only[1], 10);
    if (n >= 1 && n <= maxN) return n - 1;
  }

  const hom = HOMOPHONE_QTY[t];
  if (hom != null && hom >= 1 && hom <= maxN) return hom - 1;

  for (const [word, num] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`, 'i').test(t) && num >= 1 && num <= maxN) {
      return num - 1;
    }
  }

  for (const [word, num] of Object.entries(NATIVE_WORD_NUMBERS)) {
    if (t.includes(word) && num >= 1 && num <= maxN) return num - 1;
  }

  const num = t.match(/\b(?:number|#|item|option|supplier|transport|nambar|ank|sankhye)?\s*(\d+)\b/);
  if (num) {
    const n = Number.parseInt(num[1], 10);
    if (n >= 1 && n <= maxN) return n - 1;
  }

  if (/\b(first|1st|pehla|pahla|modala|modalaneya|modata|mottamodati)\b/i.test(t)) return 0;
  if (/\b(second|2nd|dusra|doosra|eradaneya|rendava)\b/i.test(t) && maxN >= 2) return 1;
  if (/\b(third|3rd|teesra|tisra|moradaneya|muudava)\b/i.test(t) && maxN >= 3) return 2;
  if (/\b(fourth|4th|chautha|naalkaneya|naalugava)\b/i.test(t) && maxN >= 4) return 3;
  if (/\b(fifth|5th|paanchva|aidaneya|aidava)\b/i.test(t) && maxN >= 5) return 4;
  if (/पहला|प्रथम/.test(t)) return 0;
  if (/दूसरा|द्वितीय/.test(t) && maxN >= 2) return 1;
  if (/तीसरा|तृतीय/.test(t) && maxN >= 3) return 2;
  if (/ಮೊದಲ|ಒಂದನೇ/.test(t)) return 0;
  if (/ಎರಡನೇ/.test(t) && maxN >= 2) return 1;
  if (/ಮೂರನೇ/.test(t) && maxN >= 3) return 2;
  if (/మొదటి|ఒకటో/.test(t)) return 0;
  if (/రెండో/.test(t) && maxN >= 2) return 1;
  if (/మూడో/.test(t) && maxN >= 3) return 2;

  return null;
}

/** True only for explicit cancel — not when user said a quantity or option number. */
export function isExplicitCancel(text, { pendingType } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return false;

  const qty = parseQuantity(raw);
  if (qty != null) return false;

  const t = raw.toLowerCase();

  if (pendingType === 'await_substitution') {
    if (/\b(no substitution|skip substitution|without substitution|no substitute)\b/.test(t)) {
      return false;
    }
    if (/^(no|nope|skip|none)$/.test(t)) return false;
  }

  // During numeric picks, bare "no" is often STT mis-hearing "two" — require explicit cancel.
  const numericPickPending = new Set([
    'await_add_quantity',
    'await_pick_product',
    'await_select_supplier',
    'await_transport'
  ]);
  if (numericPickPending.has(pendingType)) {
    if (/^(cancel|stop|never\s*mind|nevermind|raddu|band)$/i.test(t)) return true;
    if (/\b(cancel that|don'?t want|do not want|abort|mat\s+karo|beda|vaddu)\b/i.test(t)) return true;
    return false;
  }

  if (/^(no|nope|cancel|stop|never\s*mind|nevermind|nahi|nahin|illa|beda|ledu|vaddu)$/i.test(t)) {
    return true;
  }
  if (/\b(cancel that|don'?t|do not|stop|mat\s+karo|raddu\s+cheyyandi)\b/i.test(t)) return true;

  return /\b(no|nope|cancel that|don't|do not|stop|never mind|nevermind|nahi|nahin|illa|beda|ledu)\b/i.test(
    t
  );
}

function clampQty(n) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x) || x < 1) return null;
  if (x > 9999) return 9999;
  return x;
}
