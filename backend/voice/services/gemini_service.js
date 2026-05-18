import logger from '../../utils/logger.js';
import { resolveVoiceModels } from '../voiceModel.js';

const SYSTEM =
  'Ecommerce voice assistant. Short answers only (1-2 sentences). Use tools when needed.';

const MODELS = resolveVoiceModels();
const MAX_TOKENS = Number.parseInt(String(process.env.VOICE_MAX_OUTPUT_TOKENS || '96'), 10) || 96;
const TIMEOUT_MS = Number.parseInt(String(process.env.VOICE_GEMINI_TIMEOUT_MS || '8000'), 10) || 8000;

async function fetchGemini(model, body, stream = false) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured');

  const action = stream ? 'streamGenerateContent' : 'generateContent';
  const streamQ = stream ? '&alt=sse' : '';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}?key=${key}${streamQ}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function parseSseChunk(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const json = trimmed.slice(5).trim();
  if (!json || json === '[DONE]') return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export const geminiService = {
  models: MODELS,

  async generate({ contents, tools = null }) {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: { temperature: 0.1, maxOutputTokens: MAX_TOKENS }
    };
    if (tools) body.tools = [{ functionDeclarations: tools }];

    let lastErr;
    for (const model of MODELS) {
      try {
        const res = await fetchGemini(model, body, false);
        const data = await res.json();
        if (!res.ok) {
          const err = new Error(data?.error?.message || `HTTP ${res.status}`);
          err.status = res.status;
          throw err;
        }
        return { model, data };
      } catch (err) {
        lastErr = err;
        logger.warn(`[gemini] ${model}: ${err.message}`);
        if (err.status !== 404 && err.status !== 400) break;
      }
    }
    throw lastErr || new Error('Gemini failed');
  },

  /** Stream text deltas — calls onChunk(text), returns full text + function calls if any. */
  async streamGenerate({ contents, tools = null, onChunk }) {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents,
      generationConfig: { temperature: 0.1, maxOutputTokens: MAX_TOKENS }
    };
    if (tools) body.tools = [{ functionDeclarations: tools }];

    for (const model of MODELS) {
      try {
        const res = await fetchGemini(model, body, true);
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(errBody.slice(0, 200));
        }

        const reader = res.body?.getReader();
        if (!reader) {
          const fallback = await this.generate({ contents, tools });
          const parts = fallback.data.candidates?.[0]?.content?.parts || [];
          const text = parts.filter((p) => p.text).map((p) => p.text).join('');
          if (text && onChunk) onChunk(text);
          return { model, text, functionCalls: parts.filter((p) => p.functionCall).map((p) => p.functionCall) };
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        const functionCalls = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const parsed = parseSseChunk(line);
            if (!parsed) continue;
            const parts = parsed.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.text) {
                fullText += part.text;
                onChunk?.(part.text);
              }
              if (part.functionCall) functionCalls.push(part.functionCall);
            }
          }
        }

        return { model, text: fullText.trim(), functionCalls };
      } catch (err) {
        logger.warn(`[gemini stream] ${model}: ${err.message}`);
      }
    }

    const fallback = await this.generate({ contents, tools });
    const parts = fallback.data.candidates?.[0]?.content?.parts || [];
    const text = parts.filter((p) => p.text).map((p) => p.text).join('').trim();
    if (text && onChunk) onChunk(text);
    return {
      model: fallback.model,
      text,
      functionCalls: parts.filter((p) => p.functionCall).map((p) => p.functionCall)
    };
  }
};
