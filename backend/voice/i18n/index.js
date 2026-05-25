import { enVoiceTexts } from './en.js';
import { hiVoiceTexts } from './hi.js';
import { knVoiceTexts } from './kn.js';
import { teVoiceTexts } from './te.js';
import { normalizeVoiceLanguage } from '../lib/voiceLanguageCore.js';

const catalogs = {
  english: enVoiceTexts,
  hinglish: enVoiceTexts,
  hindi: hiVoiceTexts,
  kannada: knVoiceTexts,
  telugu: teVoiceTexts
};

function interpolate(text, params = {}) {
  return String(text || '').replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''));
}

export function getVoiceText(key, language, params = {}, fallback = '') {
  const lang = normalizeVoiceLanguage(language) || 'english';
  const local = catalogs[lang]?.[key];
  if (local) return interpolate(local, params);
  const english = catalogs.english?.[key];
  if (english) return interpolate(english, params);
  return interpolate(fallback, params);
}
