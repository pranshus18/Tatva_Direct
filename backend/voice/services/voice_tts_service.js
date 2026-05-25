/**
 * Unified server TTS — streams audio to the browser (no OS voice downloads).
 * Priority: Gemini (if API key) → Edge neural → Piper (VOICE_PYTHON_URL).
 */
import logger from '../../utils/logger.js';
import { humanizeSpeechText } from '../lib/humanizeSpeechText.js';
import { splitTextForTts } from '../lib/ttsTextChunks.js';
import { getVoiceLanguageMeta } from '../lib/voiceLanguageCore.js';
import { geminiTtsService } from './gemini_tts_service.js';
import { edgeTtsService } from './edge_tts_service.js';
import { piperTtsService } from './piper_tts_service.js';

const PROVIDER = String(process.env.VOICE_TTS_PROVIDER || 'edge').toLowerCase();

function preferGemini() {
  if (PROVIDER === 'edge') return false;
  return PROVIDER === 'gemini' && geminiTtsService.isEnabled();
}

function preferEdge() {
  if (PROVIDER === 'gemini') return false;
  return edgeTtsService.isEnabled();
}

async function tryEdgePhrase(text, languageId) {
  if (!preferEdge()) return null;
  try {
    const edge = await edgeTtsService.synthesizePhrase(text, languageId);
    if (edge) return { ...edge, provider: 'edge' };
  } catch (err) {
    if (process.env.VOICE_DEBUG === 'true') {
      logger.warn('[voice TTS] Edge:', err.message);
    }
  }
  return null;
}

async function synthesizePhrase(text, languageId) {
  if (PROVIDER === 'gemini') {
    const gem = await geminiTtsService.synthesizePhrase(text, languageId);
    if (gem) return { ...gem, provider: 'gemini' };
    return tryEdgePhrase(text, languageId);
  }
  return tryEdgePhrase(text, languageId);
}

export const voiceTtsService = {
  isEnabled() {
    return preferGemini() || preferEdge() || piperTtsService.isEnabled();
  },

  providerLabel() {
    if (PROVIDER === 'gemini' && geminiTtsService.isEnabled()) return 'gemini';
    if (preferEdge()) return 'edge';
    if (piperTtsService.isEnabled()) return 'piper';
    return '';
  },

  /**
   * @param {string} text
   * @param {string} languageId
   * @param {(payload: { chunk: string, encoding?: string, sampleRate?: number }) => void} onAudioChunk
   */
  async streamSpeak(text, languageId, onAudioChunk, { fast = false } = {}) {
    const locale = getVoiceLanguageMeta(languageId)?.ttsLocale || 'en-IN';
    const prepared = humanizeSpeechText(text, locale);
    let phrases = splitTextForTts(prepared);
    const singleUtteranceMax =
      Number.parseInt(String(process.env.VOICE_TTS_SINGLE_PHRASE_CHARS || '2400'), 10) || 2400;
    if (fast || prepared.length <= singleUtteranceMax) {
      phrases = [prepared];
    }
    if (!phrases.length) return { ok: false, provider: '' };

    let sent = 0;
    let provider = '';

    const phraseGapMs =
      Number.parseInt(String(process.env.VOICE_TTS_PHRASE_GAP_MS || '200'), 10) || 200;

    try {
      for (let i = 0; i < phrases.length; i += 1) {
        if (i > 0 && phraseGapMs > 0) {
          await new Promise((r) => setTimeout(r, phraseGapMs));
        }
        const phrase = phrases[i];
        const audio = await synthesizePhrase(phrase, languageId);
        if (audio?.chunk) {
          provider = audio.provider || provider;
          onAudioChunk({
            chunk: audio.chunk,
            encoding: audio.encoding || 'pcm16',
            sampleRate: audio.sampleRate || 24000,
            phraseIndex: i,
            phraseCount: phrases.length,
            lastInPhrase: true
          });
          sent += 1;
          continue;
        }

        if (piperTtsService.isEnabled()) {
          try {
            const ok = await piperTtsService.streamSpeak(phrase, (chunk) => {
              provider = 'piper';
              onAudioChunk({ chunk, encoding: 'pcm16', sampleRate: 22050 });
              sent += 1;
            });
            if (ok) continue;
          } catch (err) {
            if (process.env.VOICE_DEBUG === 'true') {
              logger.warn('[voice TTS] Piper:', err.message);
            }
          }
        }
      }
    } catch (err) {
      if (process.env.VOICE_DEBUG === 'true') {
        logger.warn('[voice TTS] streamSpeak:', err.message);
      }
    }

    return { ok: sent > 0, provider };
  }
};
