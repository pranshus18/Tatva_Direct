import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { truncateForSpeech } from './summarizeForVoice.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, 'rag', 'documents');

const STOP = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'with', 'this', 'that', 'your', 'you',
  'can', 'how', 'what', 'when', 'where', 'why', 'does', 'will', 'from', 'have', 'has',
  'our', 'any', 'all', 'about', 'into', 'than', 'them', 'they', 'their', 'there', 'please'
]);

let chunks = [];
let wordIndex = new Map();
let queryCache = new Map();
const CACHE_MAX = 200;

function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));
}

function chunkMarkdown(source, text) {
  const parts = text.split(/\n(?=##\s)/).map((p) => p.trim()).filter((p) => p.length > 24);
  if (!parts.length && text.trim()) parts.push(text.trim());
  return parts.map((body, i) => ({
    id: `${source}#${i}`,
    source,
    text: body,
    title: (body.match(/^##\s+(.+)/m) || [])[1] || source.replace(/\.md$/, '')
  }));
}

function buildIndex(allChunks) {
  const index = new Map();
  allChunks.forEach((chunk, idx) => {
    const words = new Set(tokenize(chunk.text));
    for (const w of words) {
      if (!index.has(w)) index.set(w, new Set());
      index.get(w).add(idx);
    }
  });
  return index;
}

function loadAndIndex() {
  const allChunks = [];
  try {
    for (const name of readdirSync(DOCS_DIR)) {
      if (!name.endsWith('.md')) continue;
      const text = readFileSync(join(DOCS_DIR, name), 'utf8');
      allChunks.push(...chunkMarkdown(name, text));
    }
  } catch {
    /* empty */
  }
  chunks = allChunks;
  wordIndex = buildIndex(allChunks);
  queryCache.clear();
}

export function warmSupportIndex() {
  if (!chunks.length) loadAndIndex();
  return chunks.length;
}

function scoreChunk(chunkIdx, queryWords) {
  const chunk = chunks[chunkIdx];
  if (!chunk) return 0;
  const lower = chunk.text.toLowerCase();
  let score = 0;
  for (const w of queryWords) {
    if (lower.includes(w)) score += 2;
    if (chunk.title.toLowerCase().includes(w)) score += 3;
  }
  const qPhrase = queryWords.join(' ');
  if (qPhrase.length > 6 && lower.includes(qPhrase)) score += 6;
  return score;
}

export function retrieveSupportContext(query, k = 2) {
  warmSupportIndex();
  const q = String(query || '').trim().toLowerCase();
  if (!q || !chunks.length) return [];

  const cacheKey = `${k}:${q}`;
  if (queryCache.has(cacheKey)) return queryCache.get(cacheKey);

  const queryWords = tokenize(q);
  if (!queryWords.length) return [];

  const candidateIds = new Set();
  for (const w of queryWords) {
    for (const id of wordIndex.get(w) || []) candidateIds.add(id);
  }
  if (!candidateIds.size) {
    for (let i = 0; i < chunks.length; i += 1) candidateIds.add(i);
  }

  const ranked = [...candidateIds]
    .map((idx) => ({ idx, score: scoreChunk(idx, queryWords) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  const result = ranked.map(({ idx }) => {
    const c = chunks[idx];
    const body = c.text.replace(/^##\s+[^\n]+\n?/, '').replace(/\n+/g, ' ').trim();
    return { source: c.source, title: c.title, snippet: body.slice(0, 400) };
  });

  if (queryCache.size >= CACHE_MAX) queryCache.clear();
  queryCache.set(cacheKey, result);
  return result;
}

/** Direct spoken answer — no Gemini round-trip for FAQ/policy. */
export function answerSupportQuestion(query) {
  const hits = retrieveSupportContext(query, 2);
  if (!hits.length) {
    return 'I do not have that policy loaded. Contact support or check your orders page.';
  }
  const best = hits[0];
  const text = best.snippet || best.title;
  return truncateForSpeech(text, 280);
}
