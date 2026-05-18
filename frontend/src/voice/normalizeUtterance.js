/**
 * Fix common browser-STT mistakes before sending to the voice agent.
 */

const SOLE_WORD_QTY = {
  to: '2',
  too: '2',
  tu: '2',
  true: '2',
  do: '2',
  won: '1',
  tree: '3',
  free: '3',
  for: '4',
  ate: '8',
  sex: '6',
  tin: '10'
};

export function normalizeVoiceUtterance(text) {
  let t = String(text || '').trim();
  if (!t) return t;

  const low = t.toLowerCase().replace(/[.,!?]+$/g, '').trim();
  if (SOLE_WORD_QTY[low]) return SOLE_WORD_QTY[low];

  const pieces = low.match(
    /^(?:(?:i\s+)?(?:want|need|order|get|give\s+me|just|only|please)\s+)?(to|too|tu|two|one|three|four|five|six|seven|eight|nine|ten)\s+(?:units?|pieces?|items?|pcs?|nos?)$/i
  );
  if (pieces) {
    const map = { to: '2', too: '2', tu: '2', two: '2', one: '1', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
    return map[pieces[1].toLowerCase()] || t;
  }

  return t;
}
