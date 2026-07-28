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

function buildSupplierRejectedBrandKeys(supplierBrandRequests = []) {
  const keys = new Set();
  for (const item of Array.isArray(supplierBrandRequests) ? supplierBrandRequests : []) {
    const name = String(typeof item === 'string' ? item : item?.name || '').trim();
    const status =
      typeof item === 'object' ? String(item?.status || '').trim().toLowerCase() : '';
    if (!name || status !== 'rejected') continue;
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
        requestedAt: item?.requestedAt || item?.submittedAt || null,
        submittedAt: item?.submittedAt || item?.requestedAt || null,
        rejectionReason: String(item?.rejectionReason || '').trim()
      };
    }
  }
  return null;
}

/** Whether Step 2 (supply-chain role + docs) may proceed for this brand. */
export function isBrandApprovedForSupplyChainStep(
  brandName,
  supplierApprovedBrands = [],
  brandMeta = null,
  supplierBrandRequests = []
) {
  const brand = String(brandName || '').trim();
  if (!brand) return false;

  const brandKey = brandKeyForDuplicateCheck(brand);
  if (brandKey && buildSupplierRejectedBrandKeys(supplierBrandRequests).has(brandKey)) {
    return false;
  }

  const metaStatus = String(brandMeta?.status || '').trim().toLowerCase();
  if (metaStatus === 'approved') return true;
  if (metaStatus === 'pending' || metaStatus === 'rejected') return false;

  if (!brandKey) return false;
  return buildSupplierApprovedBrandKeys(supplierApprovedBrands).has(brandKey);
}

/**
 * Summary rows for "Your supply chain by brand": brands ready for Step 2 role setup.
 * Includes:
 * - catalog brands with an admin-defined supply chain
 * - brands this supplier has had approved
 * - approved catalog brands the supplier already selected in Step 1
 * Pending/rejected brand requests stay in Step 1 only.
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
    const supplierApproved = supplierApprovedBrandKeys.has(catalogKey);
    const selectedInStep1 = assignmentByKey.has(catalogKey);

    // Step 2: catalog-approved brands the supplier selected, supplier-approved brands,
    // or brands with an admin-defined supply chain.
    if (!catalogHasAdminSupplyChain && !supplierApproved && !selectedInStep1) continue;

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
