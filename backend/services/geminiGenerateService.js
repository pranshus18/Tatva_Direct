/**
 * Shared Gemini generateContent helper for structured JSON tasks.
 * Handles gemini-2.5-pro thinking token budget (empty MAX_TOKENS responses).
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

async function getFetch() {
  if (typeof globalThis.fetch === 'function') return globalThis.fetch;
  const nodeFetch = await import('node-fetch');
  return nodeFetch.default;
}

function normalizeModelName(model) {
  return String(model || '')
    .trim()
    .replace(/^models\//, '');
}

function isThinkingModel(model) {
  const name = normalizeModelName(model).toLowerCase();
  return /gemini-2\.5|gemini-3|gemini-2\.0-flash-thinking/.test(name);
}

function isProThinkingModel(model) {
  const name = normalizeModelName(model).toLowerCase();
  return name.includes('pro');
}

/** Visible answer text only — skips internal reasoning parts (thought: true). */
export function extractGeminiVisibleText(data) {
  const candidates = data?.candidates;
  if (!Array.isArray(candidates)) return '';

  for (const candidate of candidates) {
    const parts = candidate?.content?.parts;
    if (!Array.isArray(parts)) continue;

    const visible = parts
      .filter((part) => part && part.thought !== true && typeof part.text === 'string')
      .map((part) => part.text.trim())
      .filter(Boolean);

    if (visible.length > 0) return visible.join('\n').trim();
  }

  return '';
}

export function getGeminiFinishReason(data) {
  return String(data?.candidates?.[0]?.finishReason || '').trim();
}

export function getGeminiThoughtsTokenCount(data) {
  const count = data?.usageMetadata?.thoughtsTokenCount;
  return Number.isFinite(Number(count)) ? Number(count) : null;
}

export function buildJsonGenerationConfig({ model, temperature = 0.2, maxOutputTokens } = {}) {
  const thinking = isThinkingModel(model);
  const tokenBudget =
    maxOutputTokens ??
    (thinking ? Number.parseInt(String(process.env.GEMINI_JSON_MAX_OUTPUT_TOKENS || '8192'), 10) || 8192 : 2048);

  const config = {
    temperature,
    maxOutputTokens: tokenBudget,
    responseMimeType: 'application/json'
  };

  if (thinking) {
    if (isProThinkingModel(model)) {
      const proBudget =
        Number.parseInt(String(process.env.GEMINI_PRO_THINKING_BUDGET || '2048'), 10) || 2048;
      config.thinkingConfig = { thinkingBudget: Math.max(128, proBudget) };
    } else {
      config.thinkingConfig = { thinkingBudget: 0 };
    }
  }

  return config;
}

/** Models to try for JSON extraction (primary from env, then reliable fallbacks). */
export function resolveGeminiJsonModelCandidates() {
  const primary = normalizeModelName(
    process.env.GEMINI_JSON_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  );
  const fallbacks = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  return [...new Set([primary, ...fallbacks].filter(Boolean))];
}

function buildGeminiUrl(model, apiVersion = 'v1beta') {
  const name = normalizeModelName(model);
  return `${GEMINI_BASE}/${apiVersion}/models/${name}:generateContent`;
}

export async function generateGeminiJsonText({
  geminiApiKey,
  userPrompt,
  systemInstruction = null,
  temperature = 0.2,
  maxOutputTokens,
  models = null
}) {
  if (!geminiApiKey) {
    throw new Error('Gemini API key not configured');
  }

  const fetch = await getFetch();
  const modelList = Array.isArray(models) && models.length > 0 ? models : resolveGeminiJsonModelCandidates();
  let lastError = null;

  for (const model of modelList) {
    const body = {
      contents: [{ parts: [{ text: String(userPrompt || '') }] }],
      generationConfig: buildJsonGenerationConfig({ model, temperature, maxOutputTokens })
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: String(systemInstruction) }] };
    }

    try {
      const response = await fetch(`${buildGeminiUrl(model)}?key=${geminiApiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        lastError = new Error(`Gemini API error (${model}, ${response.status}): ${errorText.slice(0, 400)}`);
        continue;
      }

      const data = await response.json();
      if (data.promptFeedback?.blockReason) {
        lastError = new Error(`Gemini blocked prompt (${model}): ${data.promptFeedback.blockReason}`);
        continue;
      }

      let text = extractGeminiVisibleText(data);
      const finishReason = getGeminiFinishReason(data);

      if (!text && finishReason === 'MAX_TOKENS') {
        const retryConfig = buildJsonGenerationConfig({
          model,
          temperature,
          maxOutputTokens: Math.max(8192, maxOutputTokens || 0)
        });
        if (isProThinkingModel(model) && retryConfig.thinkingConfig) {
          retryConfig.thinkingConfig.thinkingBudget = 4096;
        }

        const retryResponse = await fetch(`${buildGeminiUrl(model)}?key=${geminiApiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...body,
            generationConfig: retryConfig
          })
        });

        if (retryResponse.ok) {
          const retryData = await retryResponse.json();
          text = extractGeminiVisibleText(retryData);
          if (text) {
            return { text, model, data: retryData };
          }
          lastError = new Error(
            `Gemini empty after retry (${model}, finishReason: ${getGeminiFinishReason(retryData)}, thoughts: ${getGeminiThoughtsTokenCount(retryData) ?? 'n/a'})`
          );
          continue;
        }
      }

      if (!text) {
        lastError = new Error(
          `Gemini returned empty content (${model}, finishReason: ${finishReason || 'unknown'}, thoughts: ${getGeminiThoughtsTokenCount(data) ?? 'n/a'})`
        );
        continue;
      }

      return { text, model, data };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError || new Error('All Gemini models failed');
}

export function parseJsonFromAiText(rawText) {
  if (!rawText) return null;
  const stripped = String(rawText)
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(stripped);
  } catch {
    const match = stripped.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
