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

function brandNameEditDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prevDiag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, prevDiag + cost);
      prevDiag = temp;
    }
  }
  return prev[b.length];
}

/**
 * Match a typed brand request against already-approved catalog brands
 * (exact key, spelling variant, prefix, or near-typo).
 */
export async function findApprovedCatalogBrandCloseMatch(brandName, dbClient) {
  const typedKey = catalogBrandDedupKey(brandName);
  if (!typedKey) return { data: null, error: null, matchType: null };

  const { data: rows, error } = await listAllBrands(dbClient);
  if (error) return { data: null, error, matchType: null };

  const approved = (rows || []).filter(
    (row) => String(row?.status || '').toLowerCase() === 'approved'
  );
  if (approved.length === 0) return { data: null, error: null, matchType: null };

  const withKeys = approved
    .map((row) => ({
      row,
      key: catalogBrandDedupKey(row?.name || row?.normalized_name)
    }))
    .filter((item) => item.key);

  const exact = withKeys.filter((item) => item.key === typedKey);
  if (exact.length > 0) {
    const [best] = sortBrandRowsForCanonicalPick(exact.map((item) => item.row));
    return { data: best || null, error: null, matchType: 'exact' };
  }

  const prefixHits = withKeys.filter((item) => {
    const shorter = typedKey.length <= item.key.length ? typedKey : item.key;
    const longer = typedKey.length <= item.key.length ? item.key : typedKey;
    return shorter.length >= 4 && longer.startsWith(shorter);
  });
  if (prefixHits.length > 0) {
    const [best] = sortBrandRowsForCanonicalPick(prefixHits.map((item) => item.row));
    return { data: best || null, error: null, matchType: 'prefix' };
  }

  let bestTypo = null;
  for (const item of withKeys) {
    const maxLen = Math.max(typedKey.length, item.key.length);
    if (maxLen < 5) continue;
    const distance = brandNameEditDistance(typedKey, item.key);
    const allowed = maxLen >= 7 ? 2 : 1;
    if (distance > allowed) continue;
    if (!bestTypo || distance < bestTypo.distance) {
      bestTypo = { row: item.row, distance };
    }
  }
  if (bestTypo?.row) {
    return { data: bestTypo.row, error: null, matchType: 'typo' };
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
