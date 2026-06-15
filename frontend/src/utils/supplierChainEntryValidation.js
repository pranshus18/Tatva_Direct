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

function collapseRepeatedLetters(value) {
  return String(value || '').replace(/(.)\1+/g, '$1');
}

/** Case-insensitive brand key for duplicate detection across entries. */
export function brandKeyForDuplicateCheck(raw) {
  const token = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return collapseRepeatedLetters(token);
}

/** Merge spelling variants (e.g. Philips / Phillips) into one display name. */
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
      normalizedName: String(brand?.normalizedName || existing?.normalizedName || nextName).trim()
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
  const gstin = String(entry?.gstin || '').trim();
  const companyName = String(entry?.companyName || '').trim();
  const ownershipDetails = String(entry?.ownershipDetails || '').trim();
  const roleCertificateUrls = resolveAuthorizationCertificateUrls(entry);
  const mov = entry?.minimumOrderValue;
  const hasMov = mov !== '' && mov !== null && mov !== undefined;
  return !!(
    role ||
    gstin ||
    companyName ||
    ownershipDetails ||
    roleCertificateUrls.length > 0 ||
    hasMov
  );
}

export function filterSupplyChainFormEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => hasSupplyChainRegistrationData(entry));
}

/** True when Step 2 supply-chain fields were started for this entry (not brand-only Step 1). */
export function entryRequiresSupplyChainCompletion(entry = {}) {
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
    if (!entryRequiresSupplyChainCompletion(entry)) {
      continue;
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
