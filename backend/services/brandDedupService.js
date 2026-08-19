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
 * Exact spelling only (case/punctuation ignored). Misspellings are a new brand.
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

  const exact = withKeys.filter(
    (item) =>
      (typedKey && item.key === typedKey) || (typedNorm && item.norm === typedNorm)
  );
  if (exact.length > 0) {
    const [best] = sortBrandRowsForCanonicalPick(exact.map((item) => item.row));
    return { data: best || null, error: null, matchType: 'exact' };
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

export { sortBrandRowsForCanonicalPick };

/** True when a brand row was closed by catalog dedup, not by an admin reject action. */
export function isAutoMergedDuplicateBrandRejection(reason) {
  const text = String(reason || '');
  return (
    /merged automatically/i.test(text) || /duplicate of (approved brand\s+)?["“'`]/i.test(text)
  );
}

export function canonicalBrandNameFromDedupReason(reason) {
  const text = String(reason || '');
  const quoted = text.match(/duplicate of (?:approved brand\s+)?["“']([^"”']+)["”']?/i);
  if (quoted?.[1]) return String(quoted[1]).trim();
  const plain = text.match(/duplicate of (?:approved brand\s+)?([^\s.]+)/i);
  return plain?.[1] ? String(plain[1]).trim() : '';
}

function catalogKeyForLabel(label) {
  return catalogBrandDedupKey(label) || normalizeBrandKey(label);
}

export function collectProductBrandLabels(product = {}) {
  const attrs =
    product?.attributes && typeof product.attributes === 'object' && !Array.isArray(product.attributes)
      ? product.attributes
      : {};
  const labels = [product?.brand, product?.brandModel, attrs.brand, attrs.brandModel];
  const seen = new Set();
  const unique = [];
  for (const raw of labels) {
    const label = String(raw || '').trim();
    if (!label) continue;
    const key = catalogKeyForLabel(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(label);
  }
  return unique;
}

export function resolveBrandRowForProductLabels(labels = [], preferredByKey = new Map()) {
  const entries = (Array.isArray(labels) ? labels : []).map((label) => {
    const key = catalogKeyForLabel(label);
    return {
      label,
      key,
      row: key && typeof preferredByKey.get === 'function' ? preferredByKey.get(key) : null
    };
  });

  const approved = entries.find(
    (entry) => String(entry.row?.status || '').toLowerCase() === 'approved'
  );
  if (approved) return approved;

  for (const entry of entries) {
    if (!isAutoMergedDuplicateBrandRejection(entry.row?.rejection_reason)) continue;
    const canonicalName = canonicalBrandNameFromDedupReason(entry.row.rejection_reason);
    const canonicalKey = catalogKeyForLabel(canonicalName);
    const live =
      canonicalKey && typeof preferredByKey.get === 'function'
        ? preferredByKey.get(canonicalKey)
        : null;
    if (live && String(live.id || '') !== String(entry.row?.id || '')) {
      return {
        label: canonicalName || entry.label,
        key: canonicalKey,
        row: live
      };
    }
  }

  return entries[0] || { label: '', key: '', row: null };
}

/**
 * Brand-approval banner for supplier product cards.
 * Approved / active offers never inherit leftover pending or duplicate-merge noise.
 */
export function toSupplierProductCardBrandApprovalView(product, preferredByKey) {
  const offerStatus = String(product?.status || '').trim().toLowerCase();
  if (offerStatus === 'approved' || offerStatus === 'active') {
    return { status: 'approved', message: '' };
  }

  const labels = collectProductBrandLabels(product);
  const resolved = resolveBrandRowForProductLabels(labels, preferredByKey);
  return toSupplierBrandApprovalView(resolved.row, resolved.label || labels[0] || '');
}

export function catalogKeyForBrandRow(row) {
  const name = String(row?.name || '').trim();
  return (
    catalogBrandDedupKey(name) ||
    normalizeBrandKey(name) ||
    normalizeBrandKey(row?.normalized_name)
  );
}

/**
 * One preferred brand row per catalog identity (approved > pending > rejected).
 * Prevents a leftover auto-merged duplicate from hiding the live brand status.
 */
export function indexPreferredBrandRowsByCatalogKey(rows = []) {
  const grouped = new Map();
  for (const row of rows || []) {
    const key = catalogKeyForBrandRow(row);
    if (!key) continue;
    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  }
  const preferred = new Map();
  for (const [key, group] of grouped) {
    const [best] = sortBrandRowsForCanonicalPick(group);
    preferred.set(key, best);
  }
  return preferred;
}

/** Supplier-facing brand approval fields for a product card. */
export function toSupplierBrandApprovalView(row, brandLabel = '') {
  const label = String(brandLabel || row?.name || '').trim();
  if (!row) {
    return {
      status: label ? 'unregistered' : 'missing',
      message: label ? `Brand approval required for "${label}".` : ''
    };
  }

  const status = String(row.status || 'pending').trim().toLowerCase();
  if (status === 'approved') {
    return { status: 'approved', message: '' };
  }

  if (status === 'rejected') {
    if (isAutoMergedDuplicateBrandRejection(row.rejection_reason)) {
      return {
        status: 'unregistered',
        message: `Brand approval required for "${row.name || label}". Request this brand under Select yourself and wait for admin approval before submitting products.`
      };
    }
    return {
      status: 'rejected',
      message: row.rejection_reason
        ? `Brand "${row.name || label}" was rejected: ${row.rejection_reason}`
        : `Brand "${row.name || label}" was rejected by admin.`
    };
  }

  return {
    status: 'pending',
    message: `Brand approval pending for "${row.name || label}".`
  };
}

/**
 * Merge exact duplicate brand rows (same spelling, ignoring case) in the brands table.
 * Spelling variants stay separate brands and are not auto-rejected.
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
