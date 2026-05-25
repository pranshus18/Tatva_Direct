/**
 * Server TTS via Gemini TTS models — uses GEMINI_API_KEY (same as voice AI).
 */
import logger from '../../utils/logger.js';
import { geminiVoiceForLanguage, ttsStylePrompt } from '../lib/ttsVoiceMap.js';

const DISABLED = String(process.env.VOICE_GEMINI_TTS || 'auto').toLowerCase() === 'false';
const TIMEOUT_MS = Number.parseInt(String(process.env.VOICE_TTS_TIMEOUT_MS || '25000'), 10) || 25000;

const TTS_MODELS = String(process.env.VOICE_GEMINI_TTS_MODEL || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const DEFAULT_MODELS = [
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-flash-tts',
  'gemini-2.5-flash-lite-preview-tts'
];

function modelsToTry() {
  return TTS_MODELS.length ? TTS_MODELS : DEFAULT_MODELS;
}

function extractAudioBase64(data) {
  const direct = data?.output_audio?.data;
  if (direct) return direct;

  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    const inline = part?.inlineData || part?.inline_data;
    if (inline?.data) return inline.data;
  }
  return null;
}

function fetchFailure(err) {
  if (err?.name === 'AbortError') return { ok: false, error: 'timeout' };
  return { ok: false, error: err?.message || 'fetch_failed' };
}

async function postInteractions(apiKey, model, input, voiceName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'Api-Revision': '2026-05-20'
      },
      body: JSON.stringify({
        model,
        input,
        response_modalities: ['audio'],
        generation_config: {
          speech_config: [{ voice: voiceName }]
        }
      }),
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    const b64 = extractAudioBase64(data);
    if (!b64) return { ok: false, error: 'no_audio' };
    return { ok: true, chunk: b64, encoding: 'pcm16', sampleRate: 24000 };
  } catch (err) {
    return fetchFailure(err);
  } finally {
    clearTimeout(timeout);
  }
}

async function postGenerateContent(apiKey, model, input, voiceName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: input }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName }
            }
          }
        }
      }),
      signal: controller.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }
    const b64 = extractAudioBase64(data);
    if (!b64) return { ok: false, error: 'no_audio' };
    return { ok: true, chunk: b64, encoding: 'pcm16', sampleRate: 24000 };
  } catch (err) {
    return fetchFailure(err);
  } finally {
    clearTimeout(timeout);
  }
}

export const geminiTtsService = {
  isEnabled() {
    if (DISABLED) return false;
    return Boolean(process.env.GEMINI_API_KEY);
  },

  async synthesizePhrase(text, languageId) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const input = ttsStylePrompt(text, languageId);
    const voiceName = geminiVoiceForLanguage(languageId);

    try {
      for (const model of modelsToTry()) {
        let result = await postInteractions(apiKey, model, input, voiceName);
        if (!result.ok) {
          result = await postGenerateContent(apiKey, model, input, voiceName);
        }
        if (result.ok) {
          return {
            chunk: result.chunk,
            encoding: result.encoding,
            sampleRate: result.sampleRate
          };
        }
        if (process.env.VOICE_DEBUG === 'true') {
          logger.warn(`[voice TTS] Gemini ${model}: ${result.error}`);
        }
      }
    } catch (err) {
      if (process.env.VOICE_DEBUG === 'true') {
        logger.warn('[voice TTS] Gemini:', err.message);
      }
    }
    return null;
  }
};
