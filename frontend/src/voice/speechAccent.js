/**
 * Accent + locale resolution for Web Speech API (all call languages).
 * Picks India-region voices and never falls back to US/UK English for Indic calls.
 */

import { getVoiceLanguageMeta, normalizeVoiceLanguage } from './voiceLanguage.js';

/** BCP-47 tags used with speechSynthesis (must match OS-installed voices). */
export const SPEECH_LOCALE = {
  english: 'en-IN',
  hinglish: 'en-IN',
  hindi: 'hi-IN',
  kannada: 'kn-IN',
  telugu: 'te-IN'
};

/** Same speaker hint for every call language (browser fallback only). */
const UNIFIED_VOICE_HINTS = ['prabhat', 'rishi', 'veena', 'madhur'];

/** Ordered voice name hints per locale (macOS / Windows / Chrome). */
const VOICE_NAME_PRIORITY = {
  'hi-in': [
    'lekha',
    'rishi',
    'heera',
    'hemant',
    'madhur',
    'hindi',
    'हिन्दी',
    'हिंदी'
  ],
  'kn-in': ['soumya', 'sapna', 'geeta', 'gagan', 'kannada', 'ಕನ್ನಡ'],
  'te-in': ['chitra', 'mohan', 'telugu', 'తెలుగు'],
  'en-in': ['rishi', 'veena', 'priya', 'karen', 'daniel', 'moira', 'india', 'en-in']
};

const LOCALE_PROSODY = {
  'en-in': { rate: 0.9, pitch: 1.03 },
  'hi-in': { rate: 0.86, pitch: 1.02 },
  'kn-in': { rate: 0.85, pitch: 1.02 },
  'te-in': { rate: 0.85, pitch: 1.02 }
};

const MIN_VOICE_SCORE = 20;

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

/** Call language id → TTS locale for browser fallback. */
/**
 * When user speaks product names in English during a Hindi/Kannada/Telugu call,
 * Web Speech often mis-hears on hi-IN/kn-IN/te-IN — use en-IN for Latin-only turns.
 */
export function resolveSttLocaleForText(languageId, text = '') {
  const id = normalizeVoiceLanguage(languageId) || 'english';
  const meta = getVoiceLanguageMeta(id);
  const base = meta?.sttLocale || 'en-IN';
  if (id === 'english' || id === 'hinglish') return base;

  const s = String(text || '');
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  const native = (s.match(/[\u0900-\u097F\u0C80-\u0CFF\u0C00-\u0C7F]/g) || []).length;
  if (latin >= 3 && latin >= native * 2) return 'en-IN';
  return base;
}

export function resolveSpeechLocale(languageId, text = '') {
  const id = normalizeVoiceLanguage(languageId) || 'english';
  let locale = SPEECH_LOCALE[id] || getVoiceLanguageMeta(id)?.ttsLocale || 'en-IN';

  const script = dominantScript(text);
  if (script === 'devanagari' && !locale.startsWith('hi')) locale = 'hi-IN';
  if (script === 'kannada' && !locale.startsWith('kn')) locale = 'kn-IN';
  if (script === 'telugu' && !locale.startsWith('te')) locale = 'te-IN';

  return locale;
}

export function getProsodyForLocale(locale) {
  const key = String(locale || 'en-IN').toLowerCase();
  return LOCALE_PROSODY[key] || LOCALE_PROSODY['en-in'];
}

export function scoreSpeechVoice(voice, locale) {
  const name = String(voice?.name || '').toLowerCase();
  const lang = String(voice?.lang || '').toLowerCase();
  const target = String(locale || 'en-IN').toLowerCase();
  const [base] = target.split('-');
  let score = 0;

  if (lang === target) score += 80;
  else if (lang === `${base}-in`) score += 72;
  else if (lang.startsWith(`${base}-`)) score += 55;
  else if (base !== 'en' && lang.startsWith('en-in')) score -= 40;
  else if (base !== 'en' && lang.startsWith('en')) score -= 70;

  const priorities = VOICE_NAME_PRIORITY[target] || [];
  for (let i = 0; i < priorities.length; i += 1) {
    if (name.includes(priorities[i])) score += 50 - i * 3;
  }

  if (/google uk|google us|united states|british|uk english/i.test(name)) score -= 150;
  if (/compact|espeak|android|bad news|bells|boing|whisper|novelty/i.test(name)) score -= 120;
  if (voice?.localService) score += 12;
  if (/microsoft|apple/i.test(name) && /natural|neural|online/i.test(name)) score += 22;

  return score;
}

export function pickSpeechVoice(voices, locale) {
  const list = Array.isArray(voices) ? voices : [];
  const target = String(locale || 'en-IN').toLowerCase();
  const [base] = target.split('-');

  if (!list.length) return null;

  for (const hint of UNIFIED_VOICE_HINTS) {
    const match = list.find((v) => {
      const lang = String(v.lang || '').toLowerCase();
      const name = String(v.name || '').toLowerCase();
      return name.includes(hint) && lang.includes('-in');
    });
    if (match && scoreSpeechVoice(match, locale) >= MIN_VOICE_SCORE) return match;
  }

  const priorities = VOICE_NAME_PRIORITY[target] || [];
  for (let i = 0; i < priorities.length; i += 1) {
    const hint = priorities[i];
    const match = list.find((v) => {
      const lang = String(v.lang || '').toLowerCase();
      const name = String(v.name || '').toLowerCase();
      return name.includes(hint) && (lang === target || lang.startsWith(`${base}-`));
    });
    if (match && scoreSpeechVoice(match, locale) >= MIN_VOICE_SCORE) return match;
  }

  const ranked = list
    .map((v) => ({ v, score: scoreSpeechVoice(v, locale) }))
    .filter((x) => x.score >= MIN_VOICE_SCORE)
    .sort((a, b) => b.score - a.score);

  if (ranked.length) return ranked[0].v;

  if (base !== 'en') {
    const indianMultilingual = list
      .map((v) => ({ v, score: scoreSpeechVoice(v, locale) }))
      .filter((x) => /rishi|veena/i.test(String(x.v.name || '').toLowerCase()))
      .filter((x) => String(x.v.lang || '').toLowerCase().includes('in'))
      .sort((a, b) => b.score - a.score);
    if (indianMultilingual.length && indianMultilingual[0].score >= 10) {
      return indianMultilingual[0].v;
    }
  }

  return null;
}

/** Debug: top voices for a locale (VOICE_DEBUG). */
export function rankVoicesForLocale(voices, locale, limit = 5) {
  return (voices || [])
    .map((v) => ({
      name: v.name,
      lang: v.lang,
      local: v.localService,
      score: scoreSpeechVoice(v, locale)
    }))
    .filter((x) => x.score >= MIN_VOICE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
