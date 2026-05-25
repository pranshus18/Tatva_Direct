import test from 'node:test';
import assert from 'node:assert/strict';
import { humanizeSpeechText } from '../voice/lib/humanizeSpeechText.js';
import { edgeProsodyForLanguage } from '../voice/lib/edgeProsody.js';

test('humanizeSpeechText uses contractions and ends with period', () => {
  const s = humanizeSpeechText('I am waiting for your confirmation', 'en-IN');
  assert.match(s, /I'm waiting/);
  assert.match(s, /\.$/);
});

test('edgeProsodyForLanguage returns rate pitch volume strings', () => {
  const p = edgeProsodyForLanguage('hinglish');
  assert.match(p.rate, /^[+-]\d+%$/);
  assert.match(p.pitch, /^[+-]\d+Hz$/);
});
