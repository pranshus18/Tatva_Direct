import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionMemory, newSessionId } from '../voice/sessionMemory.js';
import { AiOrchestrator } from '../voice/core/ai_orchestrator.js';
import { isVoiceMultilingualEnabled, getLanguageConfirmation } from '../voice/lib/voiceLanguage.js';

const LANG_PICK_MS_BUDGET = 250;
const CONFIRM_MAX_CHARS = 140;

async function timeMs(fn) {
  const t0 = performance.now();
  const result = await fn();
  return { ms: performance.now() - t0, result };
}

test('language confirmation thanks user and offers help', () => {
  for (const lang of ['english', 'hinglish', 'hindi', 'kannada', 'telugu']) {
    const text = getLanguageConfirmation(lang);
    assert.ok(text.length > 0, lang);
    assert.ok(
      text.length <= CONFIRM_MAX_CHARS,
      `${lang} confirmation too long (${text.length} chars): ${text}`
    );
    assert.ok(!/\{languageName\}/.test(text), `${lang} still has template: ${text}`);
  }

  assert.match(getLanguageConfirmation('english'), /thank you for selecting english/i);
  assert.match(getLanguageConfirmation('hindi'), /धन्यवाद|मदद/);
  assert.match(getLanguageConfirmation('telugu'), /ధన్యవాద|సహాయ/);
  assert.match(getLanguageConfirmation('kannada'), /ಧನ್ಯವಾದ|ಸಹಾಯ/);
  assert.match(getLanguageConfirmation('hinglish'), /thanks for choosing hinglish|help kar sakta/i);
});

test('language selection orchestrator path is fast', async (t) => {
  if (!isVoiceMultilingualEnabled()) {
    t.skip('VOICE_MULTI_LANG_ENABLED=false');
    return;
  }

  const picks = ['Hindi', 'Telugu', 'Kannada', 'English', 'Hinglish'];
  for (const utterance of picks) {
    const memory = new SessionMemory(newSessionId());
    const orch = new AiOrchestrator('bench-token', memory);
    const { ms, result } = await timeMs(() => orch.handleTranscript(utterance));
    assert.equal(memory.isVoiceLanguageSelected(), true, utterance);
    assert.ok(result.length > 0, utterance);
    assert.ok(
      ms < LANG_PICK_MS_BUDGET,
      `${utterance} took ${ms.toFixed(0)}ms (budget ${LANG_PICK_MS_BUDGET}ms)`
    );
  }
});
