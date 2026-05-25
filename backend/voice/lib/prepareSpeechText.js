/**
 * Prepare agent text for browser TTS — shared rules (also mirrored in frontend).
 */

const ROBOTIC_PHRASES = [
  [/\bAccording to (?:our |the )?policy,?\s*/gi, ''],
  [/\bAs per (?:the )?policy,?\s*/gi, ''],
  [/\bPlease be advised that\s*/gi, ''],
  [/\bKindly note that\s*/gi, ''],
  [/\bI am unable to\b/gi, "I can't"],
  [/\bI am waiting for your\b/gi, "I'm waiting for your"]
];

function dominantScript(text) {
  const s = String(text || '');
  const dev = (s.match(/[\u0900-\u097F]/g) || []).length;
  const kn = (s.match(/[\u0C80-\u0CFF]/g) || []).length;
  const te = (s.match(/[\u0C00-\u0C7F]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const max = Math.max(dev, kn, te, latin);
  if (max === 0) return 'latin';
  if (dev === max) return 'devanagari';
  if (kn === max) return 'kannada';
  if (te === max) return 'telugu';
  return 'latin';
}

/** Breaks and punctuation that sound natural when spoken. */
export function prepareSpeechText(text, _locale = 'en-IN') {
  let s = String(text || '').trim();
  if (!s) return '';

  for (const [pattern, replacement] of ROBOTIC_PHRASES) {
    s = s.replace(pattern, replacement);
  }

  s = s
    .replace(/\s*—\s*/g, ', ')
    .replace(/\s*–\s*/g, ', ')
    .replace(/\s*;\s*/g, '. ')
    .replace(/\s*:\s*/g, ', ')
    .replace(/\.\.+/g, '.')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();

  const script = dominantScript(s);
  if (script === 'latin') {
    s = s
      .replace(/\b(\d+)\s*km\b/gi, '$1 kilometers')
      .replace(/\b(\d+)\s*nos\b/gi, '$1 pieces')
      .replace(/\bnos\b/gi, 'pieces')
      .replace(/\bRs\.?\s*/gi, 'rupees ')
      .replace(/\bINR\s*/gi, 'rupees ')
      .replace(/\bCOD\b/g, 'cash on delivery')
      .replace(/\bPO\b/g, 'purchase order')
      .replace(/\bUPI\b/gi, 'U P I');
  }

  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}
