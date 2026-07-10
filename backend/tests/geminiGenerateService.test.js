import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJsonGenerationConfig,
  extractGeminiVisibleText,
  parseJsonFromAiText,
  resolveGeminiJsonModelCandidates
} from '../services/geminiGenerateService.js';

test('extractGeminiVisibleText skips thought parts', () => {
  const text = extractGeminiVisibleText({
    candidates: [
      {
        content: {
          parts: [
            { text: 'internal reasoning...', thought: true },
            { text: '{"ok":true}' }
          ]
        }
      }
    ]
  });
  assert.equal(text, '{"ok":true}');
});

test('buildJsonGenerationConfig raises token budget for gemini-2.5-pro', () => {
  const config = buildJsonGenerationConfig({ model: 'gemini-2.5-pro' });
  assert.equal(config.responseMimeType, 'application/json');
  assert.ok(config.maxOutputTokens >= 8192);
  assert.ok(config.thinkingConfig?.thinkingBudget >= 128);
});

test('buildJsonGenerationConfig disables thinking for gemini-2.5-flash JSON', () => {
  const config = buildJsonGenerationConfig({ model: 'gemini-2.5-flash' });
  assert.equal(config.thinkingConfig?.thinkingBudget, 0);
});

test('parseJsonFromAiText parses fenced JSON', () => {
  const parsed = parseJsonFromAiText('```json\n{"a":1}\n```');
  assert.deepEqual(parsed, { a: 1 });
});

test('resolveGeminiJsonModelCandidates includes primary and fallbacks', () => {
  const prevJson = process.env.GEMINI_JSON_MODEL;
  const prev = process.env.GEMINI_MODEL;
  process.env.GEMINI_JSON_MODEL = '';
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';
  try {
    const models = resolveGeminiJsonModelCandidates();
    assert.equal(models[0], 'gemini-2.5-pro');
    assert.ok(models.includes('gemini-2.5-flash'));
  } finally {
    process.env.GEMINI_JSON_MODEL = prevJson;
    process.env.GEMINI_MODEL = prev;
  }
});
