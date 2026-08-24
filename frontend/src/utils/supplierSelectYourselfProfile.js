import {
  resolveAuthorizationCertificateUrls,
  resolveBrandApprovalDocumentUrls,
  resolveRoleVerificationDocumentUrls,
  setAuthorizationCertificateUrls,
  setBrandApprovalDocumentUrls,
  stripBrandDocumentsFromRoleFields,
  normalizeEntryDocumentFields
} from './authorizationCertificateUrls';

/** Skip background profile reloads while local role/document drafts are in progress. */
export function shouldBlockProfileSnapshotRefresh({
  hasUnsavedChanges = false,
  blockUntilMs = 0,
  now = Date.now()
} = {}) {
  return !!hasUnsavedChanges || Number(blockUntilMs) > now;
}

/** Semantic snapshot for Select yourself dirty-state (ignores unstable entry ids). */
export function buildSelectYourselfChainFormSignature(profile) {
  if (!profile) return '';
  const rows = getCompanyInfoEntriesForSave(profile)
    .map(normalizeEntryDocumentFields)
    .map((entry) => {
      const brand = String(entry?.brands || '').trim();
      const roleDocs = resolveRoleVerificationDocumentUrls(entry);
      const brandDocs = resolveBrandApprovalDocumentUrls(entry);
      const brandKey = brandKeyForDuplicateCheck(brand);
      const mov = entry?.minimumOrderValue;
      return {
        key: brandKey || String(entry?.id || '').trim(),
        role: String(entry?.role || '').trim(),
        brands: brand,
        gstin: String(entry?.gstin || '').trim(),
        companyName: String(entry?.companyName || '').trim(),
        brandApprovalDocumentUrls: [...brandDocs].sort(),
        authorizationCertificateUrls: [...roleDocs].sort(),
        minimumOrderValue: mov === null || mov === undefined ? '' : mov
      };
    })
    .filter(
      (row) =>
        row.brands ||
        row.role ||
        row.gstin ||
        row.companyName ||
        row.brandApprovalDocumentUrls.length > 0 ||
        row.authorizationCertificateUrls.length > 0 ||
        row.minimumOrderValue !== ''
    )
    .sort((a, b) => String(a.key).localeCompare(String(b.key)));
  return JSON.stringify(rows);
}

/**
 * Structural snapshot of chain rows (ids + brand keys).
 * The semantic signature drops blank rows, so a freshly added empty Path B row looks
 * like "no change" — comparing this alongside it keeps new rows from being discarded.
 */
export function buildSelectYourselfChainEntryRowsSignature(profile) {
  if (!profile) return '';
  return JSON.stringify(
    getCompanyInfoEntriesForSave(profile).map((entry) => ({
      id: String(entry?.id || '').trim(),
      brand: brandKeyForDuplicateCheck(entry?.brands) || ''
    }))
  );
}

import { brandKeyForDuplicateCheck } from './supplierChainEntryValidation';
import {
  resolveSupplierBrandSetupLayers,
  supplierHasBrandAccess
} from './supplierBrandLayerContract';
import { formatDateTimeIST } from './dateTime';

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

/** True when this brand entry needs admin review (new role assignment or role change). */
export function entryNeedsChainRoleAdminReview(baselineEntry, pendingEntry) {
  const pendingRole = String(pendingEntry?.role || '').trim();
  const brand = String(pendingEntry?.brands || '').trim();
  if (!pendingRole || !brand) return false;

  const baselineRole = String(baselineEntry?.role || '').trim();
  if (!baselineRole) return true;
  return pendingRole !== baselineRole;
}

/** Pending supply-chain role submissions awaiting admin approval (role must be assigned). */
export function listPendingChainRoleSubmissions(profile) {
  const status = String(profile?.chainProfileApprovalStatus || '').trim().toLowerCase();
  if (status !== 'pending') return [];

  const baselineEntries = getApprovedBaselineEntries(profile);
  const displayEntries = getCompanyInfoEntriesForSave(profile);
  const submissions = [];

  for (const entry of displayEntries) {
    const baselineEntry = matchBaselineEntry(baselineEntries, entry);
    if (!entryNeedsChainRoleAdminReview(baselineEntry, entry)) continue;
    const brand = String(entry?.brands || '').trim();
    if (!brand) continue;
    submissions.push({
      brand,
      role: String(entry?.role || '').trim(),
      roleLabel: formatSupplyChainRoleLabel(entry?.role),
      submittedAt: profile?.chainProfilePendingSubmittedAt || null
    });
  }

  return submissions.sort((a, b) => a.brand.localeCompare(b.brand));
}

export function hasPendingChainRoleSubmissionForBrand(profile, brandName) {
  const brandKey = brandKeyForDuplicateCheck(brandName);
  if (!brandKey) return false;
  return listPendingChainRoleSubmissions(profile).some(
    (row) => brandKeyForDuplicateCheck(row.brand) === brandKey
  );
}

/** Scope chain-profile pending status to brands that actually submitted a role. */
export function resolveChainProfileApprovalStatusForBrand(profile, brandName) {
  const status = String(profile?.chainProfileApprovalStatus || '').trim().toLowerCase();
  if (status !== 'pending') return String(profile?.chainProfileApprovalStatus || '').trim();
  return hasPendingChainRoleSubmissionForBrand(profile, brandName) ? 'pending' : '';
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
  const entryIdValue = String(entry?.id || '').trim();
  // Prefer row id so a Path B draft is never treated as an existing approved brand
  // just because the typed name momentarily matches (Safari → safarii).
  if (id && entryIdValue) {
    return entryIdValue === id;
  }
  const brandKey = brandKeyForDuplicateCheck(brand);
  const entryBrandKey = brandKeyForDuplicateCheck(entry?.brands);
  return Boolean(brandKey && entryBrandKey && brandKey === entryBrandKey);
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

export const BRAND_APPROVAL_REQUEST_LABEL = 'Brand approval request';

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
  return /duplicate of (approved brand\s+)?["“]?/i.test(String(reason || ''));
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

/** Timestamp used to pick the latest supplier brand-request row for a brand identity. */
function supplierBrandRequestRowTimestamp(row = {}) {
  return String(
    row?.updatedAt ||
      row?.updated_at ||
      row?.submittedAt ||
      row?.requestedAt ||
      row?.createdAt ||
      ''
  );
}

function normalizeSupplierBrandRequestRow(item, fallbackName = '') {
  if (typeof item === 'string') {
    const name = String(item || '').trim();
    return name
      ? {
          name,
          status: 'pending',
          requestedAt: null,
          submittedAt: null,
          createdAt: null,
          updatedAt: null,
          rejectionReason: ''
        }
      : null;
  }
  const name = String(item?.name || item?.normalizedName || fallbackName || '').trim();
  if (!name) return null;
  const submittedAt = item?.submittedAt || item?.requestedAt || item?.createdAt || null;
  return {
    name,
    status: String(item?.status || 'pending').trim().toLowerCase() || 'pending',
    requestedAt: item?.requestedAt || submittedAt,
    submittedAt,
    createdAt: item?.createdAt || null,
    updatedAt: item?.updatedAt || item?.updated_at || null,
    rejectionReason: String(item?.rejectionReason || '').trim()
  };
}

/** Find this supplier's brand-approval request row for a brand name (any status). */
export function findSupplierBrandRequest(brandName, supplierBrandRequests = []) {
  const brandKey = brandKeyForDuplicateCheck(brandName);
  if (!brandKey) return null;

  let best = null;
  for (const item of Array.isArray(supplierBrandRequests) ? supplierBrandRequests : []) {
    const name = typeof item === 'string' ? item : item?.name || item?.normalizedName;
    const itemKey = brandKeyForDuplicateCheck(
      typeof item === 'object' ? item?.normalizedName || name : name
    );
    if (itemKey !== brandKey) continue;
    const candidate = normalizeSupplierBrandRequestRow(item, brandName);
    if (!candidate) continue;
    if (
      !best ||
      supplierBrandRequestRowTimestamp(candidate) > supplierBrandRequestRowTimestamp(best)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Merge pending/approved brand-request rows into profile.supplierBrandRequests so Brand status
 * updates immediately after Save brand (even if the API profile omits a just-created request).
 * @param {object} profile
 * @param {Array} requestRows
 * @param {{ allowPendingToReplaceApproved?: boolean }} [options]
 */
export function mergeSupplierBrandRequestsIntoProfile(profile, requestRows = [], options = {}) {
  if (!profile || typeof profile !== 'object') return profile;
  const allowPendingToReplaceApproved = options?.allowPendingToReplaceApproved === true;
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
    // Never downgrade an approved catalog/request row to pending from a stale merge —
    // unless this is a fresh Path B submit that must show pending until admin acts.
    if (
      existingStatus === 'approved' &&
      incomingStatus === 'pending' &&
      !allowPendingToReplaceApproved
    ) {
      continue;
    }
    const existingTs = supplierBrandRequestRowTimestamp(existing);
    const incomingTs = supplierBrandRequestRowTimestamp(row);
    if (
      existingStatus &&
      incomingStatus !== existingStatus &&
      existingStatus !== 'approved' &&
      incomingStatus !== 'approved' &&
      incomingTs &&
      existingTs &&
      incomingTs <= existingTs
    ) {
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
      createdAt: row.createdAt || existing.createdAt || null,
      updatedAt: row.updatedAt || existing.updatedAt || row.submittedAt || existing.submittedAt || null
    });
  }

  return {
    ...profile,
    supplierBrandRequests: [...byKey.values()].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''))
    )
  };
}

/** Collapse duplicate request rows per brand key, keeping the latest server status. */
export function dedupeSupplierBrandRequestsByLatest(requestRows = []) {
  const byKey = new Map();
  for (const item of Array.isArray(requestRows) ? requestRows : []) {
    const normalized =
      typeof item === 'string'
        ? normalizeSupplierBrandRequestRow(item)
        : normalizeSupplierBrandRequestRow(item, item?.name);
    if (!normalized) continue;
    const key = brandKeyForDuplicateCheck(normalized.name);
    if (!key) continue;
    const existing = byKey.get(key);
    if (
      !existing ||
      supplierBrandRequestRowTimestamp(normalized) >= supplierBrandRequestRowTimestamp(existing)
    ) {
      byKey.set(key, {
        ...normalized,
        normalizedName: brandKeyForDuplicateCheck(normalized.name)
      });
    }
  }
  return [...byKey.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

/** Normalize profile request rows and drop stale pending duplicates after admin acts. */
export function normalizeSupplierBrandRequestsOnProfile(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  const requests = dedupeSupplierBrandRequestsByLatest(profile.supplierBrandRequests || []);
  const prev = profile.supplierBrandRequests || [];
  const unchanged =
    prev.length === requests.length &&
    prev.every((row, index) => {
      const next = requests[index];
      return (
        brandKeyForDuplicateCheck(row?.name || row?.normalizedName) ===
          brandKeyForDuplicateCheck(next?.name || next?.normalizedName) &&
        String(row?.status || '').toLowerCase() === String(next?.status || '').toLowerCase()
      );
    });
  if (unchanged) return profile;
  return { ...profile, supplierBrandRequests: requests };
}

/**
 * Clear or upgrade a local Path B submission banner once admin approval/rejection
 * is visible in profile, approved-brand lists, or the approved catalog.
 * Returns the same notice reference when nothing changed.
 */
export function reconcileBrandSubmissionNotice(
  notice,
  {
    profile = null,
    catalogBrands = [],
    supplierApprovedBrands = []
  } = {}
) {
  if (!notice || notice.tone !== 'pending') return notice;
  const brands = Array.isArray(notice.brands) ? notice.brands : [];
  if (brands.length === 0) return null;

  const requests = Array.isArray(profile?.supplierBrandRequests) ? profile.supplierBrandRequests : [];
  const adminApproved = Array.isArray(profile?.adminApprovedBrands) ? profile.adminApprovedBrands : [];
  const approvedList =
    Array.isArray(supplierApprovedBrands) && supplierApprovedBrands.length > 0
      ? supplierApprovedBrands
      : adminApproved;

  const stillPending = [];
  const nowApproved = [];
  const nowRejected = [];

  for (const row of brands) {
    const name = String(row?.name || '').trim();
    if (!name) continue;
    const request = findSupplierBrandRequest(name, requests);
    const status = String(request?.status || '').toLowerCase();
    if (status === 'rejected') {
      nowRejected.push({
        ...row,
        name,
        status: 'rejected',
        rejectionReason: request?.rejectionReason || row?.rejectionReason || ''
      });
      continue;
    }
    const approved =
      status === 'approved' ||
      isBrandAlreadyApprovedForSaveBrand(name, {
        catalogBrands,
        supplierApprovedBrands: approvedList,
        supplierBrandRequests: requests,
        adminApprovedBrands: adminApproved
      });
    if (approved) {
      nowApproved.push({
        ...row,
        name,
        status: 'approved',
        submittedAt:
          row?.submittedAt ||
          request?.submittedAt ||
          request?.requestedAt ||
          request?.createdAt ||
          null
      });
      continue;
    }
    stillPending.push(row);
  }

  if (stillPending.length === brands.length) return notice;

  if (stillPending.length > 0) {
    return {
      ...notice,
      tone: 'pending',
      brands: stillPending,
      title:
        stillPending.length === 1
          ? `Pending Admin Approval — "${stillPending[0].name}"`
          : `${stillPending.length} brand requests pending admin approval`,
      message:
        stillPending.length === 1
          ? 'Path B: your brand request is still waiting for admin approval.'
          : 'Path B: some brand requests are still waiting for admin approval.'
    };
  }

  if (nowRejected.length > 0 && nowApproved.length === 0) {
    // Let the brand-status card show rejection details; drop the stale pending banner.
    return null;
  }

  return {
    tone: 'success',
    title:
      nowApproved.length === 1
        ? `Brand "${nowApproved[0].name}" approved by admin`
        : `${nowApproved.length} brand requests approved by admin`,
    brands: nowApproved,
    submittedAt:
      nowApproved.find((row) => row.submittedAt)?.submittedAt || notice.submittedAt || null,
    message:
      nowApproved.length === 1
        ? 'Admin approved your brand request. Continue with Path A supply-chain role setup for this brand.'
        : 'Admin approved your brand requests. Continue with Path A supply-chain role setup for each brand.'
  };
}

/**
 * Flip stale pending request rows to approved when Layer 2 access is already true
 * (catalog / adminApprovedBrands / supplierApprovedBrands). Keeps Supplier UI in sync
 * after Admin approves even if a local pending merge has not been refreshed yet.
 */
export function reconcilePendingSupplierBrandRequests(
  profile,
  {
    catalogBrands = [],
    supplierApprovedBrands = []
  } = {}
) {
  if (!profile || typeof profile !== 'object') return profile;
  const requests = Array.isArray(profile.supplierBrandRequests) ? profile.supplierBrandRequests : [];
  if (requests.length === 0) return profile;

  const adminApproved = Array.isArray(profile.adminApprovedBrands) ? profile.adminApprovedBrands : [];
  const approvedList =
    Array.isArray(supplierApprovedBrands) && supplierApprovedBrands.length > 0
      ? supplierApprovedBrands
      : adminApproved;

  let changed = false;
  const nextRequests = requests.map((row) => {
    const name = String(row?.name || row?.normalizedName || '').trim();
    const status = String(row?.status || '').toLowerCase();
    if (!name || status !== 'pending') return row;
    // Avoid treating the pending row itself as approval evidence — pass peers only.
    const peers = requests.filter(
      (item) => brandKeyForDuplicateCheck(item?.name || item?.normalizedName) !== brandKeyForDuplicateCheck(name)
    );
    const approved = isBrandAlreadyApprovedForSaveBrand(name, {
      catalogBrands,
      supplierApprovedBrands: approvedList,
      supplierBrandRequests: peers,
      adminApprovedBrands: adminApproved
    });
    if (!approved) return row;
    changed = true;
    return { ...row, name, status: 'approved' };
  });

  if (!changed) return profile;
  return { ...profile, supplierBrandRequests: nextRequests };
}

/**
 * Brand-step status card (Path A / Path B). Single source of truth so the UI never
 * shows "Ready to submit" alongside an approved/pending request state.
 *
 * Precedence: empty → approved access → rejected → pending request → catalog match hint → ready.
 * Approved Layer 2 / catalog must beat a stale pending request row after Admin approval.
 */
export function resolveSelectYourselfBrandStepStatus({
  brandName = '',
  catalogBrandNames = [],
  catalogBrands = null,
  supplierBrandRequests = [],
  supplierApprovedBrands = [],
  approvedCatalogMatchMessage = '',
  approvedCatalogSuggestionMessage = ''
} = {}) {
  const selectedBrand = String(brandName || '').trim();
  const detailLines = [];
  if (!selectedBrand) {
    return { tone: 'neutral', label: 'Select a brand first', detailLines };
  }

  detailLines.push(selectedBrand);

  const brandRequest = findSupplierBrandRequest(selectedBrand, supplierBrandRequests);
  const requestStatus = String(brandRequest?.status || '').toLowerCase();
  const submittedAt =
    brandRequest?.submittedAt || brandRequest?.requestedAt || brandRequest?.createdAt || null;
  const namesForExact =
    Array.isArray(catalogBrandNames) && catalogBrandNames.length > 0
      ? catalogBrandNames
      : (Array.isArray(catalogBrands) ? catalogBrands : []).map((item) =>
          typeof item === 'string' ? item : item?.name
        );
  const catalogBrandSelected = namesForExact.some(
    (name) => brandKeyForDuplicateCheck(name) === brandKeyForDuplicateCheck(selectedBrand)
  );
  const layers = resolveSupplierBrandSetupLayers({
    brandName: selectedBrand,
    catalogBrands: catalogBrands != null ? catalogBrands : namesForExact,
    supplierApprovedBrands,
    supplierBrandRequests,
    brandMeta: null
  });

  const isApproved =
    catalogBrandSelected ||
    requestStatus === 'approved' ||
    layers.supplierHasAccess === true;

  if (isApproved) {
    if (submittedAt) {
      detailLines.push(`Submitted: ${formatDateTimeIST(submittedAt, '—')}`);
    }
    return { tone: 'success', label: 'Approved by admin', detailLines };
  }

  if (requestStatus === 'rejected') {
    if (brandRequest?.rejectionReason) detailLines.push(brandRequest.rejectionReason);
    detailLines.push(
      submittedAt
        ? `Originally submitted: ${formatDateTimeIST(submittedAt, '—')}`
        : 'Originally submitted: date unavailable'
    );
    return { tone: 'danger', label: 'Rejected by admin', detailLines };
  }

  if (requestStatus === 'pending') {
    detailLines.push(
      'Your brand approval request was submitted. Waiting for admin review — no need to submit again.'
    );
    detailLines.push(
      submittedAt
        ? `Submitted: ${formatDateTimeIST(submittedAt, '—')}`
        : 'Submitted: date will appear after refresh if admin review is still pending.'
    );
    return {
      tone: 'warning',
      label: 'Pending Admin Approval',
      detailLines
    };
  }

  if (approvedCatalogMatchMessage) {
    detailLines.push(approvedCatalogMatchMessage);
    detailLines.push('Select the approved brand below to continue with role setup.');
    return {
      tone: 'warning',
      label: 'Already approved — select from list',
      detailLines
    };
  }

  if (approvedCatalogSuggestionMessage) {
    detailLines.push(approvedCatalogSuggestionMessage);
  }

  detailLines.push(`Use ${BRAND_APPROVAL_REQUEST_LABEL} at the top of this section to send this request to admin.`);
  return {
    tone: 'neutral',
    label: 'Ready to submit for approval',
    detailLines
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

/**
 * True when this brand must not be submitted via Path B Save brand —
 * it is already admin-approved (catalog, supplier access, or approved request).
 */
export function isBrandAlreadyApprovedForSaveBrand(
  brandName,
  {
    catalogBrands = [],
    supplierApprovedBrands = [],
    supplierBrandRequests = [],
    adminApprovedBrands = []
  } = {}
) {
  const brand = String(brandName || '').trim();
  if (!brand) return false;
  const brandKey = brandKeyForDuplicateCheck(brand);
  if (!brandKey) return false;

  if (isLiteralApprovedCatalogBrand(brand, catalogBrands)) return true;

  const request = findSupplierBrandRequest(brand, supplierBrandRequests);
  if (String(request?.status || '').toLowerCase() === 'approved') return true;

  const adminList = Array.isArray(adminApprovedBrands) ? adminApprovedBrands : [];
  if (
    adminList.some((item) => {
      const name = typeof item === 'string' ? item : item?.name;
      const itemStatus =
        typeof item === 'object' ? String(item?.status || 'approved').toLowerCase() : 'approved';
      return itemStatus === 'approved' && brandKeyForDuplicateCheck(name) === brandKey;
    })
  ) {
    return true;
  }

  return supplierHasBrandAccess({
    brandName: brand,
    catalogBrands,
    supplierApprovedBrands,
    supplierBrandRequests,
    brandMeta: null
  });
}

/** Whether Step 1 brand-document upload is unnecessary (brand already admin-approved). */
export function isSelectYourselfBrandAlreadyApproved(brandName, options = {}) {
  return isBrandAlreadyApprovedForSaveBrand(brandName, options);
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
 * True when Save brand should stay disabled because there is nothing new to submit:
 * - no brand rows, OR
 * - brand details are unchanged since the last successful save, OR
 * - only pending Path B requests (duplicate submit is never allowed while pending), OR
 * - all brands are already approved (catalog / approved request — no brand-request save needed)
 * Rejected brands and new unlisted brands re-enable save.
 * Document-only edits on an already-pending brand do NOT re-enable Save brand.
 */
export const BRAND_REQUEST_ALREADY_PENDING_MESSAGE =
  'This brand request is already pending admin approval. Wait for admin to approve or reject it before submitting again.';

export const BRAND_ALREADY_APPROVED_SAVE_MESSAGE =
  'This brand is already approved by admin. Select it from Path A above, then continue with supply-chain role setup.';

/**
 * Classify Path B "Save brand" API outcomes for UI notices.
 * Defaults to pending — never treat a just-submitted request as approved unless
 * the server explicitly reported brandAlreadyApproved and the brand is in the
 * approved catalog / request list.
 */
export function classifyPathBBrandSaveRows({
  brandsBeingSaved = [],
  requestSource = [],
  approvalFailureRows = [],
  approvedCatalogKeys = new Set(),
  adminApprovedKeys = new Set(),
  brandAlreadyApproved = false,
  brandApprovalRequested = false,
  brandAlreadyPending = false
} = {}) {
  return (Array.isArray(brandsBeingSaved) ? brandsBeingSaved : []).map((brandName) => {
    const name = String(brandName || '').trim();
    const request = findSupplierBrandRequest(name, [
      ...(Array.isArray(requestSource) ? requestSource : []),
      ...(Array.isArray(approvalFailureRows) ? approvalFailureRows : [])
    ]);
    const brandKey = brandKeyForDuplicateCheck(name);
    const requestStatus = String(request?.status || '').toLowerCase();
    const failureForBrand = (Array.isArray(approvalFailureRows) ? approvalFailureRows : []).find(
      (row) => brandKeyForDuplicateCheck(row?.name) === brandKey
    );
    const inApprovedCatalog =
      !!brandKey &&
      ((approvedCatalogKeys instanceof Set
        ? approvedCatalogKeys.has(brandKey)
        : false) ||
        (adminApprovedKeys instanceof Set ? adminApprovedKeys.has(brandKey) : false));

    // Per-brand outcomes: never let a sibling brand's "pending requested" flag mark an
    // already-catalog-approved brand as pending in the Path B notice.
    let status = 'pending';
    if (failureForBrand) {
      status = 'pending';
    } else if (inApprovedCatalog || requestStatus === 'approved') {
      status = 'approved';
    } else if (requestStatus === 'rejected') {
      status = 'rejected';
    } else if (requestStatus === 'pending' || brandApprovalRequested || brandAlreadyPending) {
      status = 'pending';
    } else if (brandAlreadyApproved === true) {
      status = 'approved';
    }

    return {
      name,
      status,
      submittedAt:
        request?.submittedAt ||
        request?.requestedAt ||
        failureForBrand?.submittedAt ||
        (status === 'pending' ? new Date().toISOString() : null)
    };
  });
}

export function listPendingBrandNamesBlockingSave({
  profile,
  catalogBrands = [],
  supplierApprovedBrands = [],
  extraPendingBrandNames = []
} = {}) {
  const entries = getCompanyInfoEntriesForSave(profile || {}).filter((entry) =>
    String(entry?.brands || '').trim()
  );
  const requests = profile?.supplierBrandRequests || [];
  const adminApproved = Array.isArray(profile?.adminApprovedBrands)
    ? profile.adminApprovedBrands
    : [];
  const approvedListForAccess =
    Array.isArray(supplierApprovedBrands) && supplierApprovedBrands.length > 0
      ? supplierApprovedBrands
      : adminApproved;
  const extraPendingKeys = new Set(
    (Array.isArray(extraPendingBrandNames) ? extraPendingBrandNames : [])
      .map((name) => brandKeyForDuplicateCheck(name))
      .filter(Boolean)
  );
  const pendingNames = [];
  for (const entry of entries) {
    const brand = String(entry?.brands || '').trim();
    if (!brand) continue;
    const brandKey = brandKeyForDuplicateCheck(brand);
    // Stale local pending notices must not keep blocking after Admin approval.
    if (
      isBrandAlreadyApprovedForSaveBrand(brand, {
        catalogBrands,
        supplierApprovedBrands: approvedListForAccess,
        supplierBrandRequests: requests,
        adminApprovedBrands: adminApproved
      })
    ) {
      continue;
    }
    const request = findSupplierBrandRequest(brand, requests);
    const status = String(request?.status || '').toLowerCase();
    if (status === 'pending' || (brandKey && extraPendingKeys.has(brandKey))) {
      pendingNames.push(brand);
    }
  }
  return pendingNames;
}

/** Brands that are already approved (catalog or approved request) — Save brand must stay off. */
export function listApprovedBrandNamesBlockingSave({
  profile,
  catalogBrands = [],
  supplierApprovedBrands = [],
  extraApprovedBrandNames = []
} = {}) {
  const entries = getCompanyInfoEntriesForSave(profile || {}).filter((entry) =>
    String(entry?.brands || '').trim()
  );
  const requests = profile?.supplierBrandRequests || [];
  const adminApproved = Array.isArray(profile?.adminApprovedBrands)
    ? profile.adminApprovedBrands
    : [];
  const extraApprovedKeys = new Set(
    (Array.isArray(extraApprovedBrandNames) ? extraApprovedBrandNames : [])
      .map((name) => brandKeyForDuplicateCheck(name))
      .filter(Boolean)
  );
  const approvedNames = [];
  for (const entry of entries) {
    const brand = String(entry?.brands || '').trim();
    if (!brand) continue;
    const brandKey = brandKeyForDuplicateCheck(brand);
    if (
      isBrandAlreadyApprovedForSaveBrand(brand, {
        catalogBrands,
        supplierApprovedBrands:
          Array.isArray(supplierApprovedBrands) && supplierApprovedBrands.length > 0
            ? supplierApprovedBrands
            : adminApproved,
        supplierBrandRequests: requests,
        adminApprovedBrands: adminApproved
      }) ||
      (brandKey && extraApprovedKeys.has(brandKey))
    ) {
      approvedNames.push(brand);
    }
  }
  return approvedNames;
}

export function isBrandApprovalSaveBlockedForPendingRequests({
  profile,
  catalogBrands = [],
  supplierApprovedBrands = [],
  submittedSignature = '',
  extraPendingBrandNames = [],
  extraApprovedBrandNames = []
} = {}) {
  const entries = getCompanyInfoEntriesForSave(profile || {}).filter((entry) =>
    String(entry?.brands || '').trim()
  );
  if (entries.length === 0) return true;

  const requests = profile?.supplierBrandRequests || [];
  const extraPendingKeys = new Set(
    (Array.isArray(extraPendingBrandNames) ? extraPendingBrandNames : [])
      .map((name) => brandKeyForDuplicateCheck(name))
      .filter(Boolean)
  );
  const extraApprovedKeys = new Set(
    (Array.isArray(extraApprovedBrandNames) ? extraApprovedBrandNames : [])
      .map((name) => brandKeyForDuplicateCheck(name))
      .filter(Boolean)
  );
  const adminApproved = Array.isArray(profile?.adminApprovedBrands)
    ? profile.adminApprovedBrands
    : [];
  const approvedListForAccess =
    Array.isArray(supplierApprovedBrands) && supplierApprovedBrands.length > 0
      ? supplierApprovedBrands
      : adminApproved;

  let hasActionableBrand = false;
  let hasPendingCustom = false;
  let hasRejectedCustom = false;
  let hasApprovedOnly = false;

  for (const entry of entries) {
    const brand = String(entry?.brands || '').trim();
    const brandKey = brandKeyForDuplicateCheck(brand);
    const request = findSupplierBrandRequest(brand, requests);
    const status = String(request?.status || '').toLowerCase();
    const alreadyApproved =
      isBrandAlreadyApprovedForSaveBrand(brand, {
        catalogBrands,
        supplierApprovedBrands: approvedListForAccess,
        supplierBrandRequests: requests,
        adminApprovedBrands: adminApproved
      }) ||
      (brandKey && extraApprovedKeys.has(brandKey));

    if (alreadyApproved) {
      // Path A / already-approved brands never need Save brand (role setup is separate).
      hasApprovedOnly = true;
      continue;
    }
    if (status === 'rejected') {
      hasRejectedCustom = true;
      hasActionableBrand = true;
      continue;
    }
    const isPending = status === 'pending' || (brandKey && extraPendingKeys.has(brandKey));
    if (isPending) {
      hasPendingCustom = true;
      continue;
    }
    if (!request) {
      hasActionableBrand = true;
      continue;
    }
  }

  // Rejected Path B always needs another Save brand attempt.
  if (hasRejectedCustom) return false;

  // Pending Path B: never allow duplicate submit of the same brand (docs/name tweaks included).
  if (hasPendingCustom && !hasActionableBrand) {
    return true;
  }

  // All configured brands are already approved — keep Save brand disabled.
  if (hasApprovedOnly && !hasActionableBrand && !hasPendingCustom) {
    return true;
  }

  const currentSignature = buildBrandApprovalDetailsSignature(profile, catalogBrands);
  if (submittedSignature && currentSignature === submittedSignature) {
    return true;
  }

  if (hasActionableBrand) return false;
  // Only approved custom brands remain — nothing left for Save brand.
  return true;
}

/** True when this brand entry still needs a Path B admin approval request. */
export function entryNeedsBrandApprovalRequest(
  entry = {},
  {
    catalogBrands = [],
    supplierApprovedBrands = [],
    supplierBrandRequests = [],
    adminApprovedBrands = []
  } = {}
) {
  const brand = String(entry?.brands || '').trim();
  if (!brand) return false;
  if (
    isBrandAlreadyApprovedForSaveBrand(brand, {
      catalogBrands,
      supplierApprovedBrands,
      supplierBrandRequests,
      adminApprovedBrands
    })
  ) {
    return false;
  }
  const request = findSupplierBrandRequest(brand, supplierBrandRequests);
  const status = String(request?.status || '').toLowerCase();
  return status !== 'pending';
}

/** True when at least one configured brand still needs a Path B approval request. */
export function profileHasBrandsNeedingApprovalRequest({
  profile,
  catalogBrands = [],
  supplierApprovedBrands = [],
  submittedSignature = '',
  extraPendingBrandNames = [],
  extraApprovedBrandNames = []
} = {}) {
  return !isBrandApprovalSaveBlockedForPendingRequests({
    profile,
    catalogBrands,
    supplierApprovedBrands,
    submittedSignature,
    extraPendingBrandNames,
    extraApprovedBrandNames
  });
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
    const existingId = String(row?.id || '').trim();
    const entryId =
      String(row?.entryId || '').trim() ||
      (existingId && !existingId.startsWith('catalog-') && !existingId.startsWith('brand-')
        ? existingId
        : '');
    // Stable id by brand key — must not flip from catalog-* → entry UUID after selection,
    // or the Select Yourself page clears the assignment and loops back to brand picking.
    rows.push({
      ...row,
      id: `brand-${key}`,
      entryId
    });
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
        entryId: assignment.id,
        hasAdminSupplyChain: assignment.hasAdminSupplyChain === true || catalogHasAdminSupplyChain
      });
      continue;
    }

    pushRow({
      id: `brand-${catalogKey}`,
      entryId: '',
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
      entryId: assignment.id,
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

/** Merge profile rows that refer to the same brand spelling (case-insensitive). */
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

/** Clear Path B brand drafts after a successful brand-approval submit; keep role-setup rows. */
export function clearSubmittedPathBBrandDrafts(profile, submittedBrandNames = []) {
  if (!profile) return profile;
  const submittedKeys = new Set(
    (Array.isArray(submittedBrandNames) ? submittedBrandNames : [])
      .map((name) => brandKeyForDuplicateCheck(name))
      .filter(Boolean)
  );
  if (submittedKeys.size === 0) return profile;

  const entries = getCompanyInfoEntriesForSave(profile).filter((entry) => {
    const brand = String(entry?.brands || '').trim();
    const brandKey = brandKeyForDuplicateCheck(brand);
    if (!brandKey || !submittedKeys.has(brandKey)) return true;
    if (String(entry?.role || '').trim()) return true;
    return false;
  });

  let nextEntries = ensureAtLeastOneCompanyInfoEntry({
    ...profile,
    companyInfoEntries: entries
  });
  if (!nextEntries.some((entry) => !String(entry?.brands || '').trim())) {
    nextEntries = [...nextEntries, ...ensureAtLeastOneCompanyInfoEntry({ companyInfoEntries: [] })];
  }

  return buildSupplierChainSavePayload(
    { ...profile, companyInfoEntries: nextEntries },
    nextEntries,
    { dedupeByBrand: false }
  );
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
 * Empty role/docs from a stale form snapshot must not wipe a newer draft on the full profile
 * (e.g. role selected, then document upload applies against a briefly stale form prop).
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
    const existingRoleDocs = resolveAuthorizationCertificateUrls(entry || {});
    const formRoleDocs = resolveAuthorizationCertificateUrls(formEntry || {});
    const existingBrandDocs = resolveBrandApprovalDocumentUrls(entry || {});
    const formBrandDocs = resolveBrandApprovalDocumentUrls(formEntry || {});
    merged.push(
      normalizeEntryDocumentFields({
        ...(entry || {}),
        ...formEntry,
        id: id || formId,
        role: String(formEntry?.role || '').trim() || String(entry?.role || '').trim(),
        minimumOrderValue:
          formEntry?.minimumOrderValue !== '' &&
          formEntry?.minimumOrderValue !== null &&
          formEntry?.minimumOrderValue !== undefined
            ? formEntry.minimumOrderValue
            : entry?.minimumOrderValue ?? '',
        supplyChainRegistrationStarted:
          formEntry?.supplyChainRegistrationStarted === true ||
          entry?.supplyChainRegistrationStarted === true ||
          !!String(formEntry?.role || entry?.role || '').trim(),
        ...setAuthorizationCertificateUrls({}, [...new Set([...existingRoleDocs, ...formRoleDocs])]),
        ...setBrandApprovalDocumentUrls({}, [...new Set([...existingBrandDocs, ...formBrandDocs])])
      })
    );
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
  const sourceEntries = entries || getCompanyInfoEntriesForSave(profile);
  // Live Path B typing must not collapse a draft into an existing approved row
  // when the typed name briefly matches (Safari → safarii). Dedupe on save/API only.
  const nextEntries = (
    options.dedupeByBrand === false
      ? sourceEntries
      : deduplicateCompanyInfoEntriesByBrand(sourceEntries)
  ).map(normalizeEntryDocumentFields);
  const first = nextEntries[0] || {};
  const saveEntryId = String(options.saveSupplyChainEntryId || '').trim();
  const savedEntry =
    (saveEntryId && nextEntries.find((entry) => String(entry?.id || '').trim() === saveEntryId)) ||
    first;
  const preserveTopLevelFields = Boolean(saveEntryId);
  const brandsFromEntries = nextEntries
    .map((entry) => String(entry?.brands || '').trim())
    .filter(Boolean);
  const primaryEntryBrand =
    String(savedEntry?.brands || '').trim() || brandsFromEntries[0] || '';
  const chainFields = {
    companyInfoEntries: nextEntries,
    supplierRole: preserveTopLevelFields
      ? profile?.supplierRole || savedEntry.role || ''
      : savedEntry.role || profile?.supplierRole || '',
    brands: preserveTopLevelFields
      ? profile?.brands || primaryEntryBrand || ''
      : primaryEntryBrand,
    gstin: preserveTopLevelFields
      ? profile?.gstin || savedEntry.gstin || ''
      : savedEntry.gstin || profile?.gstin || '',
    companyName: preserveTopLevelFields
      ? profile?.companyName || savedEntry.companyName || ''
      : savedEntry.companyName || profile?.companyName || '',
    minimumOrderValue: savedEntry.minimumOrderValue ?? profile?.minimumOrderValue ?? ''
  };

  if (options.forApi) {
    const payload = {
      userType: profile?.userType || 'supplier',
      companyInfoEntries: nextEntries,
      supplierRole: chainFields.supplierRole,
      brands: chainFields.brands
    };
    const gstin = String(chainFields.gstin || '').trim();
    const companyName = String(chainFields.companyName || '').trim();
    const mov = savedEntry.minimumOrderValue;
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

export const CHAIN_PROFILE_REJECTION_ACK_STORAGE_KEY = 'tatva.selectYourself.chainProfileRejectionAck';

export function getChainProfileRejectionAckKey(rejection = {}) {
  const id = String(rejection?.id || '').trim();
  if (id) return id;
  const reviewedAt = String(rejection?.reviewedAt || '').trim();
  const reason = String(rejection?.reason || '').trim();
  if (reviewedAt || reason) return `${reviewedAt}::${reason}`;
  return '';
}

export function readAcknowledgedChainProfileRejectionKey(storage = globalThis.sessionStorage) {
  try {
    return String(storage?.getItem?.(CHAIN_PROFILE_REJECTION_ACK_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function acknowledgeChainProfileRejection(rejection, storage = globalThis.sessionStorage) {
  const key = getChainProfileRejectionAckKey(rejection);
  if (!key) return '';
  try {
    storage?.setItem?.(CHAIN_PROFILE_REJECTION_ACK_STORAGE_KEY, key);
  } catch {
    // Ignore private-mode / disabled storage.
  }
  return key;
}

export function shouldShowChainProfileRejectionBanner({
  rejection = null,
  approvalStatus = '',
  acknowledgedKey = ''
} = {}) {
  const reason = String(rejection?.reason || '').trim();
  if (!reason) return false;
  const status = String(approvalStatus || '').trim().toLowerCase();
  // After reject, Select yourself falls back to the previously approved assignment.
  // Do not keep a historical rejection banner on that live approved profile.
  if (!status || status === 'pending' || status === 'approved') return false;
  const currentKey = getChainProfileRejectionAckKey(rejection);
  if (currentKey && currentKey === String(acknowledgedKey || '').trim()) return false;
  return true;
}
