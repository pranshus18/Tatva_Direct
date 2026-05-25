import { normalizeVoiceLanguage } from './voiceLanguageCore.js';

/**
 * Variant 2 voices — same warm Indian shop-assistant family.
 * Prabhat for English; locale neural voices required for Devanagari/Kannada/Telugu script.
 */
const EDGE_TTS_VOICES_PRIMARY = {
  english: 'en-IN-NeerjaNeural',
  hinglish: 'en-IN-NeerjaNeural',
  hindi: 'hi-IN-SwaraNeural',
  kannada: 'kn-IN-SapnaNeural',
  telugu: 'te-IN-ShrutiNeural'
};

/** Variant 2 — Prabhat/Madhur/Gagan/Mohan; expressive Neerja optional via VOICE_EDGE_VOICE_EN. */
const EDGE_TTS_VOICES_ALT = {
  english: String(process.env.VOICE_EDGE_VOICE_EN || 'en-IN-PrabhatNeural').trim(),
  hinglish: String(process.env.VOICE_EDGE_VOICE_EN || 'en-IN-PrabhatNeural').trim(),
  hindi: String(process.env.VOICE_EDGE_VOICE_HI || 'hi-IN-MadhurNeural').trim(),
  kannada: String(process.env.VOICE_EDGE_VOICE_KN || 'kn-IN-GaganNeural').trim(),
  telugu: String(process.env.VOICE_EDGE_VOICE_TE || 'te-IN-MohanNeural').trim()
};

const EDGE_VARIANT = String(process.env.VOICE_EDGE_VOICE_VARIANT || '2').toLowerCase();

/** Microsoft Edge neural voices — Indian locales, no install on user devices. */
export const EDGE_TTS_VOICES =
  EDGE_VARIANT === '1' || EDGE_VARIANT === 'primary'
    ? EDGE_TTS_VOICES_PRIMARY
    : EDGE_TTS_VOICES_ALT;

/** Gemini prebuilt voices (accent mainly via spoken-style prompt). */
export const GEMINI_TTS_VOICES = {
  english: 'Kore',
  hinglish: 'Kore',
  hindi: 'Kore',
  kannada: 'Kore',
  telugu: 'Kore'
};

export function edgeVoiceForLanguage(languageId) {
  const id = normalizeVoiceLanguage(languageId) || 'english';
  return EDGE_TTS_VOICES[id] || EDGE_TTS_VOICES.english;
}

export function geminiVoiceForLanguage(_languageId) {
  return GEMINI_TTS_VOICES.english;
}

export function ttsStylePrompt(text, languageId) {
  const id = normalizeVoiceLanguage(languageId) || 'english';
  const body = String(text || '').trim();
  const styles = {
    english:
      'Speak warmly like a helpful Indian shop assistant on a phone call. Natural pace, clear en-IN accent. Do not sound robotic.\n\n',
    hinglish:
      'Speak in friendly Hinglish with a natural Indian English accent — warm, clear, like a local dealer on a call. Not robotic.\n\n',
    hindi:
      'Speak in natural Hindi (India) — warm, clear, conversational shop-assistant tone. Not robotic.\n\n',
    kannada:
      'Speak in natural Kannada (India) — warm, clear, conversational tone. Not robotic.\n\n',
    telugu:
      'Speak in natural Telugu (India) — warm, clear, conversational tone. Not robotic.\n\n'
  };
  return `${styles[id] || styles.english}${body}`;
}
