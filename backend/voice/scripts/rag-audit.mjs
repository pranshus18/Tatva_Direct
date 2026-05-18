#!/usr/bin/env node
/**
 * RAG readiness audit — run from backend/: node voice/scripts/rag-audit.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  warmSupportIndex,
  retrieveSupportContext,
  getSupportRetrievalConfidence,
  answerSupportQuestion
} from '../supportRetriever.js';
import { shouldUseSupportRag } from '../lib/supportIntent.js';
import { intentRouter } from '../services/intent_router.js';
import { ActionType } from '../core/routeTypes.js';
import { humanizeSupportReply } from '../lib/humanizeReply.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const goldenPath = join(__dirname, '../rag/golden_questions.json');

const chunkCount = warmSupportIndex();
const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));

let retrievalPass = 0;
let routingPass = 0;

console.log('\n=== Tatva RAG Audit ===\n');
console.log(`Knowledge chunks loaded: ${chunkCount}`);
console.log(`Gemini synthesis: ${process.env.GEMINI_API_KEY ? 'enabled (API key set)' : 'DISABLED — answers will be snippets only'}`);
console.log(`VOICE_RAG_SYNTHESIZE: ${process.env.VOICE_RAG_SYNTHESIZE ?? 'true'}\n`);

console.log('--- Retrieval accuracy (golden set) ---');
for (const row of golden) {
  const hits = retrieveSupportContext(row.question, 3);
  const conf = getSupportRetrievalConfidence(hits);
  const top = hits[0];
  const sourceOk = !row.must_match_source || top?.source === row.must_match_source;
  const termsOk = (row.must_include_terms || []).every((t) =>
    `${top?.title} ${top?.snippet}`.toLowerCase().includes(t.toLowerCase())
  );
  const ok = hits.length && conf >= 0.12 && sourceOk && termsOk;
  if (ok) retrievalPass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${row.question}`);
  if (!ok) {
    console.log(`       top=${top?.source || 'none'} conf=${conf?.toFixed(2)}`);
  }
}

console.log('\n--- Routing (policy vs API) ---');
const routingCases = [
  { q: 'how can I track my order', expect: ActionType.SUPPORT_RAG },
  { q: 'track order PO-12345', expect: ActionType.TRACK_ORDER },
  { q: 'how do refunds work', expect: ActionType.SUPPORT_RAG },
  { q: 'add cement to cart', expect: ActionType.ADD_TO_CART }
];
for (const { q, expect } of routingCases) {
  const d = intentRouter.route(q);
  const ok = d.action === expect;
  if (ok) routingPass += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | "${q}" → ${d.action} (expected ${expect})`);
}

console.log('\n--- Human-like reply checks ---');
const samples = [
  'how do refunds work',
  'what payment methods do you accept',
  'items arrived damaged'
];
for (const q of samples) {
  const routed = shouldUseSupportRag(q);
  const raw = answerSupportQuestion(q);
  const reply = humanizeSupportReply(raw);
  const natural =
    reply.length >= 20 &&
    reply.length <= 400 &&
    !/\baccording to the context\b/i.test(reply) &&
    !/\[returns_policy/i.test(reply);
  console.log(`${natural ? 'PASS' : 'WARN'} | "${q}"`);
  console.log(`       RAG route: ${routed} | ${reply.slice(0, 120)}${reply.length > 120 ? '…' : ''}`);
}

console.log('\n--- Summary ---');
console.log(`Retrieval: ${retrievalPass}/${golden.length}`);
console.log(`Routing:   ${routingPass}/${routingCases.length}`);
console.log(
  '\nNote: This is RAG + optional LLM synthesis — not ML model training.'
);
console.log('For human-like answers in production, set GEMINI_API_KEY and VOICE_RAG_SYNTHESIZE=true.\n');

const allOk = retrievalPass === golden.length && routingPass === routingCases.length;
process.exit(allOk ? 0 : 1);
