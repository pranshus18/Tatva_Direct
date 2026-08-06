import { supabase } from '../config/supabase.js';
import { resolveAuthorizationCertificateUrls } from '../utils/authorizationCertificateUrls.js';
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

/** True when this brand needs admin review (new role assignment or role change only). */
export function entryNeedsAdminReview(baselineEntry, pendingEntry) {
  const pendingRole = String(pendingEntry?.role || '').trim();
  const brand = String(pendingEntry?.brands || '').trim();
  if (!pendingRole || !brand) return false;

  const baselineRole = String(baselineEntry?.role || '').trim();
  if (!baselineRole) return true;
  return pendingRole !== baselineRole;
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
    supplierRole: String(first?.role || '').trim(),
    brands: String(first?.brands || '').trim(),
    companyInfoEntries: remaining
  };
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

function buildReviewItem({ row = null, entry, user, roleChange = null }) {
  const brand = String(entry?.brands || '').trim();
  const role = String(entry?.role || '').trim();
  const entryId = String(entry?.id || '').trim();
  const rowStatus = String(row?.status || 'approved');
  const userId = row?.user_id || user?.id || null;

  return {
    id: `${row?.id || userId}:${entryId || brand}:${role}`,
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
    submittedAt: row?.created_at || null,
    rejectionReason: row?.rejection_reason || '',
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

function reviewItemDedupeKey(item) {
  return `${item.userId}:${catalogBrandDedupKey(item.brand)}:${item.role}`;
}

/** Saved supplier profile entries — source of truth for approved assignments. */
export function buildApprovedProfileItems(userMap = {}) {
  const items = [];

  for (const user of Object.values(userMap)) {
    if (String(user?.user_type || '') !== 'supplier') continue;
    const baseline = baselineChainFromProfile(user?.profile || {});
    for (const entry of reviewableEntries({ companyInfoEntries: baseline.companyInfoEntries || [] })) {
      items.push(
        buildReviewItem({
          row: { status: 'approved', user_id: user.id },
          entry,
          user
        })
      );
    }
  }

  return items;
}

export function buildBrandReviewItems(requestRows = [], userMap = {}, options = {}) {
  const statusFilter = String(options.statusFilter || 'pending').trim().toLowerCase();
  const items = [];
  const seen = new Set();

  const pushItem = (item) => {
    const key = reviewItemDedupeKey(item);
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  if (statusFilter === 'approved') {
    for (const item of buildApprovedProfileItems(userMap)) {
      pushItem(item);
    }
    return items;
  }

  for (const row of requestRows) {
    const rowStatus = String(row?.status || 'pending');
    const user = userMap[row.user_id] || null;
    const baseline = baselineChainFromProfile(user?.profile || {});

    if (rowStatus === 'pending' && (statusFilter === 'pending' || statusFilter === 'all')) {
      const reviewPayload = resolveReviewPayloadForRequest(user?.profile || {}, row?.payload || {});
      const roleChanges = detectSupplyChainRoleChanges(baseline, reviewPayload);

      for (const entry of reviewableEntries(reviewPayload)) {
        const baselineEntry = matchBaselineChainEntry(baseline.companyInfoEntries || [], entry);
        if (!entryNeedsAdminReview(baselineEntry, entry)) continue;

        const brand = String(entry?.brands || '').trim();
        const roleChange =
          roleChanges.find((change) => catalogBrandDedupKey(change.brand) === catalogBrandDedupKey(brand)) ||
          null;

        pushItem(buildReviewItem({ row, entry, user, roleChange }));
      }
    }

    if (rowStatus === 'rejected' && (statusFilter === 'rejected' || statusFilter === 'all')) {
      for (const entry of reviewableEntries(row?.payload || {})) {
        pushItem(buildReviewItem({ row, entry, user }));
      }
    }
  }

  if (statusFilter === 'all') {
    for (const item of buildApprovedProfileItems(userMap)) {
      pushItem(item);
    }
  }

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

  const nextPayload = resolveReviewPayloadForRequest(
    mergedProfile,
    removePayloadEntry(reqRow.payload || {}, targetEntry)
  );
  const remaining = reviewableEntries(nextPayload);
  const nowIso = new Date().toISOString();

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

  const nextPayload = resolveReviewPayloadForRequest(
    userRow.profile || {},
    removePayloadEntry(reqRow.payload || {}, targetEntry)
  );
  const remaining = reviewableEntries(nextPayload);
  const nowIso = new Date().toISOString();
  const rejectionReason = String(reason || '').trim() || 'Rejected by admin';

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
