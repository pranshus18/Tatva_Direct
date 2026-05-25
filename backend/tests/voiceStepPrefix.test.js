import test from 'node:test';
import assert from 'node:assert/strict';
import { stepPrefix } from '../voice/lib/voice_prompts.js';

test('stepPrefix is localized for hindi', () => {
  const p = stepPrefix('cart', 'hindi');
  assert.match(p, /चरण|कार्ट/);
  assert.doesNotMatch(p, /^Step 3, Cart/);
});

test('stepPrefix stays English for english', () => {
  const p = stepPrefix('search', 'english');
  assert.match(p, /Step 1/);
  assert.match(p, /Product search/);
});
