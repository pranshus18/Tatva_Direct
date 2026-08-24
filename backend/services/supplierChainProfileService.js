import { supabase } from '../config/supabase.js';
import { v4 as uuidv4 } from 'uuid';
import { catalogBrandDedupKey, normalizeBrandKey } from './supplyChainSharedService.js';
import {
  resolveBrandApprovalDocumentUrls,
  setBrandApprovalDocumentUrls,
  resolveAuthorizationCertificateUrls,
  setAuthorizationCertificateUrls,
  normalizeEntryDocumentFields
} from '../utils/authorizationCertificateUrls.js';

const ROLE_SET = new Set([
  'manufacturer',
  'stockist',
  'regional_distributor',
  'local_distributor',
  'dealer',
  'retailer'
]);

/** Stable brand identity used for catalog + request matching (collapses spelling variants). */
function brandIdentityKey(nameOrNormalized) {
  return catalogBrandDedupKey(nameOrNormalized) || normalizeBrandKey(nameOrNormalized);
}

function isDuplicateOfApprovedRejection(reason = '') {
  return /duplicate of (approved brand\s+)?["“]?/i.test(String(reason || ''));
}
function parseEntryBrandList(brands) {
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

export function normalizeCompanyInfoEntries(rawEntries) {
  const raw = Array.isArray(rawEntries)
    ? rawEntries
    : rawEntries && typeof rawEntries === 'object'
      ? [rawEntries]
      : [];
  const normalized = [];

  for (const e of raw) {
    const role = String(e?.role || '').trim();
    let minimumOrderValue = null;
    if (role && role !== 'retailer') {
      const rawMov = e?.minimumOrderValue;
      if (rawMov !== '' && rawMov !== null && rawMov !== undefined) {
        const v = parseFloat(rawMov);
        if (Number.isFinite(v) && v >= 0) {
          minimumOrderValue = Math.round(v * 100) / 100;
          if (minimumOrderValue === 0) minimumOrderValue = null;
        }
      }
    }
    const certificateFields = setAuthorizationCertificateUrls({}, resolveAuthorizationCertificateUrls(e));
    const brandDocumentFields = setBrandApprovalDocumentUrls({}, resolveBrandApprovalDocumentUrls(e));
    const brandList = parseEntryBrandList(e?.brands);
    const brandsForRows = brandList.length > 0 ? brandList : [''];
    const baseId = e?.id || uuidv4();

    brandsForRows.forEach((brand, index) => {
      normalized.push(
        normalizeEntryDocumentFields({
          id: index === 0 ? baseId : uuidv4(),
          role,
          brands: brand,
          gstin: e?.gstin != null && e.gstin !== '' ? String(e.gstin).trim() : '',
          companyName: e?.companyName != null && e.companyName !== '' ? String(e.companyName).trim() : '',
          ownershipDetails:
            e?.ownershipDetails != null && e.ownershipDetails !== '' ? String(e.ownershipDetails).trim() : '',
          brandApprovalDocumentUrls: brandDocumentFields.brandApprovalDocumentUrls,
          brandApprovalDocumentUrl: brandDocumentFields.brandApprovalDocumentUrl,
          authorizationCertificateUrls: certificateFields.authorizationCertificateUrls,
          authorizationCertificateUrl: certificateFields.authorizationCertificateUrl,
          ...(minimumOrderValue != null ? { minimumOrderValue } : {})
        })
      );
    });
  }

  return normalized;
}

function createEmptyCompanyInfoEntry() {
  return normalizeEntryDocumentFields({
    id: uuidv4(),
    role: '',
    brands: '',
    gstin: '',
    companyName: '',
    ownershipDetails: '',
    brandApprovalDocumentUrls: [],
    brandApprovalDocumentUrl: '',
    authorizationCertificateUrls: [],
    authorizationCertificateUrl: ''
  });
}

/** Drop Path B brand drafts after a successful brand-approval submit; keep role-setup rows. */
export function stripSubmittedPathBBrandDraftEntries(entries = [], submittedBrandKeys = new Set()) {
  const keys =
    submittedBrandKeys instanceof Set
      ? submittedBrandKeys
      : new Set(
          (Array.isArray(submittedBrandKeys) ? submittedBrandKeys : [])
            .map((name) => catalogBrandDedupKey(name))
            .filter(Boolean)
        );
  if (keys.size === 0) {
    return normalizeCompanyInfoEntries(entries);
  }

  const normalized = normalizeCompanyInfoEntries(entries);
  const kept = normalized.filter((entry) => {
    const brand = String(entry?.brands || '').trim();
    if (!brand) return true;
    const brandKey = catalogBrandDedupKey(brand);
    if (!brandKey || !keys.has(brandKey)) return true;
    if (String(entry?.role || '').trim()) return true;
    return false;
  });

  if (!kept.some((entry) => !String(entry?.brands || '').trim())) {
    kept.push(createEmptyCompanyInfoEntry());
  }

  return kept;
}

function mergeChainEntryDocuments(existing = {}, incoming = {}) {
  const roleUrls = [
    ...new Set([
      ...resolveAuthorizationCertificateUrls(existing),
      ...resolveAuthorizationCertificateUrls(incoming)
    ])
  ];
  const brandUrls = [
    ...new Set([
      ...resolveBrandApprovalDocumentUrls(existing),
      ...resolveBrandApprovalDocumentUrls(incoming)
    ])
  ];
  return normalizeEntryDocumentFields({
    ...existing,
    ...incoming,
    ...setAuthorizationCertificateUrls({}, roleUrls),
    ...setBrandApprovalDocumentUrls({}, brandUrls)
  });
}

export function buildChainPayloadFromProfileData(profileData) {
  const entries = normalizeCompanyInfoEntries(profileData.companyInfoEntries || []);
  return {
    supplierRole: String(profileData.supplierRole || '').trim(),
    brands: typeof profileData.brands === 'string' ? profileData.brands : profileData.brands ? String(profileData.brands) : '',
    companyInfoEntries: entries
  };
}

function mergeUniqueChainEntries(...entryLists) {
  const merged = [];
  const byId = new Map();
  const byBrand = new Map();

  const upsert = (entry) => {
    const id = String(entry?.id || '').trim();
    const brandKey = String(entry?.brands || '').trim().toLowerCase();

    if (id && byId.has(id)) {
      const idx = byId.get(id);
      merged[idx] = mergeChainEntryDocuments(merged[idx], entry);
      return;
    }

    if (brandKey && byBrand.has(brandKey)) {
      const idx = byBrand.get(brandKey);
      merged[idx] = mergeChainEntryDocuments(merged[idx], entry);
      if (id) byId.set(id, idx);
      return;
    }

    const idx = merged.length;
    merged.push({ ...entry });
    if (id) byId.set(id, idx);
    if (brandKey) byBrand.set(brandKey, idx);
  };

  for (const raw of entryLists) {
    for (const entry of normalizeCompanyInfoEntries(raw || [])) {
      upsert(entry);
    }
  }

  return merged;
}

/** Union saved, pending, and draft entries for supplier profile display (by entry id). */
export function mergeChainEntriesForDisplay(...entryLists) {
  return mergeUniqueChainEntries(...entryLists);
}

/**
 * Profile used for brand guards and supplier brand pickers.
 * Unions saved, draft, and pending Select yourself entries so declared brands stay usable.
 */
export function buildEffectiveSupplierChainProfile(profile, pendingPayload) {
  const base = profile || {};
  const approvedChain = baselineChainFromProfile(base);
  const draft = base.chainProfileDraft || {};
  const draftEntries = normalizeCompanyInfoEntries(draft.companyInfoEntries || []);
  const pendingEntries =
    pendingPayload && typeof pendingPayload === 'object'
      ? normalizeCompanyInfoEntries(pendingPayload.companyInfoEntries || [])
      : [];

  const mergedEntries = mergeUniqueChainEntries(
    approvedChain.companyInfoEntries,
    draftEntries,
    pendingEntries
  );

  const supplierRole =
    String(pendingPayload?.supplierRole || '').trim() ||
    String(draft?.supplierRole || '').trim() ||
    approvedChain.supplierRole ||
    '';

  const brands =
    (typeof pendingPayload?.brands === 'string' && pendingPayload.brands.trim() && pendingPayload.brands) ||
    (typeof draft?.brands === 'string' && draft.brands.trim() && draft.brands) ||
    approvedChain.brands ||
    mergedEntries[0]?.brands ||
    '';

  return {
    ...base,
    supplierRole,
    brands,
    companyInfoEntries: mergedEntries.length > 0 ? mergedEntries : approvedChain.companyInfoEntries
  };
}

function brandKeysForEntryMatch(label) {
  const key = normalizeBrandKey(String(label || '').trim());
  return key ? [key] : [];
}

function chainEntryMatchesBrand(entry, brandName) {
  const label = String(entry?.brands || '').trim();
  if (!label) return false;
  const wantedKeys = brandKeysForEntryMatch(brandName);
  if (wantedKeys.length === 0) return false;

  const checkLabel = (value) => {
    const entryKeys = brandKeysForEntryMatch(value);
    return wantedKeys.some((wanted) => entryKeys.includes(wanted));
  };

  if (checkLabel(label)) return true;
  return parseEntryBrandList(label).some((part) => checkLabel(part));
}

function createStubBrandChainEntry(brandName) {
  return {
    id: uuidv4(),
    role: '',
    brands: brandName,
    gstin: '',
    companyName: '',
    ownershipDetails: '',
    brandApprovalDocumentUrls: [],
    brandApprovalDocumentUrl: '',
    authorizationCertificateUrls: [],
    authorizationCertificateUrl: ''
  };
}

/** Brand names declared anywhere in saved profile, draft, or pending submission. */
export function collectDeclaredBrandNamesFromProfiles(...profiles) {
  const names = new Set();
  const addName = (value) => {
    const trimmed = String(value || '').trim();
    if (trimmed) names.add(trimmed);
  };

  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object') continue;
    parseEntryBrandList(profile.brands).forEach(addName);
    for (const entry of normalizeCompanyInfoEntries(profile.companyInfoEntries || [])) {
      parseEntryBrandList(entry?.brands).forEach(addName);
    }
    const draft = profile.chainProfileDraft;
    if (draft && typeof draft === 'object') {
      parseEntryBrandList(draft.brands).forEach(addName);
      for (const entry of normalizeCompanyInfoEntries(draft.companyInfoEntries || [])) {
        parseEntryBrandList(entry?.brands).forEach(addName);
      }
    }
  }

  return [...names];
}

/**
 * Merge a supplier's own brand-request rows with the approved catalog.
 * Pending (or duplicate-rejected) requests collapse to approved when any catalog
 * row for the same identity is already approved — even if another supplier owns it.
 * Pure helper so Select yourself stays in sync without requiring declared profile brands.
 */
function brandRequestRowTimestamp(row = {}) {
  return String(
    row?.updated_at ||
      row?.updatedAt ||
      row?.requested_at ||
      row?.requestedAt ||
      row?.created_at ||
      row?.createdAt ||
      ''
  );
}

function normalizeMergedBrandRequestRow(row = {}) {
  const name = String(row?.name || '').trim();
  const key = brandIdentityKey(row?.normalized_name || row?.normalizedName || name);
  if (!name || !key) return null;
  return {
    name,
    normalized_name: key,
    status: String(row?.status || 'pending').trim().toLowerCase(),
    rejectionReason: String(row?.rejection_reason || row?.rejectionReason || '').trim(),
    requestedAt:
      row?.requested_at ||
      row?.requestedAt ||
      row?.updated_at ||
      row?.created_at ||
      row?.createdAt ||
      null,
    createdAt: row?.created_at || row?.createdAt || null,
    updatedAt: row?.updated_at || row?.updatedAt || null
  };
}

export function mergeSupplierBrandRequestsWithApprovedCatalog({
  ownRows = [],
  catalogRows = [],
  declaredNames = [],
  userId = ''
} = {}) {
  const byKey = new Map();
  const uid = String(userId || '').trim();

  const upsert = (row, { force = false } = {}) => {
    const incoming = normalizeMergedBrandRequestRow(row);
    if (!incoming) return;
    const { status } = incoming;
    const key = incoming.normalized_name;
    const existing = byKey.get(key);
    const existingStatus = String(existing?.status || '').toLowerCase();
    const rank = { approved: 0, pending: 1, rejected: 2 };

    if (!force && existing) {
      const existingRank = rank[existingStatus] ?? 9;
      const incomingRank = rank[status] ?? 9;
      // Approved catalog/request rows always beat pending/rejected for the same identity.
      if (existingRank === 0 && incomingRank > 0) return;
      if (existingRank > 0 && incomingRank === 0) {
        // fall through — incoming approved replaces non-approved
      } else if (existingRank > 0 && incomingRank > 0) {
        // Admin reject/resubmit must not leave stale pending when a newer row exists.
        const existingTs = brandRequestRowTimestamp(existing);
        const incomingTs = brandRequestRowTimestamp(incoming);
        if (incomingTs <= existingTs) return;
      } else if (existingRank < incomingRank) {
        return;
      }
    }

    byKey.set(key, incoming);
  };

  for (const row of ownRows || []) {
    if (
      String(row?.status || '').toLowerCase() === 'rejected' &&
      isDuplicateOfApprovedRejection(row?.rejection_reason || row?.rejectionReason)
    ) {
      continue;
    }
    upsert(row);
  }

  const ownKeys = new Set(byKey.keys());
  const declaredKeys = new Set(
    (Array.isArray(declaredNames) ? declaredNames : [])
      .map((name) => brandIdentityKey(name))
      .filter(Boolean)
  );
  const eligibleKeys = new Set([...ownKeys, ...declaredKeys]);

  for (const row of catalogRows || []) {
    const key = brandIdentityKey(row?.normalized_name || row?.normalizedName || row?.name);
    if (!key || !eligibleKeys.has(key)) continue;
    const status = String(row?.status || '').toLowerCase();
    const requestedBy = String(row?.requested_by || row?.requestedBy || '').trim();
    if (uid && requestedBy === uid) {
      if (
        status === 'rejected' &&
        isDuplicateOfApprovedRejection(row?.rejection_reason || row?.rejectionReason)
      ) {
        continue;
      }
      upsert(row);
      continue;
    }
    // Surface another account's row only when it is approved for a brand this supplier
    // already requested or declared. Never attach someone else's pending/rejected request.
    if (status === 'approved') {
      upsert(row);
    }
  }

  return [...byKey.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Brand requests submitted by this supplier (any status).
 * Used to hide rejected brands from Step 2 dropdown and block false "approved" matches.
 */
export async function fetchSupplierBrandRequests(userId, profileContext = null) {
  if (!userId) return [];

  try {
    const { data: requestedRows, error: requestedError } = await supabase
      .from('brands')
      .select('name, normalized_name, status, rejection_reason, requested_by, requested_at, updated_at, created_at')
      .eq('requested_by', userId);
    if (requestedError) throw requestedError;

    const declaredNames = collectDeclaredBrandNamesFromProfiles(profileContext);
    const ownKeys = new Set(
      (requestedRows || [])
        .map((row) => brandIdentityKey(row?.normalized_name || row?.name))
        .filter(Boolean)
    );
    const declaredKeys = new Set(declaredNames.map((name) => brandIdentityKey(name)).filter(Boolean));
    const needsCatalogMerge = ownKeys.size > 0 || declaredKeys.size > 0;

    let catalogRows = [];
    if (needsCatalogMerge) {
      // Match in memory with exact catalog keys. Misspellings stay separate brands.
      const { data: allBrandRows, error: allBrandError } = await supabase
        .from('brands')
        .select('name, normalized_name, status, rejection_reason, requested_by, requested_at, updated_at, created_at');
      if (allBrandError) throw allBrandError;
      catalogRows = allBrandRows || [];
    }

    return mergeSupplierBrandRequestsWithApprovedCatalog({
      ownRows: requestedRows || [],
      catalogRows,
      declaredNames,
      userId
    });
  } catch (e) {
    console.error('[supplierChainProfile] fetchSupplierBrandRequests:', e?.message || e);
    return [];
  }
}

/**
 * Admin-approved brands for this supplier.
 * Includes brands they requested and were approved — never brands they requested that were rejected
 * (except duplicate-of-approved merges, which unlock the canonical approved brand).
 */
export async function fetchSupplierApprovedBrands(userId, profileContext = null) {
  if (!userId) return [];
  const byKey = new Map();

  const addRows = (rows = []) => {
    for (const row of rows) {
      const name = String(row?.name || '').trim();
      const key = brandIdentityKey(row?.normalized_name || name);
      if (!name || !key || String(row?.status || '').toLowerCase() !== 'approved') continue;
      if (!byKey.has(key)) byKey.set(key, { name, normalized_name: key, status: 'approved' });
    }
  };

  try {
    const brandRequests = await fetchSupplierBrandRequests(userId, profileContext);
    const rejectedKeys = new Set(
      brandRequests
        .filter((row) => String(row?.status || '').toLowerCase() === 'rejected')
        .filter((row) => !isDuplicateOfApprovedRejection(row?.rejectionReason))
        .map((row) => brandIdentityKey(row?.normalized_name || row?.name))
        .filter(Boolean)
    );

    // Requests that already collapsed to approved (own row or catalog twin).
    addRows(brandRequests.filter((row) => String(row?.status || '').toLowerCase() === 'approved'));

    const { data: requestedRows, error: requestedError } = await supabase
      .from('brands')
      .select('name, normalized_name, status')
      .eq('requested_by', userId)
      .eq('status', 'approved');
    if (requestedError) throw requestedError;
    addRows(requestedRows);

    const declaredNames = collectDeclaredBrandNamesFromProfiles(profileContext);
    const requestKeys = new Set(
      brandRequests
        .map((row) => brandIdentityKey(row?.normalized_name || row?.name))
        .filter(Boolean)
    );
    const declaredKeys = new Set(declaredNames.map((name) => brandIdentityKey(name)).filter(Boolean));
    const eligibleKeys = new Set([...requestKeys, ...declaredKeys]);

    if (eligibleKeys.size > 0) {
      const { data: approvedRows, error: approvedError } = await supabase
        .from('brands')
        .select('name, normalized_name, status')
        .eq('status', 'approved');
      if (approvedError) throw approvedError;

      const eligibleRows = (approvedRows || []).filter((row) => {
        const key = brandIdentityKey(row?.normalized_name || row?.name);
        return key && eligibleKeys.has(key) && !rejectedKeys.has(key);
      });
      addRows(eligibleRows);
    }

    return [...byKey.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } catch (e) {
    console.error('[supplierChainProfile] fetchSupplierApprovedBrands:', e?.message || e);
    return [];
  }
}

/**
 * Add stub chain entries for admin-approved brands missing from companyInfoEntries.
 * Does not remove or overwrite existing entries.
 */
export function mergeApprovedBrandsIntoChainEntries(chainProfile, approvedBrandRows = []) {
  const base = chainProfile || {};
  const entries = [...normalizeCompanyInfoEntries(base.companyInfoEntries || [])];
  const addedNames = [];

  for (const row of approvedBrandRows) {
    const name = String(row?.name || '').trim();
    if (!name || String(row?.status || 'approved').toLowerCase() !== 'approved') continue;
    if (entries.some((entry) => chainEntryMatchesBrand(entry, name))) continue;
    if (addedNames.some((added) => chainEntryMatchesBrand({ brands: added }, name))) continue;
    entries.push(createStubBrandChainEntry(name));
    addedNames.push(name);
  }

  return {
    ...base,
    companyInfoEntries: entries,
    brands: base.brands || entries[0]?.brands || ''
  };
}

/** No-op for saved profile: approved brands are exposed via adminApprovedBrands, not auto form rows. */
export async function syncApprovedBrandsIntoUserProfile(userId, profile) {
  return profile || {};
}

/** Load saved profile merged with any pending chain submission and approved brands. */
export async function loadEffectiveSupplierChainProfile(userId, profile) {
  const pending = await fetchPendingChainRequest(userId);
  const effective = buildEffectiveSupplierChainProfile(profile, pending?.payload || null);
  const approvedBrands = await fetchSupplierApprovedBrands(userId, profile);
  return mergeApprovedBrandsIntoChainEntries(effective, approvedBrands);
}

export function baselineChainFromProfile(profile) {
  const p = profile || {};
  let entries = normalizeCompanyInfoEntries(p.companyInfoEntries || []);
  if (entries.length === 0) {
    const legacyHasValues = Boolean(
      String(p.supplierRole || '').trim() ||
      String(p.brands || '').trim() ||
      String(p.gstin || '').trim() ||
      String(p.companyName || '').trim() ||
      String(p.ownershipDetails || '').trim() ||
      String(p.brandApprovalDocumentUrl || '').trim() ||
      (Array.isArray(p.brandApprovalDocumentUrls) && p.brandApprovalDocumentUrls.length > 0) ||
      String(p.authorizationCertificateUrl || '').trim() ||
      (Array.isArray(p.authorizationCertificateUrls) && p.authorizationCertificateUrls.length > 0) ||
      (p.minimumOrderValue !== '' && p.minimumOrderValue !== null && p.minimumOrderValue !== undefined)
    );
    if (legacyHasValues) {
      entries = normalizeCompanyInfoEntries([
        {
          role: String(p.supplierRole || '').trim(),
          brands: typeof p.brands === 'string' ? p.brands : '',
          gstin: String(p.gstin || '').trim(),
          companyName: String(p.companyName || '').trim(),
          ownershipDetails: String(p.ownershipDetails || '').trim(),
          brandApprovalDocumentUrl: String(p.brandApprovalDocumentUrl || '').trim(),
          brandApprovalDocumentUrls: Array.isArray(p.brandApprovalDocumentUrls)
            ? p.brandApprovalDocumentUrls
            : [],
          authorizationCertificateUrl: String(p.authorizationCertificateUrl || '').trim(),
          authorizationCertificateUrls: Array.isArray(p.authorizationCertificateUrls)
            ? p.authorizationCertificateUrls
            : [],
          minimumOrderValue: p.minimumOrderValue ?? ''
        }
      ]);
    }
  }
  return {
    supplierRole: String(p.supplierRole || '').trim(),
    brands: typeof p.brands === 'string' ? p.brands : p.brands ? String(p.brands) : '',
    companyInfoEntries: entries
  };
}

/** Fields that require admin review when changed (MOV is supplier-editable anytime). */
export function chainApprovalSignature(payload) {
  const p = payload || {};
  const entries = (p.companyInfoEntries || []).map((e) => ({
    id: String(e?.id || '').trim(),
    role: String(e?.role || '').trim(),
    brands: String(e?.brands || '').trim(),
    gstin: String(e?.gstin || '').trim(),
    companyName: String(e?.companyName || '').trim(),
    ownershipDetails: String(e?.ownershipDetails || '').trim()
  }));
  return JSON.stringify({
    supplierRole: String(p.supplierRole || '').trim(),
    brands: String(p.brands || '').trim(),
    entries
  });
}

/** @deprecated Use chainApprovalSignature — kept for imports/tests. */
export function chainPayloadSignature(payload) {
  return chainApprovalSignature(payload);
}

function matchBaselineChainEntry(baselineEntries, entry) {
  const id = String(entry?.id || '').trim();
  if (id) {
    const byId = (baselineEntries || []).find((row) => String(row?.id || '').trim() === id);
    if (byId) return byId;
  }
  const brandKey = normalizeBrandKey(entry?.brands);
  if (!brandKey) return null;
  return (baselineEntries || []).find((row) => normalizeBrandKey(row?.brands) === brandKey) || null;
}

/** Role changes on brands that already had an approved role. */
export function detectSupplyChainRoleChanges(baseline, incoming) {
  const baselineEntries = baseline?.companyInfoEntries || [];
  const incomingEntries = incoming?.companyInfoEntries || [];
  const changes = [];

  for (const entry of incomingEntries) {
    const nextRole = String(entry?.role || '').trim();
    if (!nextRole) continue;
    const baselineEntry = matchBaselineChainEntry(baselineEntries, entry);
    const previousRole = String(baselineEntry?.role || '').trim();
    if (previousRole && previousRole !== nextRole) {
      changes.push({
        entryId: entry?.id || null,
        brand: String(entry?.brands || '').trim(),
        fromRole: previousRole,
        toRole: nextRole
      });
    }
  }

  return changes;
}

export function chainRequiresAdminApproval(baseline, incoming) {
  if (chainApprovalSignature(baseline) !== chainApprovalSignature(incoming)) {
    return true;
  }
  return detectSupplyChainRoleChanges(baseline, incoming).length > 0;
}

/** Apply supplier-editable per-entry fields (MOV) without disturbing approved chain metadata. */
export function mergeSupplierEditableEntrySave(baseline, incoming, saveSupplyChainEntryId) {
  const saveEntryId = String(saveSupplyChainEntryId || '').trim();
  if (!saveEntryId) {
    return incoming;
  }

  const incomingEntries = normalizeCompanyInfoEntries(incoming?.companyInfoEntries || []);
  const incomingEntry = incomingEntries.find((entry) => String(entry?.id || '').trim() === saveEntryId);
  if (!incomingEntry) {
    return baseline;
  }

  const mergedEntries = normalizeCompanyInfoEntries(baseline?.companyInfoEntries || []).map((entry) => {
    if (String(entry?.id || '').trim() !== saveEntryId) {
      return entry;
    }
    const next = { ...entry };
    if (
      incomingEntry.minimumOrderValue !== undefined &&
      incomingEntry.minimumOrderValue !== null &&
      incomingEntry.minimumOrderValue !== ''
    ) {
      next.minimumOrderValue = incomingEntry.minimumOrderValue;
    } else {
      delete next.minimumOrderValue;
    }
    return next;
  });

  return {
    ...baseline,
    companyInfoEntries: mergedEntries
  };
}

export function syncLegacyMinimumOrderValue(profileUpdate, incomingChain, options = {}) {
  const entries = Array.isArray(incomingChain?.companyInfoEntries)
    ? incomingChain.companyInfoEntries
    : [];
  const saveEntryId = String(options.saveSupplyChainEntryId || '').trim();
  const target =
    (saveEntryId && entries.find((entry) => String(entry?.id || '').trim() === saveEntryId)) ||
    entries.find((entry) => entry?.minimumOrderValue != null && entry.minimumOrderValue !== '') ||
    entries[0] ||
    null;
  if (!target) return profileUpdate;
  const mov = target.minimumOrderValue;
  profileUpdate.minimumOrderValue =
    mov != null && mov !== '' && Number.isFinite(Number(mov)) ? Number(mov) : '';
  return profileUpdate;
}

export function hasAnySupplyChainRole(payload) {
  const p = payload || {};
  if (String(p.supplierRole || '').trim() && ROLE_SET.has(String(p.supplierRole || '').trim())) return true;
  return (p.companyInfoEntries || []).some((e) => {
    const r = String(e?.role || '').trim();
    return r && ROLE_SET.has(r);
  });
}

export async function fetchPendingChainRequest(userId) {
  try {
    const { data, error } = await supabase
      .from('supplier_chain_profile_requests')
      .select('id, payload, status, rejection_reason, created_at, updated_at')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (e) {
    console.error('[supplierChainProfile] fetchPendingChainRequest:', e?.message || e);
    return null;
  }
}

export async function replacePendingChainRequest(userId, payload) {
  await supabase.from('supplier_chain_profile_requests').delete().eq('user_id', userId).eq('status', 'pending');
  const { data, error } = await supabase
    .from('supplier_chain_profile_requests')
    .insert({
      user_id: userId,
      payload,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function clearPendingChainRequest(userId) {
  await supabase.from('supplier_chain_profile_requests').delete().eq('user_id', userId).eq('status', 'pending');
}

export async function fetchLatestRejectedChainRequest(userId) {
  try {
    const { data, error } = await supabase
      .from('supplier_chain_profile_requests')
      .select('id, rejection_reason, reviewed_at')
      .eq('user_id', userId)
      .eq('status', 'rejected')
      .order('reviewed_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch {
    return null;
  }
}

/** Most recent request row (any status), for UI hints */
export async function fetchLatestChainRequest(userId) {
  try {
    const { data, error } = await supabase
      .from('supplier_chain_profile_requests')
      .select('id, status, rejection_reason, reviewed_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch {
    return null;
  }
}
