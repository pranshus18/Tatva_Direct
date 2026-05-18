import { calculateMatchConfidence, extractTokens } from './textMatchingService.js';
import { normalizeText } from './supplierCatalogHelpersService.js';
import { normalizeSearchQueryAliases } from './voiceSearchAliases.js';

/** Minimum confidence to include a product when ILIKE returned nothing (accent / STT typos). */
export const FUZZY_MATCH_MIN_SCORE = Number.parseFloat(
  String(process.env.PRODUCT_SEARCH_FUZZY_MIN_SCORE || '0.32')
);

/** Re-rank and attach matchScore to discovery rows. */
export function rankProductsByQuery(query, products = []) {
  const q = String(query || '').trim();
  if (!q) {
    return (products || []).map((p) => ({ ...p, matchScore: 0 }));
  }

  const aliasQuery = normalizeSearchQueryAliases(q);

  return (products || [])
    .map((p) => {
      const name = String(p?.name || '');
      const desc = String(p?.description || '');
      const brand = String(p?.brand || '');
      const combinedDesc = [desc, brand].filter(Boolean).join(' ');
      const matchScore = Math.max(
        calculateMatchConfidence(q, name, combinedDesc),
        aliasQuery !== q ? calculateMatchConfidence(aliasQuery, name, combinedDesc) : 0,
        brand ? calculateMatchConfidence(q, brand, name) * 0.95 : 0,
        brand && aliasQuery !== q ? calculateMatchConfidence(aliasQuery, brand, name) * 0.95 : 0
      );
      return { ...p, matchScore };
    })
    .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
}

export function filterByFuzzyScore(ranked = [], { minScore = FUZZY_MATCH_MIN_SCORE, limit = 20 } = {}) {
  const safeLimit = Math.max(1, Number(limit) || 20);
  const min = Number.isFinite(minScore) ? minScore : FUZZY_MATCH_MIN_SCORE;
  return ranked.filter((p) => (p.matchScore || 0) >= min).slice(0, safeLimit);
}

/** Merge product lists by id; keep the row with the higher matchScore. */
export function mergeRankedProducts(existing = [], incoming = []) {
  const byId = new Map();
  for (const p of [...existing, ...incoming]) {
    const id = p?.id;
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev || (p.matchScore || 0) > (prev.matchScore || 0)) {
      byId.set(id, p);
    }
  }
  return [...byId.values()].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
}

/**
 * When ILIKE misses or returns weak matches, scan a larger catalog pool with fuzzy scoring.
 */
export function shouldRunFuzzyFallback(query, rankedWithScores = [], limit = 5) {
  const q = String(query || '').trim();
  if (!q) return false;
  if (!rankedWithScores.length) return true;

  const top = rankedWithScores[0]?.matchScore || 0;
  if (top < FUZZY_MATCH_MIN_SCORE + 0.08) return true;
  if (rankedWithScores.length < Math.min(limit, 3)) return true;

  const tokens = extractTokens(q).filter((t) => t.length >= 3);
  if (tokens.length > 1) {
    const weakTokenCoverage = rankedWithScores.filter(
      (p) => (p.matchScore || 0) >= FUZZY_MATCH_MIN_SCORE
    ).length;
    if (weakTokenCoverage < Math.min(limit, 2)) return true;
  }

  return false;
}

/** Build extra ILIKE patterns from query tokens (helps partial / misordered speech). */
export function buildTokenIlikePatterns(query) {
  const q = normalizeText(query);
  if (!q) return [];

  const tokens = [...new Set(extractTokens(q).filter((t) => t.length >= 3))];
  const patterns = new Set();

  for (const token of tokens) {
    patterns.add(`%${token}%`);
    if (token.length >= 5) {
      patterns.add(`%${token.slice(0, 4)}%`);
    }
  }

  return [...patterns].slice(0, 8);
}
