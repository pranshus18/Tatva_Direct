import test from 'node:test';
import assert from 'node:assert/strict';
import { edgeVoiceForLanguage, geminiVoiceForLanguage } from '../voice/lib/ttsVoiceMap.js';

test('edgeVoiceForLanguage maps call languages to Edge neural voices', () => {
  assert.equal(edgeVoiceForLanguage('english'), edgeVoiceForLanguage('hinglish'));
  assert.match(edgeVoiceForLanguage('english'), /^en-IN-/);
  assert.match(edgeVoiceForLanguage('hindi'), /^hi-IN-/);
  assert.match(edgeVoiceForLanguage('kannada'), /^kn-IN-/);
  assert.match(edgeVoiceForLanguage('telugu'), /^te-IN-/);
});

test('geminiVoiceForLanguage uses one voice for every call language', () => {
  const voice = geminiVoiceForLanguage('english');
  for (const lang of ['english', 'hinglish', 'hindi', 'kannada', 'telugu']) {
    assert.equal(geminiVoiceForLanguage(lang), voice);
  }
});
