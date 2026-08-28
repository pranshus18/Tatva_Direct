import { supabase } from '../config/supabase.js';
import { resolveAuthorizationCertificateUrls, resolveRoleVerificationDocumentUrls } from '../utils/authorizationCertificateUrls.js';
import { catalogBrandDedupKey } from './supplyChainSharedService.js';
import {
  baselineChainFromProfile,
  detectSupplyChainRoleChanges,
  normalizeCompanyInfoEntries
} from './supplierChainProfileService.js';

const ROLE_LABELS = {
  manufacturer: 'Manufacturer (MGF)',
  stockist: 'Stockist',
  regional_distributor: 'Regional distributor',
  local_distributor: 'Local distributor',
  dealer: 'Dealer',
  retailer: 'Retailer'
};

function formatRoleLabel(role) {
  const key = String(role || '').trim();
  if (!key) return '—';
  return ROLE_LABELS[key] || key;
}

function matchBaselineChainEntry(baselineEntries, entry) {
  const id = String(entry?.id || '').trim();
  if (id) {
    const byId = (baselineEntries || []).find((row) => String(row?.id || '').trim() === id);
    if (byId) return byId;
  }
  const brandKey = catalogBrandDedupKey(entry?.brands);
  if (!brandKey) return null;
  return (baselineEntries || []).find((row) => catalogBrandDedupKey(row?.brands) === brandKey) || null;
}

/** True when this brand needs admin review (new role, role change, or new verification docs). */
export function entryNeedsAdminReview(baselineEntry, pendingEntry) {
  const pendingRole = String(pendingEntry?.role || '').trim();
  const brand = String(pendingEntry?.brands || '').trim();
  if (!pendingRole || !brand) return false;

  const baselineRole = String(baselineEntry?.role || '').trim();
  if (!baselineRole) return true;
  if (pendingRole !== baselineRole) return true;

  const baselineDocs = resolveRoleVerificationDocumentUrls(baselineEntry || {});
  const pendingDocs = resolveRoleVerificationDocumentUrls(pendingEntry || {});
  if (baselineDocs.length !== pendingDocs.length) return true;
  const baselineSet = new Set(baselineDocs);
  return pendingDocs.some((url) => !baselineSet.has(url));
}

/** Only entries that need review vs the supplier's currently approved profile. */
export function buildAdminReviewChainPayload(baseline, incoming) {
  const baselineEntries = baseline?.companyInfoEntries || [];
  const incomingEntries = normalizeCompanyInfoEntries(incoming?.companyInfoEntries || []);
  const reviewEntries = [];

  for (const entry of incomingEntries) {
    const baselineEntry = matchBaselineChainEntry(baselineEntries, entry);
    if (entryNeedsAdminReview(baselineEntry, entry)) {
      reviewEntries.push(entry);
    }
  }

  const first = reviewEntries[0] || {};
  return {
    supplierRole: String(first?.role || '').trim(),
    brands: String(first?.brands || '').trim(),
    companyInfoEntries: reviewEntries
  };
}

export function resolveReviewPayloadForRequest(userProfile, storedPayload) {
  const baseline = baselineChainFromProfile(userProfile || {});
  return buildAdminReviewChainPayload(baseline, storedPayload || {});
}

function reviewableEntries(payload) {
  return normalizeCompanyInfoEntries(payload?.companyInfoEntries || []).filter(
    (entry) => String(entry?.role || '').trim() && String(entry?.brands || '').trim()
  );
}

/** Approved supply-chain rows saved on the supplier profile (includes legacy single-field profiles). */
export function collectApprovedChainEntriesFromProfile(profile) {
  const baseline = baselineChainFromProfile(profile || {});
  return reviewableEntries({ companyInfoEntries: baseline.companyInfoEntries || [] });
}

function buildLatestApprovedRequestIdByUser(requestRows = []) {
  const latestByUser = new Map();
  for (const row of requestRows || []) {
    if (String(row?.status || '') !== 'approved') continue;
    const userId = String(row?.user_id || '').trim();
    if (!userId) continue;
    const ts = String(row?.reviewed_at || row?.created_at || '');
    const prev = latestByUser.get(userId);
    if (!prev || ts > String(prev.ts || '')) {
      latestByUser.set(userId, { id: row?.id || null, ts });
    }
  }
  return latestByUser;
}

export async function syncPendingRequestPayloads(requestRows = [], userMap = {}) {
  const updates = [];

  for (const row of requestRows) {
    if (String(row?.status || '') !== 'pending') continue;
    const user = userMap[row.user_id] || null;
    if (!user) continue;

    const pruned = resolveReviewPayloadForRequest(user.profile || {}, row.payload || {});
    const storedEntries = reviewableEntries(row.payload || {});
    const prunedEntries = reviewableEntries(pruned);
    const storedKeys = new Set(
      storedEntries.map((entry) => catalogBrandDedupKey(entry?.brands)).filter(Boolean)
    );
    const prunedKeys = new Set(
      prunedEntries.map((entry) => catalogBrandDedupKey(entry?.brands)).filter(Boolean)
    );
    const keysMatch =
      storedKeys.size === prunedKeys.size && [...storedKeys].every((key) => prunedKeys.has(key));
    if (keysMatch) continue;

    const nowIso = new Date().toISOString();
    const updatePayload =
      prunedEntries.length === 0
        ? {
            payload: pruned,
            status: 'approved',
            reviewed_at: nowIso,
            updated_at: nowIso,
            rejection_reason: null
          }
        : {
            payload: pruned,
            updated_at: nowIso
          };

    const { error } = await supabase
      .from('supplier_chain_profile_requests')
      .update(updatePayload)
      .eq('id', row.id)
      .eq('status', 'pending');

    if (!error) {
      row.payload = pruned;
      if (prunedEntries.length === 0) {
        row.status = 'approved';
        row.reviewed_at = nowIso;
        row.rejection_reason = null;
      }
      updates.push(row.id);
    }
  }

  return updates;
}

export function documentsFromChainEntry(entry) {
  const role = formatRoleLabel(entry?.role);
  const brand = String(entry?.brands || '').trim();
  const label = brand ? `${role} — ${brand}` : role;

  return resolveAuthorizationCertificateUrls(entry).map((url) => ({
    url,
    label,
    fileName: url.split('/').pop() || 'Document'
  }));
}

function findPayloadEntry(payload, { entryId, brand }) {
  const entries = normalizeCompanyInfoEntries(payload?.companyInfoEntries || []);
  const wantedId = String(entryId || '').trim();
  const wantedBrandKey = catalogBrandDedupKey(brand);

  if (wantedId) {
    const byId = entries.find((row) => String(row?.id || '').trim() === wantedId);
    if (byId) return byId;
  }
  if (wantedBrandKey) {
    return entries.find((row) => catalogBrandDedupKey(row?.brands) === wantedBrandKey) || null;
  }
  return null;
}

function removePayloadEntry(payload, targetEntry) {
  const targetId = String(targetEntry?.id || '').trim();
  const targetBrandKey = catalogBrandDedupKey(targetEntry?.brands);
  const remaining = normalizeCompanyInfoEntries(payload?.companyInfoEntries || []).filter((row) => {
    if (targetId && String(row?.id || '').trim() === targetId) return false;
    if (targetBrandKey && catalogBrandDedupKey(row?.brands) === targetBrandKey) return false;
    return true;
  });

  const first = remaining[0] || {};
  return {
    ...(payload || {}),
    supplierRole: String(first?.role || '').trim(),
    brands: String(first?.brands || '').trim(),
    companyInfoEntries: remaining
  };
}

function listResolvedPayloadEntries(payload = {}) {
  return normalizeCompanyInfoEntries(payload?.resolvedEntries || []).filter(
    (entry) => String(entry?.role || '').trim() && String(entry?.brands || '').trim()
  );
}

/** Move a pending brand into request history so admin still sees it after approve/reject. */
export function appendResolvedPayloadEntry(payload, entry, decision = {}) {
  const resolved = listResolvedPayloadEntries(payload).map((row) => ({ ...row }));
  resolved.push({
    ...entry,
    reviewStatus: decision.status || 'approved',
    reviewedAt: decision.reviewedAt || null,
    rejectionReason: String(decision.rejectionReason || '').trim()
  });
  const next = removePayloadEntry(payload, entry);
  return { ...next, resolvedEntries: resolved };
}

export function snapshotPayloadEntriesAsResolved(payload, entries = [], decision = {}) {
  const resolved = listResolvedPayloadEntries(payload).map((row) => ({ ...row }));
  for (const entry of entries || []) {
    if (!String(entry?.role || '').trim() || !String(entry?.brands || '').trim()) continue;
    resolved.push({
      ...entry,
      reviewStatus: decision.status || 'approved',
      reviewedAt: decision.reviewedAt || null,
      rejectionReason: String(decision.rejectionReason || '').trim()
    });
  }
  return { ...(payload || {}), resolvedEntries: resolved };
}

function mergeEntryIntoProfile(profile, approvedEntry) {
  const entries = normalizeCompanyInfoEntries(profile?.companyInfoEntries || []);
  const approvedRows = normalizeCompanyInfoEntries([approvedEntry]);
  const approved = approvedRows[0];
  if (!approved) return profile || {};

  const targetId = String(approved.id || '').trim();
  const targetBrandKey = catalogBrandDedupKey(approved.brands);

  let found = false;
  const merged = entries.map((row) => {
    const idMatch = targetId && String(row?.id || '').trim() === targetId;
    const brandMatch = targetBrandKey && catalogBrandDedupKey(row?.brands) === targetBrandKey;
    if (idMatch || brandMatch) {
      found = true;
      return { ...row, ...approved, id: row.id || approved.id };
    }
    return row;
  });

  if (!found) merged.push(approved);

  const first = merged[0] || {};
  return {
    ...(profile || {}),
    companyInfoEntries: merged,
    supplierRole: String(first?.role || '').trim() || profile?.supplierRole || '',
    brands: String(first?.brands || '').trim() || profile?.brands || ''
  };
}

function buildReviewItem({ row = null, entry, user, roleChange = null, source = 'request' }) {
  const brand = String(entry?.brands || '').trim();
  const role = String(entry?.role || '').trim();
  const entryId = String(entry?.id || '').trim();
  const rowStatus = String(entry?.reviewStatus || row?.status || 'approved');
  const userId = row?.user_id || user?.id || null;
  const submittedAt = entry?.submittedAt || row?.created_at || null;
  const reviewedAt = entry?.reviewedAt || row?.reviewed_at || null;

  return {
    id: `${source}:${row?.id || userId}:${entryId || brand}:${role}:${rowStatus}:${submittedAt || reviewedAt || 'na'}`,
    requestId: row?.id || null,
    entryId,
    userId,
    brand,
    role,
    roleLabel: formatRoleLabel(role),
    roleChange: roleChange
      ? {
          fromRole: roleChange.fromRole,
          toRole: roleChange.toRole,
          fromRoleLabel: formatRoleLabel(roleChange.fromRole),
          toRoleLabel: formatRoleLabel(roleChange.toRole)
        }
      : null,
    documents: documentsFromChainEntry(entry),
    status: rowStatus,
    submittedAt,
    reviewedAt,
    rejectionReason: String(entry?.rejectionReason || row?.rejection_reason || '').trim(),
    user: user
      ? {
          id: user.id,
          name: user.name || '',
          email: user.email || '',
          company: user.company || ''
        }
      : null,
    canAct: rowStatus === 'pending'
  };
}

function assignmentKey(item) {
  return `${item.userId}:${catalogBrandDedupKey(item.brand)}:${item.role}`;
}

function reviewItemDedupeKey(item) {
  if (item?.requestId) {
    return `${item.requestId}:${assignmentKey(item)}:${item.status}:${item.submittedAt || ''}`;
  }
  return `live:${assignmentKey(item)}`;
}

/** Saved supplier profile entries — source of truth for approved assignments. */
export function buildApprovedProfileItems(userMap = {}, options = {}) {
  const items = [];
  const requestRows = Array.isArray(options.requestRows) ? options.requestRows : [];

  for (const user of Object.values(userMap)) {
    if (String(user?.user_type || '') !== 'supplier') continue;
    for (const entry of collectApprovedChainEntriesFromProfile(user?.profile || {})) {
      const reviewMeta = reviewMetaForLiveAssignment(requestRows, user.id, entry?.brands);
      items.push(
        buildReviewItem({
          row: {
            status: 'approved',
            user_id: user.id,
            created_at: reviewMeta.submittedAt,
            reviewed_at: reviewMeta.reviewedAt
          },
          entry: {
            ...entry,
            reviewedAt: reviewMeta.reviewedAt || entry?.reviewedAt || null,
            submittedAt: reviewMeta.submittedAt || entry?.submittedAt || null
          },
          user,
          source: 'live'
        })
      );
    }
  }

  return items;
}

function reviewMetaForLiveAssignment(requestRows, userId, brand) {
  const brandKey = catalogBrandDedupKey(brand);
  let submittedAt = null;
  let reviewedAt = null;
  for (const row of requestRows || []) {
    if (String(row?.user_id || '') !== String(userId || '')) continue;
    const resolved = listResolvedPayloadEntries(row?.payload || {});
    const pending = reviewableEntries(row?.payload || {});
    const matchesBrand = [...resolved, ...pending].some(
      (entry) => catalogBrandDedupKey(entry?.brands) === brandKey
    );
    const emptyClosedApproved =
      String(row?.status || '') === 'approved' && resolved.length === 0 && pending.length === 0;
    if (!matchesBrand && !emptyClosedApproved) continue;

    const created = row?.created_at || null;
    const reviewed = row?.reviewed_at || null;
    if (created && (!submittedAt || String(created) > String(submittedAt))) submittedAt = created;
    if (reviewed && (!reviewedAt || String(reviewed) > String(reviewedAt))) reviewedAt = reviewed;
  }
  return { submittedAt, reviewedAt };
}

function historyEntriesFromRequest(row, { user = null, isLatestApprovedForUser = false } = {}) {
  const resolved = listResolvedPayloadEntries(row?.payload || {});
  if (resolved.length > 0) return resolved;

  const payloadEntries = reviewableEntries(row?.payload || {});
  const rowStatus = String(row?.status || '');

  if (payloadEntries.length > 0 && (rowStatus === 'approved' || rowStatus === 'rejected')) {
    return payloadEntries.map((entry) => ({
      ...entry,
      reviewStatus: rowStatus,
      reviewedAt: row?.reviewed_at || null,
      rejectionReason: row?.rejection_reason || ''
    }));
  }

  // Legacy rows: approve flow cleared payload before resolvedEntries existed.
  if (rowStatus === 'approved' && isLatestApprovedForUser && user) {
    return collectApprovedChainEntriesFromProfile(user?.profile || {}).map((entry) => ({
      ...entry,
      reviewStatus: 'approved',
      reviewedAt: row?.reviewed_at || null,
      submittedAt: row?.created_at || null
    }));
  }

  return [];
}

export function buildBrandReviewItems(requestRows = [], userMap = {}, options = {}) {
  const statusFilter = String(options.statusFilter || 'pending').trim().toLowerCase();
  const items = [];
  const seen = new Set();
  const approvedAssignmentKeys = new Set();
  const latestApprovedRequestByUser = buildLatestApprovedRequestIdByUser(requestRows);

  const pushItem = (item) => {
    const key = reviewItemDedupeKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
    if (item.status === 'approved') {
      approvedAssignmentKeys.add(assignmentKey(item));
    }
  };

  const includePending = statusFilter === 'pending' || statusFilter === 'all';
  const includeApproved = statusFilter === 'approved' || statusFilter === 'all';
  const includeRejected = statusFilter === 'rejected' || statusFilter === 'all';

  for (const row of requestRows) {
    const rowStatus = String(row?.status || 'pending');
    const user = userMap[row.user_id] || null;
    const baseline = baselineChainFromProfile(user?.profile || {});

    if (includePending && rowStatus === 'pending') {
      const reviewPayload = resolveReviewPayloadForRequest(user?.profile || {}, row?.payload || {});
      const roleChanges = detectSupplyChainRoleChanges(baseline, reviewPayload);

      for (const entry of reviewableEntries(reviewPayload)) {
        const baselineEntry = matchBaselineChainEntry(baseline.companyInfoEntries || [], entry);
        if (!entryNeedsAdminReview(baselineEntry, entry)) continue;

        const brand = String(entry?.brands || '').trim();
        const roleChange =
          roleChanges.find((change) => catalogBrandDedupKey(change.brand) === catalogBrandDedupKey(brand)) ||
          null;

        pushItem(buildReviewItem({ row, entry, user, roleChange, source: 'request' }));
      }
    }

    if (includeApproved || includeRejected) {
      const userId = String(row?.user_id || '').trim();
      const latestApproved = latestApprovedRequestByUser.get(userId);
      const isLatestApprovedForUser =
        rowStatus === 'approved' && latestApproved?.id && String(latestApproved.id) === String(row?.id || '');
      for (const entry of historyEntriesFromRequest(row, {
        user,
        isLatestApprovedForUser
      })) {
        const historyStatus = String(entry?.reviewStatus || rowStatus || '').toLowerCase();
        if (historyStatus === 'approved' && includeApproved) {
          pushItem(buildReviewItem({ row, entry, user, source: 'history' }));
        }
        if (historyStatus === 'rejected' && includeRejected) {
          pushItem(buildReviewItem({ row, entry, user, source: 'history' }));
        }
      }
    }
  }

  if (includeApproved) {
    for (const item of buildApprovedProfileItems(userMap, { requestRows })) {
      if (approvedAssignmentKeys.has(assignmentKey(item))) continue;
      pushItem(item);
    }
  }

  const statusRank = (status) => {
    if (status === 'pending') return 0;
    if (status === 'rejected') return 1;
    return 2;
  };
  items.sort((a, b) => {
    const rankDiff = statusRank(a.status) - statusRank(b.status);
    if (rankDiff !== 0) return rankDiff;
    return String(b.submittedAt || b.reviewedAt || '').localeCompare(String(a.submittedAt || a.reviewedAt || ''));
  });

  return items;
}

export async function approveBrandReviewItem({ requestId, entryId, brand, adminUserId }) {
  const { data: reqRow, error: rErr } = await supabase
    .from('supplier_chain_profile_requests')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .maybeSingle();

  if (rErr) throw rErr;
  if (!reqRow) {
    return { ok: false, code: 'not_found', message: 'Pending request not found' };
  }

  const { data: userRow, error: uErr } = await supabase
    .from('users')
    .select('id, profile')
    .eq('id', reqRow.user_id)
    .single();

  if (uErr || !userRow) {
    return { ok: false, code: 'supplier_not_found', message: 'Supplier not found' };
  }

  const reviewPayload = resolveReviewPayloadForRequest(userRow.profile || {}, reqRow.payload || {});
  const targetEntry = findPayloadEntry(reviewPayload, { entryId, brand });
  if (!targetEntry || !String(targetEntry?.role || '').trim()) {
    return {
      ok: false,
      code: 'entry_not_found',
      message: 'This brand is not awaiting approval or is already approved.'
    };
  }

  const baseline = baselineChainFromProfile(userRow.profile || {});
  const baselineEntry = matchBaselineChainEntry(baseline.companyInfoEntries || [], targetEntry);
  if (!entryNeedsAdminReview(baselineEntry, targetEntry)) {
    return {
      ok: false,
      code: 'already_approved',
      message: 'This brand supply-chain role is already approved.'
    };
  }

  const mergedProfile = mergeEntryIntoProfile(userRow.profile || {}, targetEntry);
  const { error: upUserErr } = await supabase
    .from('users')
    .update({ profile: mergedProfile })
    .eq('id', reqRow.user_id);

  if (upUserErr) throw upUserErr;

  const nowIso = new Date().toISOString();
  const historyPayload = appendResolvedPayloadEntry(reqRow.payload || {}, targetEntry, {
    status: 'approved',
    reviewedAt: nowIso
  });
  const nextPayload = resolveReviewPayloadForRequest(
    mergedProfile,
    historyPayload
  );
  const remaining = reviewableEntries(nextPayload);
  nextPayload.resolvedEntries = listResolvedPayloadEntries(historyPayload);

  if (remaining.length === 0) {
    const { error: upReqErr } = await supabase
      .from('supplier_chain_profile_requests')
      .update({
        status: 'approved',
        payload: nextPayload,
        reviewed_by: adminUserId,
        reviewed_at: nowIso,
        updated_at: nowIso,
        rejection_reason: null
      })
      .eq('id', requestId);

    if (upReqErr) throw upReqErr;
  } else {
    const { error: upReqErr } = await supabase
      .from('supplier_chain_profile_requests')
      .update({
        payload: nextPayload,
        updated_at: nowIso
      })
      .eq('id', requestId);

    if (upReqErr) throw upReqErr;
  }

  return {
    ok: true,
    brand: String(targetEntry?.brands || '').trim(),
    role: formatRoleLabel(targetEntry?.role),
    remainingCount: remaining.length,
    requestClosed: remaining.length === 0
  };
}

export async function rejectBrandReviewItem({ requestId, entryId, brand, reason, adminUserId }) {
  const { data: reqRow, error: rErr } = await supabase
    .from('supplier_chain_profile_requests')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .maybeSingle();

  if (rErr) throw rErr;
  if (!reqRow) {
    return { ok: false, code: 'not_found', message: 'Pending request not found' };
  }

  const { data: userRow, error: uErr } = await supabase
    .from('users')
    .select('id, profile')
    .eq('id', reqRow.user_id)
    .single();

  if (uErr || !userRow) {
    return { ok: false, code: 'supplier_not_found', message: 'Supplier not found' };
  }

  const reviewPayload = resolveReviewPayloadForRequest(userRow.profile || {}, reqRow.payload || {});
  const targetEntry = findPayloadEntry(reviewPayload, { entryId, brand });
  if (!targetEntry) {
    return {
      ok: false,
      code: 'entry_not_found',
      message: 'This brand is not awaiting approval or is already approved.'
    };
  }

  const nowIso = new Date().toISOString();
  const rejectionReason = String(reason || '').trim() || 'Rejected by admin';
  const historyPayload = appendResolvedPayloadEntry(reqRow.payload || {}, targetEntry, {
    status: 'rejected',
    reviewedAt: nowIso,
    rejectionReason
  });
  const nextPayload = resolveReviewPayloadForRequest(userRow.profile || {}, historyPayload);
  nextPayload.resolvedEntries = listResolvedPayloadEntries(historyPayload);
  const remaining = reviewableEntries(nextPayload);

  if (remaining.length === 0) {
    const { error: upReqErr } = await supabase
      .from('supplier_chain_profile_requests')
      .update({
        status: 'rejected',
        payload: nextPayload,
        rejection_reason: rejectionReason,
        reviewed_by: adminUserId,
        reviewed_at: nowIso,
        updated_at: nowIso
      })
      .eq('id', requestId);

    if (upReqErr) throw upReqErr;
  } else {
    const { error: upReqErr } = await supabase
      .from('supplier_chain_profile_requests')
      .update({
        payload: nextPayload,
        updated_at: nowIso
      })
      .eq('id', requestId);

    if (upReqErr) throw upReqErr;
  }

  return {
    ok: true,
    brand: String(targetEntry?.brands || '').trim(),
    remainingCount: remaining.length,
    requestClosed: remaining.length === 0
  };
}
