import { prepareSpeechText } from './prepareSpeechText.js';

const LATIN_CONTRACTIONS = [
  [/\bI am\b/gi, "I'm"],
  [/\bWe are\b/gi, "we're"],
  [/\bYou are\b/gi, "you're"],
  [/\bThey are\b/gi, "they're"],
  [/\bIt is\b/gi, "it's"],
  [/\bThat is\b/gi, "that's"],
  [/\bThere is\b/gi, "there's"],
  [/\bWhat is\b/gi, "what's"],
  [/\bLet us\b/gi, "let's"],
  [/\bDo not\b/gi, "don't"],
  [/\bCannot\b/gi, "can't"],
  [/\bWill not\b/gi, "won't"]
];

/** Optional micro-pauses — disabled by default (commas can sound like clipped words on Edge TTS). */
const DISCOURSE_PAUSE_ENABLED =
  String(process.env.VOICE_TTS_DISCOURSE_PAUSE || 'false').toLowerCase() === 'true';
const DISCOURSE_PAUSE =
  /\b(theek hai|thik hai|achha|accha|sure thing|got it|alright|okay|ok|great|perfect|mil gaya|ho gaya)\b/gi;

/**
 * Text normalization for server TTS — conversational, not document-like.
 */
export function humanizeSpeechText(text, locale = 'en-IN') {
  let s = prepareSpeechText(text, locale);
  if (!s) return '';

  const isLatin =
    !/[\u0900-\u097F\u0C80-\u0CFF\u0C00-\u0C7F]/.test(s) ||
    (s.match(/[A-Za-z]/g) || []).length > (s.match(/[\u0900-\u097F]/g) || []).length;

  if (isLatin) {
    for (const [pattern, replacement] of LATIN_CONTRACTIONS) {
      s = s.replace(pattern, replacement);
    }
    if (DISCOURSE_PAUSE_ENABLED) {
      s = s.replace(DISCOURSE_PAUSE, (m) => `${m},`);
    }
  }

  s = s
    .replace(/\s+-\s+/g, ', ')
    .replace(/\s*,\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}
