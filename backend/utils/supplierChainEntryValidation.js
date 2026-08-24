import {
  resolveAuthorizationCertificateUrls,
  resolveBrandApprovalDocumentUrls,
  setAuthorizationCertificateUrls,
  setBrandApprovalDocumentUrls
} from './authorizationCertificateUrls.js';

function parseBrandsListForValidation(brands) {
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

/** Complete-name key only — "H" must not equal "HP". Spelling variants are distinct brands. */
function brandKeyForDuplicateCheck(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
          message: `Entry ${i + 1}: "${brandName}" is already registered in Entry ${duplicateEntryIndex + 1}. Each brand can have only one supply-chain role.`
        };
      }
      brandToEntryIndex.set(brandKey, i);
    }
  }

  return { ok: true };
}

/** Mirrors supplier Select yourself editor (always at least one row when profile exists). */
export function resolveCompanyInfoEntriesForValidation(profileData) {
  if (!profileData) return [];
  const entries = profileData.companyInfoEntries;
  if (Array.isArray(entries) && entries.length > 0) return entries;

  return [
    {
      id: 'legacy',
      role: profileData.supplierRole || '',
      brands: profileData.brands || '',
      gstin: profileData.gstin || '',
      companyName: profileData.companyName || '',
      ownershipDetails: profileData.ownershipDetails || '',
      ...setBrandApprovalDocumentUrls({}, resolveBrandApprovalDocumentUrls(profileData || {})),
      ...setAuthorizationCertificateUrls({}, resolveAuthorizationCertificateUrls(profileData || {})),
      minimumOrderValue: profileData.minimumOrderValue ?? ''
    }
  ];
}

export function entryRequiresSupplyChainCompletion(entry = {}) {
  if (entry?.supplyChainRegistrationStarted === true) return true;
  const role = String(entry?.role || '').trim();
  const roleCertificateUrls = resolveAuthorizationCertificateUrls(entry);
  const mov = entry?.minimumOrderValue;
  const hasMov = mov !== '' && mov !== null && mov !== undefined;
  return !!(role || roleCertificateUrls.length > 0 || hasMov);
}

export const SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE =
  'Please select your role and upload the required document before saving.';

export function validateCompanyInfoEntriesList(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      ok: false,
      message: 'Add at least one supply-chain entry (brand is required).'
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
          message: `Entry ${entryNum}: Only one brand is allowed per entry. Add another block for a second brand.`
        };
      }
      continue;
    }
    if (brandList.length === 0) {
      return { ok: false, message: `Entry ${entryNum}: Select a brand.` };
    }
    if (brandList.length > 1) {
      return {
        ok: false,
        message: `Entry ${entryNum}: Only one brand is allowed per entry. Add another block for a second brand.`
      };
    }
    if (!role || roleCertificateUrls.length === 0) {
      return {
        ok: false,
        message: SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE
      };
    }

    if (role && role !== 'retailer') {
      const movRaw = entry.minimumOrderValue;
      if (movRaw === '' || movRaw === null || movRaw === undefined) {
        return {
          ok: false,
          message: `Entry ${entryNum}: Minimum order value (₹) is required for this role.`
        };
      }
      const mov = parseFloat(String(movRaw));
      if (!Number.isFinite(mov) || mov < 0) {
        return {
          ok: false,
          message: `Entry ${entryNum}: Enter a valid minimum order value (₹).`
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

export function validateSupplierChainProfileData(profileData) {
  const entries = resolveCompanyInfoEntriesForValidation(profileData);
  return validateCompanyInfoEntriesList(entries);
}

/** Unique brand names configured on company-info entries (ignores legacy top-level brands). */
export function collectConfiguredBrandsFromEntries(chainOrEntries = {}) {
  const entries = Array.isArray(chainOrEntries)
    ? chainOrEntries
    : Array.isArray(chainOrEntries?.companyInfoEntries)
      ? chainOrEntries.companyInfoEntries
      : [];
  const brandStrings = [];
  for (const entry of entries) {
    const brandsStr = String(entry?.brands || '').trim();
    if (brandsStr) brandStrings.push(brandsStr);
  }
  return [
    ...new Set(
      brandStrings
        .flatMap((value) => parseBrandsListForValidation(value))
        .map((brand) => brand.trim())
        .filter(Boolean)
    )
  ];
}

/** True when an entry has started supply-chain registration (Select yourself). */
export function hasSupplyChainRegistrationData(entry = {}) {
  if (entry?.supplyChainRegistrationStarted === true) return true;
  const role = String(entry?.role || '').trim();
  const roleCertificateUrls = resolveAuthorizationCertificateUrls(entry);
  const brandDocumentUrls = resolveBrandApprovalDocumentUrls(entry);
  const mov = entry?.minimumOrderValue;
  const hasMov = mov !== '' && mov !== null && mov !== undefined;
  const brands = parseBrandsListForValidation(entry?.brands);
  return !!(
    brands.length > 0 ||
    role ||
    roleCertificateUrls.length > 0 ||
    brandDocumentUrls.length > 0 ||
    hasMov
  );
}

/**
 * True when the PUT body includes supply-chain / Select yourself fields.
 * General profile fields (gstin, companyName, ownershipDetails at top level) alone do not count —
 * those are edited on the Company Profile page without touching supply-chain setup.
 */
export function supplierProfileIncludesChainDraft(profileData) {
  if (!profileData) return false;
  if (profileData.saveAsDraft === true || profileData.saveBrandApprovalOnly === true) {
    return true;
  }

  if (Array.isArray(profileData.companyInfoEntries) && profileData.companyInfoEntries.length > 0) {
    return profileData.companyInfoEntries.some((entry) => hasSupplyChainRegistrationData(entry));
  }

  const authCertUrls = resolveAuthorizationCertificateUrls(profileData);
  const brandDocUrls = resolveBrandApprovalDocumentUrls(profileData);

  return !!(
    String(profileData.supplierRole || '').trim() ||
    parseBrandsListForValidation(profileData.brands).length > 0 ||
    authCertUrls.length > 0 ||
    brandDocUrls.length > 0 ||
    (profileData.minimumOrderValue !== '' &&
      profileData.minimumOrderValue !== null &&
      profileData.minimumOrderValue !== undefined)
  );
}

