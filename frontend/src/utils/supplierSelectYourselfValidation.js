import { resolveRoleVerificationDocumentUrls } from './authorizationCertificateUrls';
import {
  parseBrandsListForValidation,
  validateUniqueBrandsAcrossEntries
} from './supplierChainEntryValidation';

export const SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE =
  'Please select your role and upload the required document before saving.';

/** True when Step 2 supply-chain fields were started (Select yourself only). */
function entryRequiresSupplyChainCompletion(entry = {}) {
  if (entry?.supplyChainRegistrationStarted === true) return true;
  const role = String(entry?.role || '').trim();
  const roleCertificateUrls = resolveRoleVerificationDocumentUrls(entry);
  const mov = entry?.minimumOrderValue;
  const hasMov = mov !== '' && mov !== null && mov !== undefined;
  return !!(role || roleCertificateUrls.length > 0 || hasMov);
}

/**
 * Validate supply-chain entries on the Select yourself page.
 * Role documents exclude Step 1 brand-approval uploads.
 * @param {import('./supplierChainEntryValidation').ChainEntry[]} entries
 */
export function validateSelectYourselfChainEntries(entries) {
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
    const roleCertificateUrls = resolveRoleVerificationDocumentUrls(entry);

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
    if (!role || roleCertificateUrls.length === 0) {
      return {
        ok: false,
        message: SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE,
        entryIndex: i,
        field: !role ? 'role' : 'authorizationCertificateUrls'
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
