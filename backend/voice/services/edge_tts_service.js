/**
 * Server TTS via Microsoft Edge neural voices — no API key, no user voice downloads.
 */
import { EdgeTTS } from 'edge-tts-universal';
import { edgeProsodyForLanguage } from '../lib/edgeProsody.js';
import { edgeVoiceForLanguage } from '../lib/ttsVoiceMap.js';
import { humanizeSpeechText } from '../lib/humanizeSpeechText.js';
import { getVoiceLanguageMeta, normalizeVoiceLanguage } from '../lib/voiceLanguageCore.js';

const DISABLED = String(process.env.VOICE_EDGE_TTS || 'true').toLowerCase() === 'false';

const EDGE_FALLBACK_BY_LANG = {
  hindi: 'hi-IN-MadhurNeural',
  kannada: 'kn-IN-GaganNeural',
  telugu: 'te-IN-MohanNeural'
};

async function synthesizeWithVoice(phrase, voice, languageId) {
  const prosody = edgeProsodyForLanguage(languageId);
  const tts = new EdgeTTS(phrase, voice, prosody);
  const result = await tts.synthesize();
  const audio = result?.audio;
  if (!audio) return null;
  const buf = Buffer.from(await audio.arrayBuffer());
  if (!buf.length) return null;
  return {
    chunk: buf.toString('base64'),
    encoding: 'mp3',
    sampleRate: 24000
  };
}

let warmed = false;

export const edgeTtsService = {
  isEnabled() {
    return !DISABLED;
  },

  /** Prime Edge connection once (faster first language confirmation). */
  warm() {
    if (warmed || DISABLED) return;
    warmed = true;
    void synthesizeWithVoice('Hi.', 'en-IN-PrabhatNeural', 'english').catch(() => {});
  },

  async synthesizePhrase(text, languageId) {
    const locale = getVoiceLanguageMeta(languageId)?.ttsLocale || 'en-IN';
    const phrase = humanizeSpeechText(text, locale);
    if (!phrase) return null;

    const primary = edgeVoiceForLanguage(languageId);
    const voices = [primary];
    const lang = normalizeVoiceLanguage(languageId);
    const fallback = EDGE_FALLBACK_BY_LANG[lang];
    if (fallback && fallback !== primary) voices.push(fallback);

    for (const voice of voices) {
      try {
        const out = await synthesizeWithVoice(phrase, voice, languageId);
        if (out) return out;
      } catch {
        /* try next voice */
      }
    }
    return null;
  }
};
