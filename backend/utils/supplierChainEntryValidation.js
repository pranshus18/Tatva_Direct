import { resolveAuthorizationCertificateUrls } from './authorizationCertificateUrls.js';

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
    const certificateUrls = resolveAuthorizationCertificateUrls(entry);

    if (brandList.length === 0) {
      return { ok: false, message: `Entry ${entryNum}: Select a brand.` };
    }
    if (brandList.length > 1) {
      return {
        ok: false,
        message: `Entry ${entryNum}: Only one brand is allowed per entry. Add another block for a second brand.`
      };
    }
    if (certificateUrls.length === 0) {
      return {
        ok: false,
        message: `Entry ${entryNum}: Upload at least one brand authorisation document.`
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

  return { ok: true };
}

export function validateSupplierChainProfileData(profileData) {
  const entries = resolveCompanyInfoEntriesForValidation(profileData);
  return validateCompanyInfoEntriesList(entries);
}

/** True when the PUT body includes supply-chain / Select yourself fields. */
export function supplierProfileIncludesChainDraft(profileData) {
  if (!profileData) return false;
  if (Array.isArray(profileData.companyInfoEntries) && profileData.companyInfoEntries.length > 0) {
    return true;
  }
  return !!(
    String(profileData.supplierRole || '').trim() ||
    String(profileData.brands || '').trim() ||
    String(profileData.gstin || '').trim() ||
    String(profileData.companyName || '').trim() ||
    String(profileData.ownershipDetails || '').trim() ||
    String(profileData.authorizationCertificateUrl || '').trim() ||
    (profileData.minimumOrderValue !== '' &&
      profileData.minimumOrderValue !== null &&
      profileData.minimumOrderValue !== undefined)
  );
}

