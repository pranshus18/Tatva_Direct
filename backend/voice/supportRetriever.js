import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { truncateForSpeech } from './summarizeForVoice.js';
import { getSupportFallbackHuman } from './lib/humanizeReply.js';
import { resolveVoiceLanguage } from './lib/voiceLanguage.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, 'rag', 'documents');

const DEFAULT_K = Number.parseInt(String(process.env.VOICE_RAG_TOP_K || '5'), 10) || 5;
const SNIPPET_MAX = Number.parseInt(String(process.env.VOICE_RAG_SNIPPET_MAX || '600'), 10) || 600;
const MIN_CONFIDENCE = Number.parseFloat(String(process.env.VOICE_RAG_MIN_CONFIDENCE || '0.12')) || 0.12;

const STOP = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'with', 'this', 'that', 'your', 'you',
  'can', 'how', 'what', 'when', 'where', 'why', 'does', 'will', 'from', 'have', 'has',
  'our', 'any', 'all', 'about', 'into', 'than', 'them', 'they', 'their', 'there', 'please',
  'tell', 'explain', 'know', 'want', 'need', 'like', 'just', 'also'
]);

/** Voice-friendly query expansion before retrieval. */
const QUERY_EXPANSIONS = {
  refund: ['refund', 'refunds', 'reimbursement'],
  return: ['return', 'returns', 'send', 'exchange', 'rma'],
  money: ['refund', 'refunds', 'money'],
  back: ['back', 'refund', 'return'],
  shipping: ['shipping', 'delivery', 'dispatch', 'courier', 'ship'],
  track: ['track', 'tracking', 'shipment'],
  cancel: ['cancel', 'cancellation', 'void'],
  payment: ['payment', 'pay', 'razorpay', 'cod', 'credit', 'bank', 'transfer'],
  warranty: ['warranty', 'guarantee', 'defective', 'damaged'],
  address: ['address', 'pincode', 'delivery'],
  cart: ['cart', 'basket'],
  checkout: ['checkout', 'order'],
  policy: ['policy', 'terms', 'rules', 'eligible', 'eligibility']
};

const PHRASE_EXPANSIONS = [
  [/money\s+back/g, ['refund', 'refunds', 'return']],
  [/track(ing)?\s+(my\s+)?order/g, ['track', 'tracking', 'order']],
  [/return\s+policy/g, ['return', 'returns', 'policy', 'refund']],
  [/shipping\s+address/g, ['shipping', 'address', 'pincode']],
  [/how\s+long/g, ['timeline', 'timelines', 'delivery', 'shipping']]
];

/** Boost chunks from the most relevant policy doc when intent is clear. */
const SOURCE_INTENT_BOOST = [
  { terms: ['refund', 'refunds', 'return', 'returns', 'rma', 'exchange'], sources: ['returns_policy.md'], boost: 5 },
  { terms: ['shipping', 'delivery', 'courier', 'dispatch', 'pincode', 'address'], sources: ['shipping.md'], boost: 4 },
  { terms: ['timeline', 'timelines', 'long'], sources: ['shipping.md'], boost: 6 },
  { terms: ['razorpay', 'cod', 'payment', 'pay', 'credit', 'invoice', 'receipt'], sources: ['payments.md', 'faq.md'], boost: 3 },
  { terms: ['cart', 'checkout', 'search', 'product'], sources: ['faq.md'], boost: 3 }
];

let chunks = [];
let wordIndex = new Map();
let docFreq = new Map();
let avgDocLen = 0;
let queryCache = new Map();
const CACHE_MAX = 300;

function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));
}

function expandQueryTokens(queryWords, rawQuery = '') {
  const expanded = new Set(queryWords);
  const q = String(rawQuery || '').toLowerCase();
  for (const [pattern, terms] of PHRASE_EXPANSIONS) {
    if (pattern.test(q)) for (const t of terms) expanded.add(t);
  }
  for (const w of queryWords) {
    for (const [key, synonyms] of Object.entries(QUERY_EXPANSIONS)) {
      if (w === key || synonyms.includes(w)) {
        for (const s of synonyms) expanded.add(s);
      }
    }
  }
  return [...expanded];
}

function sourceIntentBoost(chunk, queryWords) {
  let boost = 0;
  for (const rule of SOURCE_INTENT_BOOST) {
    if (!rule.sources.includes(chunk.source)) continue;
    if (queryWords.some((w) => rule.terms.includes(w))) boost += rule.boost;
  }
  return boost;
}

function variantsForWord(word) {
  const variants = new Set([word]);
  for (const [key, synonyms] of Object.entries(QUERY_EXPANSIONS)) {
    if (word === key || synonyms.includes(word)) {
      variants.add(key);
      for (const s of synonyms) variants.add(s);
    }
  }
  return variants;
}

function countBaseWordHits(chunk, baseWords) {
  const lower = chunk.text.toLowerCase();
  const titleLower = chunk.title.toLowerCase();
  let hits = 0;
  for (const w of baseWords) {
    const variants = variantsForWord(w);
    const matched = [...variants].some(
      (v) => chunk.tokens.includes(v) || lower.includes(v) || titleLower.includes(v)
    );
    if (matched) hits += 1;
  }
  return hits;
}

function chunkMarkdown(source, text) {
  const sections = text
    .split(/\n(?=#{1,3}\s)/)
    .map((p) => p.trim())
    .filter((p) => {
      if (p.length <= 20) return false;
      const body = p.replace(/^#{1,3}\s+[^\n]+\n?/m, '').trim();
      return body.length > 20;
    });
  if (!sections.length && text.trim()) sections.push(text.trim());

  return sections.map((body, i) => {
    const titleMatch = body.match(/^#{1,3}\s+(.+)/m);
    const title = titleMatch?.[1]?.trim() || source.replace(/\.md$/, '');
    const category = source.replace(/\.md$/, '').replace(/_/g, ' ');
    return {
      id: `${source}#${i}`,
      source,
      category,
      text: body,
      title,
      tokens: tokenize(`${title} ${body}`)
    };
  });
}

function buildIndex(allChunks) {
  const index = new Map();
  const df = new Map();
  let totalLen = 0;

  allChunks.forEach((chunk, idx) => {
    totalLen += chunk.tokens.length;
    const seen = new Set(chunk.tokens);
    for (const w of seen) {
      df.set(w, (df.get(w) || 0) + 1);
    }
    for (const w of chunk.tokens) {
      if (!index.has(w)) index.set(w, new Set());
      index.get(w).add(idx);
    }
  });

  avgDocLen = allChunks.length ? totalLen / allChunks.length : 1;
  return { index, df };
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
  const built = buildIndex(allChunks);
  chunks = allChunks;
  wordIndex = built.index;
  docFreq = built.df;
  queryCache.clear();
}

export function warmSupportIndex() {
  if (!chunks.length) loadAndIndex();
  return chunks.length;
}

/** BM25-lite scoring for better ranking than plain keyword overlap. */
function bm25Score(chunkIdx, queryWords) {
  const chunk = chunks[chunkIdx];
  if (!chunk) return 0;

  const k1 = 1.2;
  const b = 0.75;
  const docLen = chunk.tokens.length || 1;
  const lower = chunk.text.toLowerCase();
  const titleLower = chunk.title.toLowerCase();
  let score = 0;
  const n = chunks.length || 1;

  for (const term of queryWords) {
    const tf = chunk.tokens.filter((t) => t === term).length;
    if (!tf && !lower.includes(term) && !titleLower.includes(term)) continue;

    const df = docFreq.get(term) || 0;
    const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
    const freq = tf || (lower.includes(term) ? 1 : 0);
    const norm = freq * (k1 + 1) / (freq + k1 * (1 - b + b * (docLen / avgDocLen)));
    score += idf * norm;

    if (titleLower.includes(term)) score += 2.5;
    if (chunk.category.includes(term)) score += 0.8;
  }

  if (queryWords.includes('timeline') && titleLower.includes('timeline')) score += 4;
  if (queryWords.includes('long') && titleLower.includes('timeline')) score += 3;

  const phrase = queryWords.slice(0, 4).join(' ');
  if (phrase.length > 5 && lower.includes(phrase)) score += 3;

  return score + sourceIntentBoost(chunk, queryWords);
}

function jaccardSimilarity(aTokens, bTokens) {
  const a = new Set(aTokens);
  const b = new Set(bTokens);
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function applyMmr(ranked, k, lambda = 0.7) {
  if (ranked.length <= 1) return ranked.slice(0, k);
  const selected = [ranked[0]];
  const remaining = ranked.slice(1);

  while (selected.length < k && remaining.length) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i += 1) {
      const candidate = remaining[i];
      let maxSim = 0;
      for (const s of selected) {
        maxSim = Math.max(maxSim, jaccardSimilarity(candidate.chunk.tokens, s.chunk.tokens));
      }
      const mmr = lambda * candidate.score - (1 - lambda) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }
  return selected;
}

function normalizeConfidence(score, maxScore, baseHits = 1, baseWordCount = 1) {
  if (!maxScore || maxScore <= 0) return 0;
  const raw = score / maxScore;
  const coverage = baseWordCount ? baseHits / baseWordCount : 0;
  return Math.min(1, Math.max(0, raw * 0.7 + coverage * 0.25 + (score > 3 ? 0.08 : 0)));
}

function formatHit(chunk, score, maxScore, baseHits, baseWordCount) {
  const body = chunk.text.replace(/^#{1,3}\s+[^\n]+\n?/gm, '').replace(/\n+/g, ' ').trim();
  return {
    source: chunk.source,
    title: chunk.title,
    category: chunk.category,
    snippet: body.slice(0, SNIPPET_MAX),
    score,
    confidence: normalizeConfidence(score, maxScore, baseHits, baseWordCount)
  };
}

export function retrieveSupportContext(query, k = DEFAULT_K) {
  warmSupportIndex();
  const q = String(query || '').trim().toLowerCase();
  if (!q || !chunks.length) return [];

  const cacheKey = `${k}:${q}`;
  if (queryCache.has(cacheKey)) return queryCache.get(cacheKey);

  const baseWords = tokenize(q);
  if (!baseWords.length) return [];

  const queryWords = expandQueryTokens(baseWords, q);
  const candidateIds = new Set();
  for (const w of queryWords) {
    for (const id of wordIndex.get(w) || []) candidateIds.add(id);
  }
  if (!candidateIds.size) {
    for (let i = 0; i < chunks.length; i += 1) candidateIds.add(i);
  }

  const minBaseHits = 1;
  const scored = [...candidateIds]
    .map((idx) => {
      const chunk = chunks[idx];
      const score = bm25Score(idx, queryWords);
      const baseHits = countBaseWordHits(chunk, baseWords);
      return { idx, score, baseHits, chunk };
    })
    .filter((r) => r.score > 0 && r.baseHits >= minBaseHits)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return [];

  const maxScore = scored[0].score;
  const diversified = applyMmr(scored, Math.min(k, scored.length));
  const result = diversified.map((r) =>
    formatHit(r.chunk, r.score, maxScore, r.baseHits, baseWords.length)
  );

  if (queryCache.size >= CACHE_MAX) queryCache.clear();
  queryCache.set(cacheKey, result);
  return result;
}

export function getSupportRetrievalConfidence(hits) {
  if (!hits?.length) return 0;
  return hits[0].confidence ?? 0;
}

/** Snippet-only fallback when synthesis is off or Gemini unavailable. */
export function answerSupportQuestion(query, memoryOrLanguage = null) {
  const hits = retrieveSupportContext(query, 3);
  const confidence = getSupportRetrievalConfidence(hits);
  if (!hits.length || confidence < MIN_CONFIDENCE) {
    return getSupportFallbackHuman(resolveVoiceLanguage(memoryOrLanguage));
  }
  const top = hits.slice(0, 2).map((h) => h.snippet).filter(Boolean).join(' ');
  return truncateForSpeech(top || hits[0].title, 320);
}
