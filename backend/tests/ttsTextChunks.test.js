import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTextForTts } from '../voice/lib/ttsTextChunks.js';

test('splitTextForTts breaks long replies', () => {
  const long = 'First sentence. '.repeat(40).trim();
  const chunks = splitTextForTts(long, 100);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((c) => c.length <= 120));
});
