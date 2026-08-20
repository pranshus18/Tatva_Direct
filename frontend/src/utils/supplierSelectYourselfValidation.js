import { resolveRoleVerificationDocumentUrls } from './authorizationCertificateUrls';
import {
  parseBrandsListForValidation,
  validateUniqueBrandsAcrossEntries
} from './supplierChainEntryValidation';
import { matchCompanyInfoEntry } from './supplierSelectYourselfProfile';

export const SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE =
  'Please select your role and upload the required document before saving.';

export const SELECT_YOURSELF_ROLE_REQUIRED_MESSAGE =
  'Select your supply-chain role before saving.';

export const SELECT_YOURSELF_DOCS_REQUIRED_MESSAGE =
  'Upload at least one role verification document before saving.';

export const SELECT_YOURSELF_MOV_REQUIRED_MESSAGE =
  'Enter a minimum order value (₹) for this role before saving.';

export const REQUEST_ROLE_CHANGE_LABEL = 'Request Role Change';
export const CHANGE_ROLE_LABEL = 'Change role';

/** True when supply-chain onboarding for this entry is complete and the role should stay locked. */
export function isEntrySupplyChainOnboardingComplete(
  entry,
  profile,
  savedBaselineEntries = []
) {
  if (!entry) return false;
  const status = String(profile?.chainProfileApprovalStatus || '').trim().toLowerCase();
  if (status === 'pending' || status === 'draft') return false;
  if (!entryMatchesSavedBaseline(entry, savedBaselineEntries)) return false;

  const role = String(entry?.role || '').trim();
  const roleDocs = resolveRoleVerificationDocumentUrls(entry);
  if (!role || roleDocs.length === 0) return false;

  return !!String(entry?.brands || '').trim();
}

/** Active admin-approved role for display / lock checks (pending profile changes use baseline). */
export function getActiveApprovedRoleForEntry(
  entry,
  profile,
  approvedBaselineEntries = [],
  savedBaselineEntries = []
) {
  const status = String(profile?.chainProfileApprovalStatus || '').trim().toLowerCase();
  if (status === 'pending') {
    const approvedEntry = findSavedBaselineEntry(entry, approvedBaselineEntries);
    return String(approvedEntry?.role || '').trim();
  }
  if (isEntrySupplyChainOnboardingComplete(entry, profile, savedBaselineEntries)) {
    return String(entry?.role || '').trim();
  }
  const approvedEntry = findSavedBaselineEntry(entry, approvedBaselineEntries);
  return String(approvedEntry?.role || '').trim();
}

export function entryMinimumOrderValueChanged(entry, savedBaselineEntries = []) {
  const savedEntry = findSavedBaselineEntry(entry, savedBaselineEntries);
  if (!savedEntry) return false;
  return String(entry?.minimumOrderValue ?? '') !== String(savedEntry?.minimumOrderValue ?? '');
}

/** True when Step 2 supply-chain fields were started (Select yourself only). */
function entryRequiresSupplyChainCompletion(entry = {}) {
  if (entry?.supplyChainRegistrationStarted === true) return true;
  const role = String(entry?.role || '').trim();
  const roleCertificateUrls = resolveRoleVerificationDocumentUrls(entry);
  const mov = entry?.minimumOrderValue;
  const hasMov = mov !== '' && mov !== null && mov !== undefined;
  return !!(role || roleCertificateUrls.length > 0 || hasMov);
}

/** Compare supply-chain fields for a single entry (Save entry dirty check). */
export function buildChainEntrySaveSignature(entry = {}) {
  const roleDocs = resolveRoleVerificationDocumentUrls(entry);
  return JSON.stringify({
    id: entry?.id || '',
    role: entry?.role || '',
    brands: entry?.brands || '',
    gstin: entry?.gstin || '',
    companyName: entry?.companyName || '',
    brandApprovalDocumentUrl: entry?.brandApprovalDocumentUrl || '',
    brandApprovalDocumentUrls: Array.isArray(entry?.brandApprovalDocumentUrls)
      ? [...entry.brandApprovalDocumentUrls].sort()
      : [],
    authorizationCertificateUrl: entry?.authorizationCertificateUrl || '',
    authorizationCertificateUrls: [...roleDocs].sort(),
    minimumOrderValue: entry?.minimumOrderValue ?? ''
  });
}

export function findSavedBaselineEntry(entry, savedBaselineEntries = []) {
  return (
    (Array.isArray(savedBaselineEntries) ? savedBaselineEntries : []).find((row) =>
      matchCompanyInfoEntry(row, {
        entryId: entry?.id,
        brand: entry?.brands
      })
    ) || null
  );
}

/** True when the entry matches the last saved profile snapshot for this row. */
export function entryMatchesSavedBaseline(entry, savedBaselineEntries = []) {
  const savedEntry = findSavedBaselineEntry(entry, savedBaselineEntries);
  if (!savedEntry) return false;
  return buildChainEntrySaveSignature(entry) === buildChainEntrySaveSignature(savedEntry);
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

/** Save button state for a single supply-chain entry card. */
export function getSelectYourselfEntrySaveState(
  entry = {},
  savedBaselineEntries = [],
  approvedBaselineEntries = [],
  activeApprovedRole = ''
) {
  const readiness = getSelectYourselfEntrySaveReadiness(entry);
  const hasChangesFromLastSave = !entryMatchesSavedBaseline(entry, savedBaselineEntries);
  const approvedEntry = findSavedBaselineEntry(entry, approvedBaselineEntries);
  const approvedRole =
    String(activeApprovedRole || '').trim() || String(approvedEntry?.role || '').trim();
  const currentRole = String(entry?.role || '').trim();
  const pendingApprovedRoleChange =
    !!approvedRole && !!currentRole && approvedRole !== currentRole;
  const alreadySaved = !hasChangesFromLastSave;
  const movOnlyChange =
    !pendingApprovedRoleChange &&
    entryMinimumOrderValueChanged(entry, savedBaselineEntries);
  // Enable Save whenever this entry differs from the last saved snapshot — including
  // approved-role changes that still need admin review. Field validation runs on click.
  const enabled = hasChangesFromLastSave;

  return {
    ...readiness,
    alreadySaved: alreadySaved && readiness.ok,
    enabled,
    pendingApprovedRoleChange
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
