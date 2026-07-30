import {
  resolveAuthorizationCertificateUrls,
  resolveBrandApprovalDocumentUrls,
  resolveRoleVerificationDocumentUrls,
  setAuthorizationCertificateUrls,
  setBrandApprovalDocumentUrls,
  stripBrandDocumentsFromRoleFields,
  normalizeEntryDocumentFields
} from './authorizationCertificateUrls';
import { brandKeyForDuplicateCheck } from './supplierChainEntryValidation';
import {
  resolveSupplierBrandSetupLayers,
  supplierHasBrandAccess
} from './supplierBrandLayerContract';

export const BRAND_REQUIRED_BEFORE_SAVE_MESSAGE = 'Select at least one brand before saving.';

export const SUPPLY_CHAIN_ROLE_LABELS = {
  manufacturer: 'Manufacturer (MGF)',
  stockist: 'Stockist',
  regional_distributor: 'Regional Distributor',
  local_distributor: 'Local Distributor',
  dealer: 'Dealer',
  retailer: 'Retailer'
};

export function formatSupplyChainRoleLabel(role) {
  const key = String(role || '').trim();
  if (!key) return 'Not set';
  return SUPPLY_CHAIN_ROLE_LABELS[key] || key;
}

function matchBaselineEntry(baselineEntries, entry) {
  const id = String(entry?.id || '').trim();
  if (id) {
    const byId = (baselineEntries || []).find((row) => String(row?.id || '').trim() === id);
    if (byId) return byId;
  }
  const brandKey = brandKeyForDuplicateCheck(entry?.brands);
  if (!brandKey) return null;
  return (
    (baselineEntries || []).find(
      (row) => brandKeyForDuplicateCheck(row?.brands) === brandKey
    ) || null
  );
}

/** Last admin-approved supply-chain rows (not pending edits). */
export function getApprovedBaselineEntries(profile) {
  const approved = profile?.approvedChainProfile?.companyInfoEntries;
  if (Array.isArray(approved) && approved.length > 0) {
    return approved.map((entry) => ({ ...(entry || {}) }));
  }
  if (profile?.chainProfileApprovalStatus === 'pending') {
    return [];
  }
  return getCompanyInfoEntriesForSave(profile);
}

export function getApprovedRoleForEntry(baselineEntries, entry) {
  const baselineEntry = matchBaselineEntry(baselineEntries, entry);
  return String(baselineEntry?.role || '').trim();
}

export function detectEntryRoleChanges(baselineProfile, nextProfile) {
  const baselineEntries = getApprovedBaselineEntries(baselineProfile || {});
  const nextEntries = getCompanyInfoEntriesForSave(nextProfile || {});
  const changes = [];

  for (const entry of nextEntries) {
    const nextRole = String(entry?.role || '').trim();
    if (!nextRole) continue;
    const baselineEntry = matchBaselineEntry(baselineEntries, entry);
    const previousRole = String(baselineEntry?.role || '').trim();
    if (previousRole && previousRole !== nextRole) {
      changes.push({
        entryId: entry?.id || null,
        brand: String(entry?.brands || '').trim(),
        fromRole: previousRole,
        toRole: nextRole,
        fromRoleLabel: formatSupplyChainRoleLabel(previousRole),
        toRoleLabel: formatSupplyChainRoleLabel(nextRole)
      });
    }
  }

  return changes;
}

/** Guarantee every supply-chain row has a stable unique id (duplicate ids break per-entry edits). */
export function ensureCompanyInfoEntryIds(entries = []) {
  const seenIds = new Set();
  return (Array.isArray(entries) ? entries : []).map((rawEntry, index) => {
    const entry = { ...(rawEntry || {}) };
    let id = String(entry.id || '').trim();
    if (!id || seenIds.has(id)) {
      id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `entry-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
    }
    seenIds.add(id);
    return { ...entry, id };
  });
}

export function matchCompanyInfoEntry(entry, { entryId, brand } = {}) {
  const id = String(entryId || '').trim();
  const brandKey = brandKeyForDuplicateCheck(brand);
  const entryBrandKey = brandKeyForDuplicateCheck(entry?.brands);
  if (id && String(entry?.id || '').trim() === id) {
    if (!brandKey || !entryBrandKey || brandKey === entryBrandKey) return true;
    return false;
  }
  if (brandKey && entryBrandKey && brandKey === entryBrandKey) return true;
  return false;
}

export function normalizeProfileForEditor(profileData) {
  return normalizeProfileForEditorSnapshot(profileData);
}

export function buildApprovedBaselineSnapshot(profileData) {
  if (!profileData) return null;
  const snapshot = normalizeProfileForEditorSnapshot(profileData);
  const approvedEntries = profileData?.approvedChainProfile?.companyInfoEntries;
  if (!Array.isArray(approvedEntries) || approvedEntries.length === 0) {
    return snapshot;
  }
  return {
    ...snapshot,
    supplierRole: profileData.approvedChainProfile.supplierRole || snapshot.supplierRole,
    brands: profileData.approvedChainProfile.brands || snapshot.brands,
    companyInfoEntries: deduplicateCompanyInfoEntriesByBrand(
      mergeCompanyInfoEntriesById(approvedEntries)
    ),
    approvedChainProfile: profileData.approvedChainProfile
  };
}

function normalizeProfileForEditorSnapshot(profileData) {
  if (!profileData) return null;
  const snapshot = JSON.parse(JSON.stringify(profileData));
  // Approved rows fill gaps; current/draft entries must win so pending role edits are not wiped.
  const mergedEntries = deduplicateCompanyInfoEntriesByBrand(
    mergeCompanyInfoEntriesById(
      snapshot.approvedChainProfile?.companyInfoEntries || [],
      snapshot.companyInfoEntries || []
    )
  );
  snapshot.companyInfoEntries = ensureCompanyInfoEntryIds(
    ensureAtLeastOneCompanyInfoEntry({
      ...snapshot,
      companyInfoEntries: mergedEntries
    })
  ).map(normalizeEntryDocumentFields);
  return snapshot;
}

export const BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE =
  'This brand has not yet been approved by the admin. Please wait until the approval is complete before proceeding.';

export const SUPPLY_CHAIN_NOT_DEFINED_MESSAGE =
  'No supply-chain roles are currently configured for this brand. Please contact Admin or wait until a role is configured.';

function buildSupplierApprovedBrandKeys(supplierApprovedBrands = []) {
  const keys = new Set();
  for (const item of Array.isArray(supplierApprovedBrands) ? supplierApprovedBrands : []) {
    const name = String(typeof item === 'string' ? item : item?.name || '').trim();
    const status =
      typeof item === 'object' ? String(item?.status || 'approved').trim().toLowerCase() : 'approved';
    if (!name || (status && status !== 'approved')) continue;
    const key = brandKeyForDuplicateCheck(name);
    if (key) keys.add(key);
  }
  return keys;
}

function isDuplicateOfApprovedRejection(reason = '') {
  return /duplicate of approved brand/i.test(String(reason || ''));
}

function buildSupplierRejectedBrandKeys(supplierBrandRequests = []) {
  const keys = new Set();
  for (const item of Array.isArray(supplierBrandRequests) ? supplierBrandRequests : []) {
    const name = String(typeof item === 'string' ? item : item?.name || '').trim();
    const status =
      typeof item === 'object' ? String(item?.status || '').trim().toLowerCase() : '';
    if (!name || status !== 'rejected') continue;
    // Duplicate-merge rejections must not block the canonical approved brand in Step 2.
    if (typeof item === 'object' && isDuplicateOfApprovedRejection(item?.rejectionReason)) continue;
    const key = brandKeyForDuplicateCheck(name);
    if (key) keys.add(key);
  }
  return keys;
}

/** Find this supplier's brand-approval request row for a brand name (any status). */
export function findSupplierBrandRequest(brandName, supplierBrandRequests = []) {
  const brandKey = brandKeyForDuplicateCheck(brandName);
  if (!brandKey) return null;
  for (const item of Array.isArray(supplierBrandRequests) ? supplierBrandRequests : []) {
    if (typeof item === 'string') {
      if (brandKeyForDuplicateCheck(item) === brandKey) {
        return { name: item, status: 'pending', requestedAt: null, submittedAt: null, rejectionReason: '' };
      }
      continue;
    }
    const name = String(item?.name || item?.normalizedName || '').trim();
    const itemKey = brandKeyForDuplicateCheck(item?.normalizedName || name);
    if (itemKey === brandKey) {
      return {
        name: name || brandName,
        status: String(item?.status || 'pending').trim().toLowerCase() || 'pending',
        requestedAt: item?.requestedAt || item?.submittedAt || item?.createdAt || null,
        submittedAt: item?.submittedAt || item?.requestedAt || item?.createdAt || null,
        createdAt: item?.createdAt || null,
        rejectionReason: String(item?.rejectionReason || '').trim()
      };
    }
  }
  return null;
}

/**
 * Merge pending/approved brand-request rows into profile.supplierBrandRequests so Brand status
 * updates immediately after Save brand (even if the API profile omits a just-created request).
 */
export function mergeSupplierBrandRequestsIntoProfile(profile, requestRows = []) {
  if (!profile || typeof profile !== 'object') return profile;
  const incoming = (Array.isArray(requestRows) ? requestRows : [])
    .map((row) => {
      if (typeof row === 'string') {
        const name = String(row || '').trim();
        return name
          ? {
              name,
              normalizedName: brandKeyForDuplicateCheck(name),
              status: 'pending',
              requestedAt: null,
              submittedAt: null,
              rejectionReason: ''
            }
          : null;
      }
      const name = String(row?.name || row?.normalizedName || '').trim();
      if (!name) return null;
      const status = String(row?.status || 'pending').trim().toLowerCase() || 'pending';
      const submittedAt = row?.submittedAt || row?.requestedAt || row?.createdAt || null;
      return {
        name,
        normalizedName: row?.normalizedName || brandKeyForDuplicateCheck(name),
        status,
        requestedAt: row?.requestedAt || submittedAt,
        submittedAt,
        createdAt: row?.createdAt || null,
        rejectionReason: String(row?.rejectionReason || '').trim()
      };
    })
    .filter(Boolean);

  if (incoming.length === 0) return profile;

  const byKey = new Map();
  for (const item of Array.isArray(profile.supplierBrandRequests) ? profile.supplierBrandRequests : []) {
    const name = typeof item === 'string' ? item : item?.name || item?.normalizedName;
    const key = brandKeyForDuplicateCheck(typeof item === 'object' ? item?.normalizedName || name : name);
    if (!key) continue;
    byKey.set(key, typeof item === 'string' ? { name: item, status: 'pending' } : { ...item, name: String(name || '').trim() });
  }

  for (const row of incoming) {
    const key = brandKeyForDuplicateCheck(row.normalizedName || row.name);
    if (!key) continue;
    const existing = byKey.get(key) || {};
    const existingStatus = String(existing.status || '').toLowerCase();
    const incomingStatus = String(row.status || 'pending').toLowerCase() || 'pending';
    // Never downgrade an approved catalog/request row to pending from a stale merge.
    if (existingStatus === 'approved' && incomingStatus === 'pending') {
      continue;
    }
    byKey.set(key, {
      ...existing,
      ...row,
      name: row.name || existing.name,
      status: incomingStatus || existingStatus || 'pending',
      submittedAt:
        row.submittedAt ||
        existing.submittedAt ||
        existing.requestedAt ||
        row.requestedAt ||
        existing.createdAt ||
        row.createdAt ||
        null,
      requestedAt:
        row.requestedAt ||
        existing.requestedAt ||
        row.submittedAt ||
        existing.submittedAt ||
        existing.createdAt ||
        row.createdAt ||
        null,
      createdAt: row.createdAt || existing.createdAt || null
    });
  }

  return {
    ...profile,
    supplierBrandRequests: [...byKey.values()].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    )
  };
}

function isLiteralApprovedCatalogBrand(brandName, catalogBrands = []) {
  const brand = String(brandName || '').trim();
  if (!brand) return false;
  const brandKey = brandKeyForDuplicateCheck(brand);
  return (Array.isArray(catalogBrands) ? catalogBrands : []).some((item) => {
    const name = typeof item === 'string' ? item : item?.name;
    const status =
      typeof item === 'object' ? String(item?.status || 'approved').toLowerCase() : 'approved';
    if (status && status !== 'approved') return false;
    return brandKeyForDuplicateCheck(name) === brandKey;
  });
}

/** Stable snapshot of brand-approval fields (name + docs) for Save brand enablement. */
export function buildBrandApprovalDetailsSignature(profile, catalogBrands = []) {
  const rows = getCompanyInfoEntriesForSave(profile || {})
    .map((entry) => {
      const brand = String(entry?.brands || '').trim();
      if (!brand) return null;
      const docs = resolveBrandApprovalDocumentUrls(entry || {})
        .map((url) => String(url || '').trim())
        .filter(Boolean)
        .sort();
      return {
        brand: brandKeyForDuplicateCheck(brand),
        catalog: isLiteralApprovedCatalogBrand(brand, catalogBrands),
        docs
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(a.brand).localeCompare(String(b.brand)));
  return JSON.stringify(rows);
}

/**
 * True when Save brand should stay disabled: every custom brand is already pending
 * and brand details have not changed since the last successful submit.
 * Rejected brands and detail edits re-enable save; approved catalog picks stay savable.
 */
export function isBrandApprovalSaveBlockedForPendingRequests({
  profile,
  catalogBrands = [],
  submittedSignature = '',
  extraPendingBrandNames = []
} = {}) {
  const entries = getCompanyInfoEntriesForSave(profile || {}).filter((entry) =>
    String(entry?.brands || '').trim()
  );
  if (entries.length === 0) return false;

  const requests = profile?.supplierBrandRequests || [];
  const extraPendingKeys = new Set(
    (Array.isArray(extraPendingBrandNames) ? extraPendingBrandNames : [])
      .map((name) => brandKeyForDuplicateCheck(name))
      .filter(Boolean)
  );
  let hasPendingCustom = false;

  for (const entry of entries) {
    const brand = String(entry?.brands || '').trim();
    const brandKey = brandKeyForDuplicateCheck(brand);
    if (isLiteralApprovedCatalogBrand(brand, catalogBrands)) {
      // Selecting/saving an approved catalog brand remains allowed.
      return false;
    }
    const request = findSupplierBrandRequest(brand, requests);
    const status = String(request?.status || '').toLowerCase();
    if (status === 'rejected') {
      return false;
    }
    const isPending = status === 'pending' || (brandKey && extraPendingKeys.has(brandKey));
    if (isPending) {
      hasPendingCustom = true;
      continue;
    }
    if (!request) {
      return false;
    }
    // Approved custom request — no brand-approval save needed for this row.
  }

  if (!hasPendingCustom) return false;

  const currentSignature = buildBrandApprovalDetailsSignature(profile, catalogBrands);
  if (!submittedSignature) return true;
  return currentSignature === submittedSignature;
}

/**
 * Layer 2 — supplier access for Step 2 role setup.
 * Uses catalog + approved lists; does not conflate with Layer 3 role options.
 */
export function isBrandApprovedForSupplyChainStep(
  brandName,
  supplierApprovedBrands = [],
  brandMeta = null,
  supplierBrandRequests = [],
  catalogBrands = []
) {
  return supplierHasBrandAccess({
    brandName,
    catalogBrands,
    supplierApprovedBrands,
    supplierBrandRequests,
    brandMeta
  });
}

/**
 * Layer 1+2 summary for Path A "Approved brands" picker.
 * Includes every admin-approved catalog brand (same Layer 1 source as Admin approvals),
 * plus supplier-approved brands missing from the catalog payload.
 * Pending/rejected Path B requests stay out (except duplicate-of-approved noise).
 * Role readiness is exposed via hasAdminSupplyChain — not used to hide brands.
 */
export function buildSupplyChainSummaryRows(
  catalogBrands = [],
  entries = [],
  baselineEntries = [],
  supplierApprovedBrands = [],
  supplierBrandRequests = []
) {
  // Baseline first, current entries last — draft role selections must not be overwritten by empty approved roles.
  const mergedEntries = deduplicateCompanyInfoEntriesByBrand(
    mergeCompanyInfoEntriesById(baselineEntries, entries)
  );
  const assignments = getSupplyChainAssignmentRows(mergedEntries);
  const assignmentByKey = new Map();
  for (const row of assignments) {
    assignmentByKey.set(brandKeyForDuplicateCheck(row.brand), row);
  }

  const supplierApprovedBrandKeys = buildSupplierApprovedBrandKeys(supplierApprovedBrands);
  const supplierRejectedBrandKeys = buildSupplierRejectedBrandKeys(supplierBrandRequests);

  const rows = [];
  const seenKeys = new Set();

  const pushRow = (row) => {
    const key = brandKeyForDuplicateCheck(row?.brand);
    if (!key || seenKeys.has(key) || supplierRejectedBrandKeys.has(key)) return;
    seenKeys.add(key);
    rows.push(row);
  };

  for (const item of Array.isArray(catalogBrands) ? catalogBrands : []) {
    const brand = String(typeof item === 'string' ? item : item?.name || '').trim();
    if (!brand) continue;
    const status =
      typeof item === 'object' ? String(item?.status || 'approved').trim().toLowerCase() : 'approved';
    if (status && status !== 'approved') continue;

    const catalogKey = brandKeyForDuplicateCheck(brand);
    if (!catalogKey) continue;

    const catalogHasAdminSupplyChain =
      typeof item === 'object' && item?.hasAdminSupplyChain === true;

    const assignment = assignmentByKey.get(catalogKey);
    if (assignment) {
      pushRow({
        ...assignment,
        hasAdminSupplyChain: assignment.hasAdminSupplyChain === true || catalogHasAdminSupplyChain
      });
      continue;
    }

    pushRow({
      id: `catalog-${catalogKey}`,
      brand,
      role: '',
      roleLabel: 'Not set',
      hasRole: false,
      hasRoleDocuments: false,
      registrationStarted: false,
      hasAdminSupplyChain: catalogHasAdminSupplyChain
    });
  }

  // Include supplier-approved / selected brands that are missing from the catalog payload.
  for (const assignment of assignments) {
    const key = brandKeyForDuplicateCheck(assignment.brand);
    if (!key || seenKeys.has(key) || supplierRejectedBrandKeys.has(key)) continue;
    const supplierApproved = supplierApprovedBrandKeys.has(key);
    if (!supplierApproved) continue;
    pushRow({
      ...assignment,
      hasAdminSupplyChain: assignment.hasAdminSupplyChain === true
    });
  }

  return rows.sort((a, b) => a.brand.localeCompare(b.brand, 'en', { sensitivity: 'base' }));
}

/** @param {import('./supplierChainEntryValidation').ChainEntry[]} entries */
export function getSupplyChainAssignmentRows(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => {
      const brand = String(entry?.brands || '').trim();
      if (!brand) return null;
      const role = String(entry?.role || '').trim();
      const roleDocs = resolveRoleVerificationDocumentUrls(entry);
      return {
        id: entry?.id || `entry-${index}`,
        brand,
        role,
        roleLabel: formatSupplyChainRoleLabel(role),
        hasRole: !!role,
        hasRoleDocuments: roleDocs.length > 0,
        registrationStarted: entry?.supplyChainRegistrationStarted === true || !!role || roleDocs.length > 0
      };
    })
    .filter(Boolean);
}

/** Union entries by id so loading profile never drops earlier brand rows. */
export function mergeCompanyInfoEntriesById(...entryLists) {
  const merged = [];
  const indexById = new Map();

  const upsert = (rawEntry) => {
    if (!rawEntry || typeof rawEntry !== 'object') return;
    const entry = { ...rawEntry };
    const id = String(entry.id || '').trim();
    if (id && indexById.has(id)) {
      const idx = indexById.get(id);
      merged[idx] = { ...merged[idx], ...entry };
      return;
    }
    const idx = merged.length;
    if (!entry.id) {
      entry.id =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `entry-${Date.now()}-${idx}`;
    }
    merged.push(entry);
    indexById.set(entry.id, idx);
  };

  for (const list of entryLists) {
    for (const entry of Array.isArray(list) ? list : []) {
      upsert(entry);
    }
  }

  return merged;
}

/** Merge profile rows that refer to the same brand (e.g. Philips vs Phillips). */
export function deduplicateCompanyInfoEntriesByBrand(entries = []) {
  const merged = [];
  const indexByBrandKey = new Map();

  const pickBrandLabel = (left, right) => {
    const a = String(left || '').trim();
    const b = String(right || '').trim();
    if (!a) return b;
    if (!b) return a;
    return a.length <= b.length ? a : b;
  };

  for (const rawEntry of Array.isArray(entries) ? entries : []) {
    if (!rawEntry || typeof rawEntry !== 'object') continue;
    const brand = String(rawEntry?.brands || '').trim();
    if (!brand) {
      merged.push({ ...rawEntry });
      continue;
    }

    const brandKey = brandKeyForDuplicateCheck(brand);
    if (indexByBrandKey.has(brandKey)) {
      const idx = indexByBrandKey.get(brandKey);
      const existing = merged[idx] || {};
      merged[idx] = normalizeEntryDocumentFields({
        ...existing,
        ...rawEntry,
        id: existing.id || rawEntry.id,
        brands: pickBrandLabel(existing.brands, rawEntry.brands),
        role: String(rawEntry?.role || '').trim() || String(existing?.role || '').trim(),
        brandApprovalDocumentUrls: [
          ...new Set([
            ...(Array.isArray(existing.brandApprovalDocumentUrls) ? existing.brandApprovalDocumentUrls : []),
            ...(Array.isArray(rawEntry.brandApprovalDocumentUrls) ? rawEntry.brandApprovalDocumentUrls : [])
          ])
        ],
        authorizationCertificateUrls: [
          ...new Set([
            ...(Array.isArray(existing.authorizationCertificateUrls) ? existing.authorizationCertificateUrls : []),
            ...(Array.isArray(rawEntry.authorizationCertificateUrls) ? rawEntry.authorizationCertificateUrls : [])
          ])
        ]
      });
      continue;
    }

    const idx = merged.length;
    merged.push(normalizeEntryDocumentFields({ ...rawEntry }));
    indexByBrandKey.set(brandKey, idx);
  }

  return merged;
}

/** All persisted companyInfoEntries — never collapse to a single legacy row when multiples exist. */
export function getCompanyInfoEntriesForSave(profile) {
  const entries = profile?.companyInfoEntries;
  if (Array.isArray(entries) && entries.length > 0) {
    return entries.map((entry) => ({ ...(entry || {}) }));
  }

  const hasLegacy =
    String(profile?.supplierRole || '').trim() ||
    String(profile?.brands || '').trim() ||
    String(profile?.gstin || '').trim() ||
    String(profile?.companyName || '').trim() ||
    String(profile?.ownershipDetails || '').trim() ||
    resolveAuthorizationCertificateUrls(profile || {}).length > 0 ||
    resolveBrandApprovalDocumentUrls(profile || {}).length > 0;

  if (!hasLegacy) return [];

  return [
    {
      id: 'legacy',
      role: profile?.supplierRole || '',
      brands: profile?.brands || '',
      gstin: profile?.gstin || '',
      companyName: profile?.companyName || '',
      ownershipDetails: profile?.ownershipDetails || '',
      ...setBrandApprovalDocumentUrls({}, resolveBrandApprovalDocumentUrls(profile || {})),
      ...setAuthorizationCertificateUrls({}, resolveAuthorizationCertificateUrls(profile || {})),
      minimumOrderValue: profile?.minimumOrderValue ?? ''
    }
  ];
}

/** True when at least one company-info entry has a non-empty brand. */
export function profileHasConfiguredBrand(profileOrEntries) {
  const entries = Array.isArray(profileOrEntries)
    ? profileOrEntries
    : getCompanyInfoEntriesForSave(profileOrEntries || {});
  return entries.some((entry) => String(entry?.brands || '').trim());
}

export function ensureAtLeastOneCompanyInfoEntry(profile) {
  const entries = getCompanyInfoEntriesForSave(profile);
  if (entries.length > 0) return entries;
  return [
    {
      id:
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `entry-${Date.now()}`,
      role: '',
      brands: '',
      gstin: '',
      companyName: '',
      ownershipDetails: '',
      brandApprovalDocumentUrls: [],
      brandApprovalDocumentUrl: '',
      authorizationCertificateUrls: [],
      authorizationCertificateUrl: '',
      minimumOrderValue: ''
    }
  ];
}

export function getEntriesWithBrands(entries = []) {
  return (Array.isArray(entries) ? entries : []).filter((entry) =>
    String(entry?.brands || '').trim()
  );
}

/** When a brand is picked in Step 1, mark the entry ready for Step 2 supply-chain forms. */
export function syncBrandEntriesForSupplyChainStep(entries = []) {
  return entries.map((entry) => {
    const brand = String(entry?.brands || '').trim();
    if (!brand) return { ...entry };
    return { ...entry, supplyChainRegistrationStarted: true };
  });
}

export function buildSupplyChainFormProfile(profile, baselineEntries = []) {
  if (!profile) return null;
  // Merge approved baseline first, then current profile so Step 2 draft edits (role, docs, MOV)
  // win over empty/stale approved fields. Reversing this caused the role dropdown to reset to
  // "Select your role" immediately after picking a value.
  const brandedEntries = getEntriesWithBrands(
    deduplicateCompanyInfoEntriesByBrand(
      mergeCompanyInfoEntriesById(baselineEntries, getCompanyInfoEntriesForSave(profile))
    )
  ).map(normalizeEntryDocumentFields);
  return {
    ...profile,
    companyInfoEntries: brandedEntries
  };
}

/**
 * Merge Step 2 form edits back into the full profile without dropping other brand entries.
 */
export function mergeFormStepProfile(fullProfile, formProfile) {
  const formEntries = ensureCompanyInfoEntryIds(
    Array.isArray(formProfile?.companyInfoEntries) ? formProfile.companyInfoEntries : []
  );
  const formById = new Map();
  const formByBrandKey = new Map();
  for (const entry of formEntries) {
    const id = String(entry?.id || '').trim();
    if (id) formById.set(id, entry);
    const brandKey = brandKeyForDuplicateCheck(entry?.brands);
    if (brandKey) formByBrandKey.set(brandKey, entry);
  }

  const merged = [];
  const matchedFormIds = new Set();
  const matchedBrandKeys = new Set();

  for (const entry of fullProfile?.companyInfoEntries || []) {
    const id = String(entry?.id || '').trim();
    const brandKey = brandKeyForDuplicateCheck(entry?.brands);
    let formEntry = (id && formById.get(id)) || (brandKey && formByBrandKey.get(brandKey)) || null;
    if (!formEntry) {
      merged.push({ ...(entry || {}) });
      continue;
    }
    const formId = String(formEntry?.id || '').trim();
    if (formId) matchedFormIds.add(formId);
    if (brandKey) matchedBrandKeys.add(brandKey);
    merged.push(normalizeEntryDocumentFields({
      ...(entry || {}),
      ...formEntry,
      id: id || formId
    }));
  }

  for (const entry of formEntries) {
    const id = String(entry?.id || '').trim();
    const brandKey = brandKeyForDuplicateCheck(entry?.brands);
    const alreadyMerged =
      (id && matchedFormIds.has(id)) || (brandKey && matchedBrandKeys.has(brandKey));
    if (!alreadyMerged) {
      merged.push(normalizeEntryDocumentFields({ ...(entry || {}) }));
    }
  }

  return {
    ...fullProfile,
    companyInfoEntries: ensureCompanyInfoEntryIds(merged)
  };
}

/** Build PUT payload that keeps every brand entry while syncing legacy top-level fields. */
export function buildSupplierChainSavePayload(profile, entries = null, options = {}) {
  const nextEntries = deduplicateCompanyInfoEntriesByBrand(
    entries || getCompanyInfoEntriesForSave(profile)
  ).map(normalizeEntryDocumentFields);
  const first = nextEntries[0] || {};
  const chainFields = {
    companyInfoEntries: nextEntries,
    supplierRole: first.role || profile?.supplierRole || '',
    brands: first.brands || profile?.brands || '',
    gstin: first.gstin || profile?.gstin || '',
    companyName: first.companyName || profile?.companyName || '',
    minimumOrderValue: first.minimumOrderValue ?? profile?.minimumOrderValue ?? ''
  };

  if (options.forApi) {
    const payload = {
      userType: profile?.userType || 'supplier',
      companyInfoEntries: nextEntries,
      supplierRole: first.role || profile?.supplierRole || '',
      brands: first.brands || profile?.brands || ''
    };
    const gstin = String(first.gstin || '').trim();
    const companyName = String(first.companyName || '').trim();
    const mov = first.minimumOrderValue;
    if (gstin) payload.gstin = gstin;
    if (companyName) payload.companyName = companyName;
    if (mov !== '' && mov !== null && mov !== undefined) payload.minimumOrderValue = mov;
    if (options.saveAsDraft) payload.saveAsDraft = true;
    if (options.saveBrandApprovalOnly) payload.saveBrandApprovalOnly = true;
    if (options.saveSupplyChainEntryId) payload.saveSupplyChainEntryId = options.saveSupplyChainEntryId;
    return payload;
  }

  return {
    ...profile,
    ...chainFields
  };
}
