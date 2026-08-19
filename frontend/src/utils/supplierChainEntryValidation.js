import {
  resolveAuthorizationCertificateUrls,
  resolveBrandApprovalDocumentUrls,
  setAuthorizationCertificateUrls,
  setBrandApprovalDocumentUrls
} from './authorizationCertificateUrls';

/** @typedef {{ id?: string, role?: string, brands?: string, gstin?: string, companyName?: string, ownershipDetails?: string, authorizationCertificateUrl?: string, authorizationCertificateUrls?: string[], brandApprovalDocumentUrl?: string, brandApprovalDocumentUrls?: string[], minimumOrderValue?: string|number|null }} ChainEntry */

export function parseBrandsListForValidation(brands) {
  if (brands == null || brands === '') return [];
  if (Array.isArray(brands)) {
    return [...new Set(brands.map(String).map((s) => s.trim()).filter(Boolean))];
  }
  return [
    ...new Set(
      String(brands)
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ];
}

/** Normalize brand text without spelling-collapse (spaces/punctuation only). */
export function normalizeBrandIdentity(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Case-insensitive brand key for duplicate detection across entries.
 * Uses the complete normalized name only — prefixes must not match
 * (e.g. "H" is not a duplicate of "HP"). Spelling variants are distinct brands.
 */
export function brandKeyForDuplicateCheck(raw) {
  return normalizeBrandIdentity(raw);
}

/** True only when both values refer to the same complete brand spelling. */
export function areBrandNamesExactDuplicates(left, right) {
  const leftNorm = normalizeBrandIdentity(left);
  const rightNorm = normalizeBrandIdentity(right);
  return Boolean(leftNorm && rightNorm && leftNorm === rightNorm);
}

function brandNameEditDistance(left, right) {
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

function collectApprovedCatalogRows(catalogBrands = []) {
  const rows = [];
  for (const item of Array.isArray(catalogBrands) ? catalogBrands : []) {
    const name = String(typeof item === 'string' ? item : item?.name || '').trim();
    if (!name) continue;
    const status =
      typeof item === 'object' ? String(item?.status || 'approved').toLowerCase() : 'approved';
    if (status && status !== 'approved') continue;
    const key = brandKeyForDuplicateCheck(name);
    if (!key) continue;
    rows.push({ name, key, norm: normalizeBrandIdentity(name) });
  }
  return rows;
}

/**
 * Exact approved-catalog match used to block a Path B "new brand" request.
 * Misspellings are a new brand. Prefix/typo tips stay in findApprovedCatalogBrandSuggestions.
 * @returns {{ name: string, matchType: 'exact' } | null}
 */
export function findApprovedCatalogBrandMatch(typedName, catalogBrands = []) {
  const typed = String(typedName || '').trim();
  const typedNorm = normalizeBrandIdentity(typed);
  if (!typedNorm) return null;

  const rows = collectApprovedCatalogRows(catalogBrands);

  const exact = rows.find((row) => normalizeBrandIdentity(row.name) === typedNorm);
  if (exact) return { name: exact.name, matchType: 'exact' };

  return null;
}

/**
 * Soft suggestions while the supplier is still typing a new brand name.
 * Does not change workflow by itself — UI may show a tip without blocking.
 * - Prefix: typed is a prefix of an approved brand (min 3 chars), e.g. "sams" → Samsung
 * - Near-typo: distance 1 with nearly equal length (optional tip only)
 * Never suggests when the typed name is longer/different (SPARSGA ↛ Sparsh).
 * @returns {Array<{ name: string, matchType: 'prefix'|'typo' }>}
 */
export function findApprovedCatalogBrandSuggestions(typedName, catalogBrands = []) {
  const typed = String(typedName || '').trim();
  const typedNorm = normalizeBrandIdentity(typed);
  if (!typedNorm || typedNorm.length < 3) return [];

  // Exact identity is handled by findApprovedCatalogBrandMatch — not a soft suggestion.
  if (findApprovedCatalogBrandMatch(typed, catalogBrands)) return [];

  const rows = collectApprovedCatalogRows(catalogBrands);
  const suggestions = [];
  const seen = new Set();

  for (const row of rows) {
    if (seen.has(row.key)) continue;
    // Prefix tip only — never treat as selected / approved / workflow change.
    if (row.norm.startsWith(typedNorm) && row.norm.length > typedNorm.length) {
      seen.add(row.key);
      suggestions.push({ name: row.name, matchType: 'prefix' });
      continue;
    }
    const maxLen = Math.max(typedNorm.length, row.norm.length);
    const lengthDelta = Math.abs(typedNorm.length - row.norm.length);
    if (maxLen < 5 || lengthDelta > 1) continue;
    const distance = brandNameEditDistance(typedNorm, row.norm);
    if (distance === 1) {
      seen.add(row.key);
      suggestions.push({ name: row.name, matchType: 'typo' });
    }
  }

  return suggestions.slice(0, 5);
}

export function formatApprovedCatalogBrandMatchMessage(typedName, matchedName) {
  const typed = String(typedName || '').trim() || 'This brand';
  const matched = String(matchedName || '').trim();
  if (!matched) {
    return `${typed} already exists in the approved brands list. Choose it from the approved brands list instead of requesting a new brand.`;
  }
  if (brandKeyForDuplicateCheck(typed) === brandKeyForDuplicateCheck(matched)) {
    return `"${matched}" is already an approved brand. Choose it from the approved brands list instead of requesting a new brand.`;
  }
  return `"${typed}" looks like approved brand "${matched}". Choose "${matched}" from the approved brands list instead of requesting a new brand.`;
}

export function formatApprovedCatalogBrandSuggestionMessage(typedName, matchedName) {
  const typed = String(typedName || '').trim() || 'This';
  const matched = String(matchedName || '').trim();
  if (!matched) return '';
  return `Suggestion: “${typed}” may refer to approved brand “${matched}”. You can keep typing, or select “${matched}” from the approved list.`;
}

/** Keep unique brand names. Same spelling (any case) is one brand; typos stay separate. */
export function dedupeBrandNames(names = []) {
  const deduped = [];
  const indexByKey = new Map();
  for (const name of names) {
    const key = brandKeyForDuplicateCheck(name);
    if (!key) continue;
    const existingIdx = indexByKey.get(key);
    if (existingIdx === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(name);
      continue;
    }
    const existing = deduped[existingIdx];
    if (String(name || '').trim().length < String(existing || '').trim().length) {
      deduped[existingIdx] = name;
    }
  }
  return deduped;
}

/** Dedupe brand catalog rows by spelling variant; keeps shortest display name. */
export function dedupeBrandCatalogRows(brands = []) {
  const deduped = [];
  const indexByKey = new Map();
  for (const brand of brands) {
    const name = String(brand?.name || '').trim();
    if (!name) continue;
    const key = brandKeyForDuplicateCheck(name);
    if (!key) continue;
    const existingIdx = indexByKey.get(key);
    if (existingIdx === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push({ ...brand, name });
      continue;
    }
    const existing = deduped[existingIdx];
    const nextName =
      name.length < String(existing.name || '').length ? name : String(existing.name || '').trim();
    deduped[existingIdx] = {
      ...existing,
      ...brand,
      name: nextName,
      normalizedName: String(brand?.normalizedName || existing?.normalizedName || nextName).trim(),
      hasAdminSupplyChain:
        existing?.hasAdminSupplyChain === true || brand?.hasAdminSupplyChain === true
    };
  }
  return deduped;
}

/**
 * @param {ChainEntry[]} entries
 * @returns {{ ok: true } | { ok: false, message: string, entryIndex: number, field: 'brands', duplicateEntryIndex: number }}
 */
export function validateUniqueBrandsAcrossEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { ok: true };
  }

  const brandToEntryIndex = new Map();

  for (let i = 0; i < entries.length; i += 1) {
    const brandList = parseBrandsListForValidation(entries[i]?.brands);
    if (brandList.length === 0) continue;

    for (const brandName of brandList) {
      const brandKey = brandKeyForDuplicateCheck(brandName);
      if (!brandKey) continue;

      // Exact complete-name match only (never prefix/substring).
      if (brandToEntryIndex.has(brandKey)) {
        const duplicateEntryIndex = brandToEntryIndex.get(brandKey);
        return {
          ok: false,
          message: `Entry ${i + 1}: "${brandName}" is already registered in Entry ${duplicateEntryIndex + 1}. Each brand can have only one supply-chain role.`,
          entryIndex: i,
          field: 'brands',
          duplicateEntryIndex
        };
      }
      brandToEntryIndex.set(brandKey, i);
    }
  }

  return { ok: true };
}

/**
 * Same shape as the supply-chain editor display (legacy row vs companyInfoEntries).
 * @param {Record<string, unknown>|null|undefined} profile
 * @returns {ChainEntry[]}
 */
/** Mirrors SupplierSupplyChainEntriesEditor display (always at least one row). */
export function resolveCompanyInfoEntriesForValidation(profile) {
  if (!profile) return [];
  const entries = profile.companyInfoEntries;
  if (Array.isArray(entries) && entries.length > 0) return entries;

  return [
    {
      id: 'legacy',
      role: profile.supplierRole || '',
      brands: profile.brands || '',
      gstin: profile.gstin || '',
      companyName: profile.companyName || '',
      ownershipDetails: profile.ownershipDetails || '',
      ...setBrandApprovalDocumentUrls({}, resolveBrandApprovalDocumentUrls(profile || {})),
      ...setAuthorizationCertificateUrls({}, resolveAuthorizationCertificateUrls(profile || {})),
      minimumOrderValue: profile.minimumOrderValue ?? ''
    }
  ];
}

/** True when supplier has started (or explicitly opened) Step 2 supply-chain registration. */
export function hasSupplyChainRegistrationData(entry = {}) {
  if (entry?.supplyChainRegistrationStarted === true) return true;
  const role = String(entry?.role || '').trim();
  const roleCertificateUrls = resolveAuthorizationCertificateUrls(entry);
  const brandDocumentUrls = resolveBrandApprovalDocumentUrls(entry);
  const brands = parseBrandsListForValidation(entry?.brands);
  const mov = entry?.minimumOrderValue;
  const hasMov = mov !== '' && mov !== null && mov !== undefined;
  return !!(
    brands.length > 0 ||
    role ||
    roleCertificateUrls.length > 0 ||
    brandDocumentUrls.length > 0 ||
    hasMov
  );
}

export function filterSupplyChainFormEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => hasSupplyChainRegistrationData(entry));
}

/** True when Step 2 supply-chain fields were started for this entry (not brand-only Step 1). */
export function entryRequiresSupplyChainCompletion(entry = {}) {
  if (entry?.supplyChainRegistrationStarted === true) return true;
  const role = String(entry?.role || '').trim();
  const roleCertificateUrls = resolveAuthorizationCertificateUrls(entry);
  const mov = entry?.minimumOrderValue;
  const hasMov = mov !== '' && mov !== null && mov !== undefined;
  return !!(role || roleCertificateUrls.length > 0 || hasMov);
}

/**
 * @param {ChainEntry[]} entries
 * @returns {{ ok: true } | { ok: false, message: string, entryIndex?: number, field?: string }}
 */
export function validateCompanyInfoEntriesList(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      ok: false,
      message: 'Add at least one supply-chain entry (brand is required).',
      entryIndex: 0,
      field: 'entry'
    };
  }

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i] || {};
    const entryNum = i + 1;
    const role = String(entry.role || '').trim();
    const brandList = parseBrandsListForValidation(entry.brands);
    const roleCertificateUrls = resolveAuthorizationCertificateUrls(entry);

    if (!entryRequiresSupplyChainCompletion(entry)) {
      if (brandList.length === 0) {
        continue;
      }
      if (brandList.length > 1) {
        return {
          ok: false,
          message: `Entry ${entryNum}: Only one brand is allowed per entry. Add another block for a second brand.`,
          entryIndex: i,
          field: 'brands'
        };
      }
      continue;
    }
    if (brandList.length === 0) {
      return {
        ok: false,
        message: `Entry ${entryNum}: Select a brand.`,
        entryIndex: i,
        field: 'brands'
      };
    }
    if (brandList.length > 1) {
      return {
        ok: false,
        message: `Entry ${entryNum}: Only one brand is allowed per entry. Add another block for a second brand.`,
        entryIndex: i,
        field: 'brands'
      };
    }
    if (roleCertificateUrls.length === 0) {
      return {
        ok: false,
        message: `Entry ${entryNum}: Upload at least one supply-chain role document.`,
        entryIndex: i,
        field: 'authorizationCertificateUrls'
      };
    }

    if (role && role !== 'retailer') {
      const movRaw = entry.minimumOrderValue;
      if (movRaw === '' || movRaw === null || movRaw === undefined) {
        return {
          ok: false,
          message: `Entry ${entryNum}: Minimum order value (₹) is required for this role.`,
          entryIndex: i,
          field: 'minimumOrderValue'
        };
      }
      const mov = parseFloat(String(movRaw));
      if (!Number.isFinite(mov) || mov < 0) {
        return {
          ok: false,
          message: `Entry ${entryNum}: Enter a valid minimum order value (₹).`,
          entryIndex: i,
          field: 'minimumOrderValue'
        };
      }
    }
  }

  const uniqueBrands = validateUniqueBrandsAcrossEntries(entries);
  if (!uniqueBrands.ok) {
    return uniqueBrands;
  }

  return { ok: true };
}

/**
 * @param {Record<string, unknown>|null|undefined} profile
 */
export function validateSupplierChainProfile(profile) {
  const entries = resolveCompanyInfoEntriesForValidation(profile);
  return validateCompanyInfoEntriesList(entries);
}
