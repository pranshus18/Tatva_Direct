/**
 * Voice i18n for the browser — imports catalog data only (no Node async_hooks).
 */
import { enVoiceTexts } from '../../../backend/voice/i18n/en.js';
import { hiVoiceTexts } from '../../../backend/voice/i18n/hi.js';
import { knVoiceTexts } from '../../../backend/voice/i18n/kn.js';
import { teVoiceTexts } from '../../../backend/voice/i18n/te.js';
import { normalizeVoiceLanguage } from './voiceLanguage.js';

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

export function voiceText(language, key, params = {}, fallback = '') {
  return getVoiceText(key, language, params, fallback);
}

/** Opening language question is always English. */
export function languageSelectionPrompt() {
  return getVoiceText('language.select', 'english', {}, '');
}
