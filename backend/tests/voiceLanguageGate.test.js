import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionMemory, newSessionId } from '../voice/sessionMemory.js';
import { AiOrchestrator } from '../voice/core/ai_orchestrator.js';
import {
  getLanguageSelectionPrompt,
  isVoiceMultilingualEnabled,
  parseVoiceLanguageFromText
} from '../voice/lib/voiceLanguage.js';

test('getLanguageSelectionPrompt is always English', () => {
  const p = getLanguageSelectionPrompt();
  assert.match(p, /which language works best|English.*Hindi.*Kannada.*Telugu/i);
  assert.match(p, /English/i);
  assert.match(p, /Hindi/i);
  assert.match(p, /Kannada/i);
  assert.match(p, /Telugu/i);
  assert.match(p, /Hinglish/i);
  const withArg = getLanguageSelectionPrompt('hindi');
  assert.equal(withArg, p, 'hint language must not change the opening prompt');
});

test('parseVoiceLanguageFromText recognizes call languages', () => {
  assert.equal(parseVoiceLanguageFromText('Hindi'), 'hindi');
  assert.equal(parseVoiceLanguageFromText('switch to telugu'), 'telugu');
  assert.equal(parseVoiceLanguageFromText('ಕನ್ನಡ'), 'kannada');
  assert.equal(parseVoiceLanguageFromText('Hinglish'), 'hinglish');
});

test('orchestrator: before selection, small talk gets English language question', async () => {
  if (!isVoiceMultilingualEnabled()) {
    return;
  }
  const memory = new SessionMemory(newSessionId());
  assert.equal(memory.isVoiceLanguageSelected(), false);
  memory.setVoiceLanguage('hindi');
  assert.equal(memory.isVoiceLanguageSelected(), false);

  const orch = new AiOrchestrator('voice-test-token', memory);
  const reply = await orch.handleTranscript('hello there');
  assert.match(reply, /which language works best|English.*Hindi/i);
});

test('orchestrator: explicit language selects and confirms in that language', async () => {
  if (!isVoiceMultilingualEnabled()) {
    return;
  }
  const memory = new SessionMemory(newSessionId());
  const orch = new AiOrchestrator('voice-test-token', memory);

  const reply = await orch.handleTranscript('Telugu');
  assert.equal(memory.isVoiceLanguageSelected(), true);
  assert.equal(memory.getVoiceLanguage(), 'telugu');
  assert.match(reply, /ధన్యవాద|తెలుగు|సహాయ/i);

  const hiReply = await orch.handleTranscript('hi');
  assert.match(hiReply, /Namaskaram|Pranshu|నమస్కారం|ప్రాంశు/i);
});
