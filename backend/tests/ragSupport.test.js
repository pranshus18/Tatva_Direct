import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  warmSupportIndex,
  retrieveSupportContext,
  getSupportRetrievalConfidence,
  answerSupportQuestion
} from '../voice/supportRetriever.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(__dirname, '../voice/rag/golden_questions.json');

test('support index loads expanded knowledge base', () => {
  const count = warmSupportIndex();
  assert.ok(count >= 15, `expected >= 15 chunks, got ${count}`);
});

test('retrieveSupportContext ranks policy questions correctly', () => {
  warmSupportIndex();
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));

  let passed = 0;
  for (const row of golden) {
    const hits = retrieveSupportContext(row.question, 3);
    assert.ok(hits.length, `no hits for: ${row.question}`);
    const confidence = getSupportRetrievalConfidence(hits);
    assert.ok(confidence >= 0.12, `low confidence for: ${row.question}`);

    const top = hits[0];
    if (row.must_match_source) {
      assert.equal(
        top.source,
        row.must_match_source,
        `wrong source for "${row.question}": got ${top.source}`
      );
    }

    const blob = `${top.title} ${top.snippet}`.toLowerCase();
    for (const term of row.must_include_terms || []) {
      assert.ok(blob.includes(term.toLowerCase()), `missing "${term}" for: ${row.question}`);
    }
    passed += 1;
  }

  assert.equal(passed, golden.length);
});

test('answerSupportQuestion refuses unknown topics with low confidence', () => {
  warmSupportIndex();
  const answer = answerSupportQuestion('quantum physics orbital perturbation');
  assert.match(answer, /not sure|contact support|orders page/i);
});

test('query expansion improves refund retrieval', () => {
  warmSupportIndex();
  const hits = retrieveSupportContext('money back for my order', 2);
  assert.ok(hits.length);
  assert.ok(
    hits.some((h) => h.source.includes('returns') || h.snippet.toLowerCase().includes('refund')),
    'expected returns/refund content for money back query'
  );
});
