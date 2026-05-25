import { normalizeVoiceLanguage } from './voiceLanguageCore.js';

/** Natural phone-call prosody — slightly slower, warmer (env overrides). */
const DEFAULT_PROSODY = {
  rate: String(process.env.VOICE_EDGE_TTS_RATE || '-3%').trim(),
  volume: String(process.env.VOICE_EDGE_TTS_VOLUME || '+8%').trim(),
  pitch: String(process.env.VOICE_EDGE_TTS_PITCH || '-2Hz').trim()
};

const PROSODY_BY_LANG = {
  english: DEFAULT_PROSODY,
  hinglish: { rate: '-6%', volume: '+8%', pitch: '-2Hz' },
  hindi: { rate: '-5%', volume: '+6%', pitch: '-1Hz' },
  kannada: { rate: '-5%', volume: '+6%', pitch: '-1Hz' },
  telugu: { rate: '-5%', volume: '+6%', pitch: '-1Hz' }
};

export function edgeProsodyForLanguage(languageId) {
  const id = normalizeVoiceLanguage(languageId) || 'english';
  return { ...DEFAULT_PROSODY, ...(PROSODY_BY_LANG[id] || {}) };
}
