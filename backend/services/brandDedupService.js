import {
  catalogBrandDedupKey,
  normalizeBrandKey
} from './supplyChainSharedService.js';
import {
  findBrandByNormalizedName,
  listAllBrands,
  updateBrandById
} from '../repositories/brandsRepository.js';

const STATUS_RANK = { approved: 0, pending: 1, rejected: 2 };

export function getCanonicalBrandNormalizedName(brandName) {
  return catalogBrandDedupKey(brandName) || normalizeBrandKey(brandName);
}

export function pickCanonicalBrandDisplayName(...names) {
  const candidates = names
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  if (candidates.length === 0) return '';
  return candidates.sort((a, b) => a.length - b.length || a.localeCompare(b, 'en', { sensitivity: 'base' }))[0];
}

export function brandRowsMatchCatalogDedup(left, right) {
  const leftKey = catalogBrandDedupKey(left?.name || left?.normalized_name);
  const rightKey = catalogBrandDedupKey(right?.name || right?.normalized_name);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

/** Levenshtein distance for controlled near-typo brand matching. */
export function brandNameEditDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

/**
 * True when typed brand is a near-typo of an approved catalog name.
 * - distance 1: samsun ≈ samsung, Fasttrack ≈ Fastrack
 * - distance 2–3 (longer names only): Faststark ≈ Fastrack
 * Rejects distant/short collisions (SPARSGA ↛ Sparsh, prans ↛ pran, AB ↛ ABB).
 */
export function isApprovedBrandNearTypo(typedName, approvedName) {
  const typed = normalizeBrandKey(typedName);
  const approved = normalizeBrandKey(approvedName);
  if (!typed || !approved || typed === approved) return false;

  const maxLen = Math.max(typed.length, approved.length);
  const minLen = Math.min(typed.length, approved.length);
  const lengthDelta = Math.abs(typed.length - approved.length);
  if (maxLen < 5 || lengthDelta > 2) return false;

  const distance = brandNameEditDistance(typed, approved);
  if (distance === 1 && lengthDelta <= 1) {
    // Avoid treating short extensions of short brands as typos (pran → prans).
    if (typed.length > approved.length && approved.length < 6) return false;
    return true;
  }

  // Longer brands: allow a couple of character mistakes when they share a solid prefix.
  let sharedPrefix = 0;
  while (
    sharedPrefix < minLen &&
    typed[sharedPrefix] === approved[sharedPrefix]
  ) {
    sharedPrefix += 1;
  }
  if (minLen >= 8 && sharedPrefix >= 4 && distance <= 3) return true;
  return false;
}

export async function findBrandByCatalogDedupKey(brandName, dbClient, { excludeId } = {}) {
  const targetKey = catalogBrandDedupKey(brandName);
  if (!targetKey) return { data: null, error: null };

  const { data: rows, error } = await listAllBrands(dbClient);
  if (error) return { data: null, error };

  const matches = (rows || []).filter((row) => {
    if (excludeId && String(row.id) === String(excludeId)) return false;
    const rowKey = catalogBrandDedupKey(row?.name || row?.normalized_name);
    return rowKey === targetKey;
  });

  if (matches.length === 0) return { data: null, error: null };
  const [best] = sortBrandRowsForCanonicalPick(matches);
  return { data: best || null, error: null };
}

/**
 * Match a typed brand against already-approved catalog brands.
 * 1) Exact / controlled identity (same catalog dedup key, e.g. Philips ↔ Phillips)
 * 2) Near-typo (edit distance 1), e.g. Faststark ↔ Fastrack
 * Never matches distant names (SPARSGA ↛ Sparsh) or short acronym collisions.
 */
export async function findApprovedCatalogBrandCloseMatch(brandName, dbClient) {
  const typedKey = catalogBrandDedupKey(brandName);
  const typedNorm = normalizeBrandKey(brandName);
  if (!typedKey && !typedNorm) return { data: null, error: null, matchType: null };

  const { data: rows, error } = await listAllBrands(dbClient);
  if (error) return { data: null, error, matchType: null };

  const approved = (rows || []).filter(
    (row) => String(row?.status || '').toLowerCase() === 'approved'
  );
  if (approved.length === 0) return { data: null, error: null, matchType: null };

  const withKeys = approved
    .map((row) => ({
      row,
      key: catalogBrandDedupKey(row?.name || row?.normalized_name),
      norm: normalizeBrandKey(row?.name || row?.normalized_name)
    }))
    .filter((item) => item.key || item.norm);

  if (typedKey) {
    const exact = withKeys.filter((item) => item.key === typedKey);
    if (exact.length > 0) {
      const [best] = sortBrandRowsForCanonicalPick(exact.map((item) => item.row));
      return { data: best || null, error: null, matchType: 'exact' };
    }
  }

  const typos = withKeys.filter((item) => isApprovedBrandNearTypo(typedNorm, item.norm));
  if (typos.length > 0) {
    const [best] = sortBrandRowsForCanonicalPick(typos.map((item) => item.row));
    return { data: best || null, error: null, matchType: 'typo' };
  }

  return { data: null, error: null, matchType: null };
}

function sortBrandRowsForCanonicalPick(rows = []) {
  return [...rows].sort((a, b) => {
    const statusDiff =
      (STATUS_RANK[String(a?.status || '').toLowerCase()] ?? 9) -
      (STATUS_RANK[String(b?.status || '').toLowerCase()] ?? 9);
    if (statusDiff !== 0) return statusDiff;

    const nameLen = String(a?.name || '').trim().length - String(b?.name || '').trim().length;
    if (nameLen !== 0) return nameLen;

    return new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime();
  });
}

/**
 * Merge spelling-variant duplicates (Philips / Phillips) in the brands table.
 * Keeps one canonical row per brand and rejects the rest.
 */
export async function consolidateDuplicateBrands(dbClient) {
  const { data: rows, error } = await listAllBrands(dbClient);
  if (error) throw error;

  const groups = new Map();
  for (const row of rows || []) {
    const key = catalogBrandDedupKey(row?.name || row?.normalized_name);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const nowIso = new Date().toISOString();
  const consolidated = [];

  for (const [, group] of groups) {
    if (group.length === 1) {
      const row = group[0];
      const canonicalNormalized = getCanonicalBrandNormalizedName(row.name || row.normalized_name);
      const canonicalName = pickCanonicalBrandDisplayName(row.name);
      if (
        String(row.normalized_name || '') !== canonicalNormalized ||
        String(row.name || '') !== canonicalName
      ) {
        const { data: updated, error: updateError } = await updateBrandById(
          row.id,
          {
            name: canonicalName,
            normalized_name: canonicalNormalized,
            updated_at: nowIso
          },
          dbClient
        );
        if (updateError) throw updateError;
        consolidated.push(updated);
      } else {
        consolidated.push(row);
      }
      continue;
    }

    const sorted = sortBrandRowsForCanonicalPick(group);
    const canonical = sorted[0];
    const duplicates = sorted.slice(1);
    const canonicalName = pickCanonicalBrandDisplayName(...sorted.map((row) => row.name));
    const canonicalNormalized = getCanonicalBrandNormalizedName(canonicalName);

    const { data: updatedCanonical, error: canonicalError } = await updateBrandById(
      canonical.id,
      {
        name: canonicalName,
        normalized_name: canonicalNormalized,
        updated_at: nowIso
      },
      dbClient
    );
    if (canonicalError) throw canonicalError;

    for (const duplicate of duplicates) {
      const { error: rejectError } = await updateBrandById(
        duplicate.id,
        {
          status: 'rejected',
          rejection_reason: `Duplicate of "${canonicalName}" — merged automatically.`,
          approved_by: null,
          approved_at: null,
          updated_at: nowIso
        },
        dbClient
      );
      if (rejectError) throw rejectError;
    }

    consolidated.push(updatedCanonical);
  }

  return consolidated.sort((a, b) =>
    String(a?.name || '').localeCompare(String(b?.name || ''), 'en', { sensitivity: 'base' })
  );
}

export async function resolveBrandRowForName(brandName, dbClient) {
  const name = String(brandName || '').trim();
  const canonicalNormalized = getCanonicalBrandNormalizedName(name);
  if (!name || !canonicalNormalized) {
    return { data: null, error: null };
  }

  const byCatalog = await findBrandByCatalogDedupKey(name, dbClient);
  if (byCatalog.error) return byCatalog;
  if (byCatalog.data) return byCatalog;

  return findBrandByNormalizedName(canonicalNormalized, dbClient);
}
