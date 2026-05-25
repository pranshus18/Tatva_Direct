import test from 'node:test';
import assert from 'node:assert/strict';
import {
  primaryVoiceModel,
  resolveVoiceGeminiTimeoutMs,
  resolveVoiceModels
} from '../voice/voiceModel.js';

function saveEnv() {
  return {
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    VOICE_GEMINI_MODEL: process.env.VOICE_GEMINI_MODEL,
    VOICE_GEMINI_TIMEOUT_MS: process.env.VOICE_GEMINI_TIMEOUT_MS
  };
}

function restoreEnv(saved) {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

test('resolveVoiceModels uses GEMINI_MODEL including gemini-2.5-pro', () => {
  const saved = saveEnv();
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';
  delete process.env.VOICE_GEMINI_MODEL;
  delete process.env.VOICE_GEMINI_TIMEOUT_MS;

  assert.equal(primaryVoiceModel(), 'gemini-2.5-pro');
  assert.equal(resolveVoiceModels()[0], 'gemini-2.5-pro');
  assert.ok(resolveVoiceModels().includes('gemini-2.5-flash'));
  assert.equal(resolveVoiceGeminiTimeoutMs(), 22000);

  restoreEnv(saved);
});

test('VOICE_GEMINI_MODEL overrides GEMINI_MODEL', () => {
  const saved = saveEnv();
  process.env.GEMINI_MODEL = 'gemini-2.5-pro';
  process.env.VOICE_GEMINI_MODEL = 'gemini-2.5-flash';

  assert.equal(primaryVoiceModel(), 'gemini-2.5-flash');

  restoreEnv(saved);
});
