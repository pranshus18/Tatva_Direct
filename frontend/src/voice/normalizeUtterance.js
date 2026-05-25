/**
 * Browser STT cleanup before sending to the voice agent (mirrors backend/voice/lib/normalizeVoiceUtterance.js).
 */

const SOLE_WORD_QTY = {
  to: '2',
  too: '2',
  tu: '2',
  true: '2',
  do: '2',
  won: '1',
  one: '1',
  tree: '3',
  free: '3',
  for: '4',
  ate: '8',
  sex: '6',
  tin: '10'
};

const TOKEN_ALIASES = {
  simant: 'cement',
  cament: 'cement',
  semment: 'cement',
  siment: 'cement',
  cimint: 'cement',
  stil: 'steel',
  still: 'steel',
  steal: 'steel',
  mack: 'mac',
  mak: 'mac',
  laptap: 'laptop',
  labtop: 'laptop'
};

const NOISE_UTTERANCE_RE =
  /\b(song|music|lyrics|youtube|spotify|netflix|radio|bangla|bollywood|play\s+this|subscribe|thank\s+you\s+for\s+watching)\b/i;

function applyTokenAliases(text) {
  let q = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  q = q.replace(/\bmak\s+air\b/g, 'mac air');
  q = q.replace(/\bmak\s+book\b/g, 'macbook');
  const words = q.split(/\s+/).map((w) => TOKEN_ALIASES[w] || w);
  return words.join(' ').trim();
}

export function normalizeVoiceUtterance(text) {
  let t = String(text || '').trim();
  if (!t) return t;

  t = t.replace(/\s+/g, ' ');

  const low = t.toLowerCase().replace(/[.,!?]+$/g, '').trim();
  if (SOLE_WORD_QTY[low]) return SOLE_WORD_QTY[low];

  const qtyPhrase = low.match(
    /^(?:(?:i\s+)?(?:want|need|order|get|give\s+me|just|only|please)\s+)?(to|too|tu|two|one|three|four|five|six|seven|eight|nine|ten)\s+(?:units?|pieces?|items?|pcs?|nos?)$/i
  );
  if (qtyPhrase) {
    const map = {
      to: '2',
      too: '2',
      tu: '2',
      two: '2',
      one: '1',
      three: '3',
      four: '4',
      five: '5',
      six: '6',
      seven: '7',
      eight: '8',
      nine: '9',
      ten: '10'
    };
    return map[qtyPhrase[1].toLowerCase()] || t;
  }

  t = t
    .replace(/\badd\s+to\s+car\b/gi, 'add to cart')
    .replace(/\bart\s+to\s+cart\b/gi, 'add to cart')
    .replace(/\bhad\s+to\s+cart\b/gi, 'add to cart')
    .replace(/\bcart\s+mean\b/gi, 'cart mein');

  const aliased = applyTokenAliases(t);
  return aliased || t;
}

const QTY_ONLY_RE =
  /^(?:\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|ek|do|teen|char|paanch|ondu|eradu|rendu|moodu|to|too|tu|for|won|एक|दो|तीन|ಒಂದು|ಎರಡು|రెండు|మూడు|number\s+\d{1,4})$/i;

export function isQuantityLikeUtterance(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return QTY_ONLY_RE.test(t);
}

export function isLikelySpeechNoise(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (isQuantityLikeUtterance(t)) return false;
  if (t.length < 2) return true;
  if (NOISE_UTTERANCE_RE.test(t)) return true;
  if (t.length > 100 && !/\b(cart|search|add|order|product|supplier|continue|confirm|cement|steel|help)\b/i.test(t)) {
    return true;
  }
  return false;
}
