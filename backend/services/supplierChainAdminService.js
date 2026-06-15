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

function chainEntryReviewSignature(entry) {
  const e = entry || {};
  return JSON.stringify({
    role: String(e?.role || '').trim(),
    brands: String(e?.brands || '').trim(),
    gstin: String(e?.gstin || '').trim(),
    companyName: String(e?.companyName || '').trim(),
    authorizationCertificateUrls: resolveAuthorizationCertificateUrls(e),
    minimumOrderValue: e?.minimumOrderValue ?? null
  });
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

/** Only entries that actually changed vs approved baseline go to admin review. */
export function buildAdminReviewChainPayload(baseline, incoming) {
  const baselineEntries = baseline?.companyInfoEntries || [];
  const incomingEntries = incoming?.companyInfoEntries || [];
  const reviewEntries = [];

  for (const entry of incomingEntries) {
    const role = String(entry?.role || '').trim();
    const brand = String(entry?.brands || '').trim();
    if (!role || !brand) continue;

    const baselineEntry = matchBaselineChainEntry(baselineEntries, entry);
    if (chainEntryReviewSignature(entry) !== chainEntryReviewSignature(baselineEntry || {})) {
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

function reviewableEntries(payload) {
  return normalizeCompanyInfoEntries(payload?.companyInfoEntries || []).filter(
    (entry) => String(entry?.role || '').trim() && String(entry?.brands || '').trim()
  );
}

export function buildBrandReviewItems(requestRows = [], userMap = {}) {
  const items = [];

  for (const row of requestRows) {
    const user = userMap[row.user_id] || null;
    const payload = row?.payload || {};
    const baseline = baselineChainFromProfile(user?.profile || {});
    const roleChanges = detectSupplyChainRoleChanges(baseline, payload);
    const entries = reviewableEntries(payload);

    for (const entry of entries) {
      const brand = String(entry?.brands || '').trim();
      const role = String(entry?.role || '').trim();
      const entryId = String(entry?.id || '').trim();
      const roleChange =
        roleChanges.find((change) => catalogBrandDedupKey(change.brand) === catalogBrandDedupKey(brand)) ||
        null;

      items.push({
        id: `${row.id}:${entryId || brand}`,
        requestId: row.id,
        entryId,
        userId: row.user_id,
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
        status: String(row?.status || 'pending'),
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
        canAct: String(row?.status || '') === 'pending'
      });
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

  const targetEntry = findPayloadEntry(reqRow.payload || {}, { entryId, brand });
  if (!targetEntry || !String(targetEntry?.role || '').trim()) {
    return { ok: false, code: 'entry_not_found', message: 'Brand entry not found in this request' };
  }

  const { data: userRow, error: uErr } = await supabase
    .from('users')
    .select('id, profile')
    .eq('id', reqRow.user_id)
    .single();

  if (uErr || !userRow) {
    return { ok: false, code: 'supplier_not_found', message: 'Supplier not found' };
  }

  const mergedProfile = mergeEntryIntoProfile(userRow.profile || {}, targetEntry);
  const { error: upUserErr } = await supabase
    .from('users')
    .update({ profile: mergedProfile })
    .eq('id', reqRow.user_id);

  if (upUserErr) throw upUserErr;

  const nextPayload = removePayloadEntry(reqRow.payload || {}, targetEntry);
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

  const targetEntry = findPayloadEntry(reqRow.payload || {}, { entryId, brand });
  if (!targetEntry) {
    return { ok: false, code: 'entry_not_found', message: 'Brand entry not found in this request' };
  }

  const nextPayload = removePayloadEntry(reqRow.payload || {}, targetEntry);
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
