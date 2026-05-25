/** Normalize support replies for natural spoken delivery. */

import { getVoiceText } from '../i18n/index.js';
import { resolveVoiceLanguage } from './voiceLanguage.js';
import { wrapEngaging, engagementSeed } from './conversationalVoice.js';
import { prepareSpeechText } from './prepareSpeechText.js';

const ROBOTIC_PATTERNS = [
  [/\bAccording to (?:our |the )?policy,?\s*/gi, ''],
  [/\bAs per (?:the )?policy,?\s*/gi, ''],
  [/\bThe context (?:states|indicates) that\s*/gi, ''],
  [/\bBased on the (?:provided )?context,?\s*/gi, ''],
  [/\bI am an AI\b/gi, ''],
  [/\bI'm an AI\b/gi, '']
];

export function humanizeSupportReply(text, locale = 'en-IN') {
  let s = prepareSpeechText(text, locale);
  for (const [pattern, replacement] of ROBOTIC_PATTERNS) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

export function getSupportFallbackHuman(language = 'english') {
  const lang = resolveVoiceLanguage(null, language);
  return getVoiceText('support.fallback', lang, {}, getVoiceText('support.fallback', 'english', {}, ''));
}

export function getGreetingHuman(language = 'english') {
  const lang = resolveVoiceLanguage(null, language);
  const key = lang === 'hinglish' ? 'greeting.hinglish' : 'greeting.default';
  const body = getVoiceText(key, lang, {}, getVoiceText('greeting.default', 'english', {}, ''));
  return wrapEngaging(lang, body, {
    leadPool: 'welcomeLead',
    seed: engagementSeed(null)
  });
}

export function getThanksHuman(language = 'english') {
  const lang = resolveVoiceLanguage(null, language);
  const body = getVoiceText('thanks.default', lang, {}, getVoiceText('thanks.default', 'english', {}, ''));
  return wrapEngaging(lang, body, { ack: true, seed: engagementSeed(null) });
}
