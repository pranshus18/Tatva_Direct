import {
  resolveAuthorizationCertificateUrls,
  resolveBrandApprovalDocumentUrls
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

function collapseRepeatedLetters(value) {
  return String(value || '').replace(/(.)\1+/g, '$1');
}

function brandKeyForDuplicateCheck(raw) {
  const token = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return collapseRepeatedLetters(token);
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
      brandApprovalDocumentUrl: profileData.brandApprovalDocumentUrl || '',
      authorizationCertificateUrl: profileData.authorizationCertificateUrl || '',
      minimumOrderValue: profileData.minimumOrderValue ?? ''
    }
  ];
}

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

    if (brandList.length === 0) {
      return { ok: false, message: `Entry ${entryNum}: Select a brand.` };
    }
    if (brandList.length > 1) {
      return {
        ok: false,
        message: `Entry ${entryNum}: Only one brand is allowed per entry. Add another block for a second brand.`
      };
    }
    if (roleCertificateUrls.length === 0) {
      return {
        ok: false,
        message: `Entry ${entryNum}: Upload at least one supply-chain role document.`
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

/** True when an entry has started supply-chain registration (Select yourself). */
export function hasSupplyChainRegistrationData(entry = {}) {
  if (entry?.supplyChainRegistrationStarted === true) return true;
  const role = String(entry?.role || '').trim();
  const gstin = String(entry?.gstin || '').trim();
  const companyName = String(entry?.companyName || '').trim();
  const ownershipDetails = String(entry?.ownershipDetails || '').trim();
  const roleCertificateUrls = resolveAuthorizationCertificateUrls(entry);
  const brandDocumentUrls = resolveBrandApprovalDocumentUrls(entry);
  const mov = entry?.minimumOrderValue;
  const hasMov = mov !== '' && mov !== null && mov !== undefined;
  const brands = parseBrandsListForValidation(entry?.brands);
  return !!(
    brands.length > 0 ||
    role ||
    gstin ||
    companyName ||
    ownershipDetails ||
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

