import { getVoiceText } from '../i18n/index.js';
import { resolveVoiceLanguage } from './voiceLanguage.js';

/** Resolve spoken UI copy from session language and i18n catalogs. */
export function voiceText(memoryOrLanguage, key, params = {}, fallback = '') {
  return getVoiceText(key, resolveVoiceLanguage(memoryOrLanguage), params, fallback);
}
