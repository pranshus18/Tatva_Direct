import { AsyncLocalStorage } from 'node:async_hooks';
import { getVoiceText } from '../i18n/index.js';
import {
  VOICE_LANGUAGES,
  getLanguageLabelForVoice,
  getVoiceLanguageMeta,
  normalizeVoiceLanguage,
  parseVoiceLanguageFromText,
  SWITCH_PATTERNS
} from './voiceLanguageCore.js';

export {
  VOICE_LANGUAGES,
  getLanguageLabelForVoice,
  getVoiceLanguageMeta,
  normalizeVoiceLanguage,
  parseVoiceLanguageFromText,
  SWITCH_PATTERNS
} from './voiceLanguageCore.js';

const DEFAULT_LANGUAGE_ID = String(process.env.VOICE_LANGUAGE_MODE || 'english').toLowerCase();
const VOICE_MULTI_LANG_ENABLED = String(process.env.VOICE_MULTI_LANG_ENABLED || 'true').toLowerCase() === 'true';

const languageCtx = new AsyncLocalStorage();

export function isVoiceMultilingualEnabled() {
  return VOICE_MULTI_LANG_ENABLED;
}

export function resolveDefaultVoiceLanguage() {
  return normalizeVoiceLanguage(DEFAULT_LANGUAGE_ID) || 'english';
}

export function resolveVoiceLanguage(memory = null, fallback = null) {
  const current = languageCtx.getStore()?.voiceLanguage;
  if (current && VOICE_LANGUAGES[current]) return current;
  if (memory?.getVoiceLanguage) {
    const fromMemory = normalizeVoiceLanguage(memory.getVoiceLanguage());
    if (fromMemory) return fromMemory;
  }
  return normalizeVoiceLanguage(fallback) || resolveDefaultVoiceLanguage();
}

export function withVoiceLanguage(language, fn) {
  const voiceLanguage = normalizeVoiceLanguage(language) || resolveDefaultVoiceLanguage();
  return languageCtx.run({ voiceLanguage }, fn);
}

/** Always English — spoken before the user has chosen a call language. */
export function getLanguageSelectionPrompt(_language = null) {
  return getVoiceText('language.select', 'english', {}, '');
}

/** Thank-you + how-can-I-help after the user picks a call language. */
export function getLanguageConfirmation(language) {
  const chosen = normalizeVoiceLanguage(language) || 'english';
  const languageName = getLanguageLabelForVoice(chosen, chosen);
  const params = { languageName };

  const specific = getVoiceText(`language.changed.${chosen}`, chosen, params, '');
  if (specific && !/\{languageName\}/.test(specific)) return specific;

  const templated = getVoiceText('language.changed', chosen, params, '');
  if (templated) return templated;

  return `Thank you for selecting ${languageName}. How can I help you today?`;
}

export function getLanguageSwitchedPrompt(language) {
  return getLanguageConfirmation(language);
}
