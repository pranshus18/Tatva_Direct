import { resolveRoleVerificationDocumentUrls } from './authorizationCertificateUrls';
import {
  parseBrandsListForValidation,
  validateUniqueBrandsAcrossEntries
} from './supplierChainEntryValidation';

export const SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE =
  'Please select your role and upload the required document before saving.';

export const SELECT_YOURSELF_ROLE_REQUIRED_MESSAGE =
  'Select your supply-chain role before saving.';

export const SELECT_YOURSELF_DOCS_REQUIRED_MESSAGE =
  'Upload at least one role verification document before saving.';

export const SELECT_YOURSELF_MOV_REQUIRED_MESSAGE =
  'Enter a minimum order value (₹) for this role before saving.';

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
 * Whether a single Select yourself supply-chain entry is complete enough to enable Save.
 * Used for button disabled state and inline incomplete-field messaging.
 * @param {import('./supplierChainEntryValidation').ChainEntry} entry
 * @returns {{ ok: boolean, message: string, field: string, missing: string[] }}
 */
export function getSelectYourselfEntrySaveReadiness(entry = {}) {
  const role = String(entry?.role || '').trim();
  const brandList = parseBrandsListForValidation(entry?.brands);
  const roleCertificateUrls = resolveRoleVerificationDocumentUrls(entry);
  const missing = [];

  if (brandList.length === 0) {
    return {
      ok: false,
      message: 'Select a brand before saving.',
      field: 'brands',
      missing: ['brand']
    };
  }
  if (brandList.length > 1) {
    return {
      ok: false,
      message: 'Only one brand is allowed per entry.',
      field: 'brands',
      missing: ['brand']
    };
  }
  if (!role) {
    missing.push('role');
  }
  if (roleCertificateUrls.length === 0) {
    missing.push('documents');
  }

  if (role && role !== 'retailer') {
    const movRaw = entry?.minimumOrderValue;
    if (movRaw === '' || movRaw === null || movRaw === undefined) {
      missing.push('minimumOrderValue');
    } else {
      const mov = parseFloat(String(movRaw));
      if (!Number.isFinite(mov) || mov < 0) {
        return {
          ok: false,
          message: 'Enter a valid minimum order value (₹).',
          field: 'minimumOrderValue',
          missing: ['minimumOrderValue']
        };
      }
    }
  }

  if (missing.length === 0) {
    return { ok: true, message: '', field: '', missing: [] };
  }

  if (missing.includes('role') && missing.includes('documents')) {
    return {
      ok: false,
      message: SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE,
      field: 'role',
      missing
    };
  }
  if (missing.includes('role')) {
    return {
      ok: false,
      message: SELECT_YOURSELF_ROLE_REQUIRED_MESSAGE,
      field: 'role',
      missing
    };
  }
  if (missing.includes('documents')) {
    return {
      ok: false,
      message: SELECT_YOURSELF_DOCS_REQUIRED_MESSAGE,
      field: 'authorizationCertificateUrls',
      missing
    };
  }
  return {
    ok: false,
    message: SELECT_YOURSELF_MOV_REQUIRED_MESSAGE,
    field: 'minimumOrderValue',
    missing
  };
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
    const brandList = parseBrandsListForValidation(entry.brands);

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

    const readiness = getSelectYourselfEntrySaveReadiness(entry);
    if (!readiness.ok) {
      const prefixed =
        readiness.message.startsWith('Please ') ||
        readiness.message.startsWith('Select your') ||
        readiness.message.startsWith('Upload ')
          ? readiness.message
          : `Entry ${entryNum}: ${readiness.message}`;
      return {
        ok: false,
        message: prefixed,
        entryIndex: i,
        field: readiness.field
      };
    }
  }

  const uniqueBrands = validateUniqueBrandsAcrossEntries(entries);
  if (!uniqueBrands.ok) {
    return uniqueBrands;
  }

  return { ok: true };
}
