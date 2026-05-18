import {
  normalizeSearchQueryAliases,
  SEARCH_TOKEN_ALIASES
} from '../../services/voiceSearchAliases.js';

function normalizeQuery(raw) {
  return String(raw || '')
    .trim()
    .replace(/[.,!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function applyAliases(query) {
  return normalizeSearchQueryAliases(normalizeQuery(query));
}

/**
 * @returns {string[]} unique search strings, most specific first (max 6)
 */
export function expandSearchQueries(rawQuery) {
  const base = normalizeQuery(rawQuery);
  if (!base) return [];

  const out = [];
  const add = (s) => {
    const v = String(s || '').trim();
    if (v && v.length >= 2 && !out.includes(v)) out.push(v);
  };

  add(base);
  add(applyAliases(base));

  const tokens = base.split(/\s+/).filter((t) => t.length >= 3);
  for (const t of tokens) {
    add(t);
    add(SEARCH_TOKEN_ALIASES[t] || '');
  }

  if (tokens.length > 1) {
    add(tokens.slice(0, 2).join(' '));
    add(applyAliases(tokens.join(' ')));
  }

  return out.slice(0, 6);
}
