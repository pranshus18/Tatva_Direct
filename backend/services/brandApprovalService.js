import {
  catalogBrandDedupKey,
  normalizeBrandKey
} from './supplyChainSharedService.js';
import {
  findBrandByCatalogDedupKey,
  findApprovedCatalogBrandCloseMatch,
  getCanonicalBrandNormalizedName,
  pickCanonicalBrandDisplayName
} from './brandDedupService.js';
import {
  createBrand,
  findBrandByNormalizedName,
  updateBrandById
} from '../repositories/brandsRepository.js';
import { insertNotification } from '../repositories/notificationsRepository.js';

export async function notifySupplierBrandRejected({ supabase, brand, reason }) {
  const brandName = String(brand?.name || '').trim() || 'Brand';
  const rejectionReason =
    String(reason || brand?.rejection_reason || '').trim() || 'Rejected by admin';
  const userId = String(brand?.requested_by || '').trim();
  if (!userId) {
    return { notified: false, reason: 'missing_requester' };
  }

  await insertNotification(
    {
      user_id: userId,
      type: 'system',
      title: `Brand request rejected: ${brandName}`,
      message: `Your brand request "${brandName}" was rejected by admin. Reason: ${rejectionReason}`,
      related_supplier_id: userId,
      is_read: false,
      metadata: {
        event: 'brand_rejected',
        brandId: brand?.id || null,
        brandName,
        rejectionReason
      }
    },
    supabase
  );

  return { notified: true };
}

/**
 * Read-only brand approval status for supplier UI warnings.
 * Does not create or re-open brand requests.
 */
export async function resolveBrandApprovalStatus({ supabase, brandName }) {
  const name = String(brandName || '').trim();
  const normalized = getCanonicalBrandNormalizedName(name);

  if (!name || !normalized) {
    return {
      ok: false,
      status: 'missing',
      code: 'brand_required',
      message: 'Brand is required before adding a product.',
      brand: null
    };
  }

  let brandRow = null;
  let matchType = 'exact';
  try {
    const { data, error } = await findBrandByCatalogDedupKey(name, supabase);
    if (error) throw error;
    brandRow = data;
    if (!brandRow) {
      const fallback = await findBrandByNormalizedName(normalized, supabase);
      if (fallback.error) throw fallback.error;
      brandRow = fallback.data;
    }
    // Near-typo of an approved catalog brand (Faststark → Fastrack) counts as approved.
    if (!brandRow || String(brandRow.status || '').toLowerCase() !== 'approved') {
      const closeMatch = await findApprovedCatalogBrandCloseMatch(name, supabase);
      if (
        closeMatch.data &&
        String(closeMatch.data.status || '').toLowerCase() === 'approved'
      ) {
        brandRow = closeMatch.data;
        matchType = closeMatch.matchType || 'typo';
      }
    }
  } catch (_e) {
    return {
      ok: false,
      status: 'unknown',
      code: 'brand_workflow_not_ready',
      message: 'Brand approval status could not be verified right now. Please try again.',
      brand: null
    };
  }

  if (!brandRow) {
    return {
      ok: false,
      status: 'unregistered',
      code: 'brand_approval_required',
      message: `Brand approval required for "${name}". Request this brand under Select yourself and wait for admin approval before submitting products.`,
      brand: null
    };
  }

  const status = String(brandRow.status || 'pending').trim().toLowerCase();
  if (status === 'approved') {
    return {
      ok: true,
      status: 'approved',
      code: null,
      message:
        matchType === 'typo' && String(brandRow.name || '').trim()
          ? `Matched approved brand "${brandRow.name}".`
          : '',
      brand: brandRow,
      matchType
    };
  }

  if (status === 'rejected') {
    const reason = String(brandRow.rejection_reason || '').trim();
    return {
      ok: false,
      status: 'rejected',
      code: 'brand_approval_required',
      message: reason
        ? `Brand "${brandRow.name || name}" was rejected by admin. Reason: ${reason}`
        : `Brand "${brandRow.name || name}" was rejected by admin. Use another brand or request approval again.`,
      brand: brandRow
    };
  }

  return {
    ok: false,
    status: 'pending',
    code: 'brand_approval_pending',
    message: `Brand approval pending for "${brandRow.name || name}". Wait for admin approval before submitting products.`,
    brand: brandRow
  };
}

export async function ensureBrandApprovedOrRequest({ supabase, brandName, requesterUserId }) {
  const name = String(brandName || '').trim();
  const normalized = getCanonicalBrandNormalizedName(name);

  if (!name || !normalized) {
    return { ok: false, code: 'brand_required', message: 'Brand is required before adding a product.' };
  }

  let brandRow = null;
  try {
    const { data, error } = await findBrandByCatalogDedupKey(name, supabase);
    if (error) throw error;
    brandRow = data;
    if (!brandRow) {
      const fallback = await findBrandByNormalizedName(normalized, supabase);
      if (fallback.error) throw fallback.error;
      brandRow = fallback.data;
    }
  } catch (e) {
    return {
      ok: false,
      code: 'brand_workflow_not_ready',
      message: 'Brand approval workflow is not available yet. Please ask admin to run the brand migration.'
    };
  }

  // If lookup found an existing pending row, do not treat a later Save brand as a new request.
  const existedAsPending =
    !!brandRow && String(brandRow.status || '').trim().toLowerCase() === 'pending';

  if (!brandRow) {
    // Approved catalog match (exact or near-typo) — treat as approved for product submit.
    // Path B also gets ok:true so the UI can say the brand is already approved.
    const catalogMatch = await findApprovedCatalogBrandCloseMatch(name, supabase);
    if (catalogMatch.data && String(catalogMatch.data.status || '').toLowerCase() === 'approved') {
      return {
        ok: true,
        brand: catalogMatch.data,
        matchedExistingApproved: true,
        matchType: catalogMatch.matchType || 'exact'
      };
    }

    const nowIso = new Date().toISOString();
    const displayName = pickCanonicalBrandDisplayName(name);
    const { data: created, error: insertError } = await createBrand({
      name: displayName,
      normalized_name: normalized,
      status: 'pending',
      requested_by: requesterUserId,
      requested_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso
    }, supabase);

    if (insertError) {
      const reread = await findBrandByCatalogDedupKey(name, supabase);
      brandRow = reread.data || null;
      if (!brandRow) {
        const fallback = await findBrandByNormalizedName(normalized, supabase);
        brandRow = fallback.data || null;
      }
    } else {
      brandRow = created;
    }
  }

  let status = String(brandRow?.status || 'pending').toLowerCase();
  if (status === 'approved') {
    // Admin Brand Approvals always set approved_by. Legacy product-evidence auto-approve
    // only set approved_at — those must not count as admin approval on Path B.
    const hasAdminApproval = Boolean(String(brandRow?.approved_by || '').trim());
    if (hasAdminApproval) {
      return { ok: true, brand: brandRow };
    }

    if (brandRow?.id) {
      const nowIso = new Date().toISOString();
      const { data: reopened, error: reopenErr } = await updateBrandById(
        brandRow.id,
        {
          status: 'pending',
          approved_by: null,
          approved_at: null,
          rejection_reason: null,
          requested_by: requesterUserId || brandRow.requested_by || null,
          requested_at: brandRow.requested_at || nowIso,
          updated_at: nowIso
        },
        supabase
      );
      if (!reopenErr && reopened) {
        brandRow = reopened;
      } else {
        brandRow = {
          ...brandRow,
          status: 'pending',
          approved_by: null,
          approved_at: null
        };
      }
      status = 'pending';
    }
  }

  // If lookup found a non-approved row but an approved catalog identity/typo match exists,
  // use the approved brand (do not open another pending request).
  const catalogMatchExisting = await findApprovedCatalogBrandCloseMatch(name, supabase);
  if (
    catalogMatchExisting.data &&
    String(catalogMatchExisting.data.status || '').toLowerCase() === 'approved' &&
    String(catalogMatchExisting.data.id || '') !== String(brandRow?.id || '')
  ) {
    return {
      ok: true,
      brand: catalogMatchExisting.data,
      matchedExistingApproved: true,
      matchType: catalogMatchExisting.matchType || 'exact'
    };
  }

  // Re-submit flow: if admin previously rejected this brand and supplier tries again,
  // move it back to pending so it reappears in admin review queues.
  if (status === 'rejected' && brandRow?.id) {
    const nowIso = new Date().toISOString();
    const { data: reopened, error: reopenErr } = await updateBrandById(
      brandRow.id,
      {
        status: 'pending',
        requested_by: requesterUserId || brandRow.requested_by || null,
        requested_at: nowIso,
        updated_at: nowIso,
        approved_at: null,
        rejection_reason: null
      },
      supabase
    );
    if (!reopenErr && reopened) {
      brandRow = reopened;
    }
  }

  // Rejected brands can be re-opened as pending above.
  // Never auto-approve from product catalog evidence here — brand approval is admin-only.
  // (Auto-approval previously marked Path B "Save brand" requests as approved immediately.)

  const finalStatus = String(brandRow?.status || 'pending').toLowerCase();
  return {
    ok: false,
    code:
      finalStatus === 'rejected'
        ? 'brand_approval_required'
        : finalStatus === 'pending'
          ? 'brand_approval_pending'
          : 'brand_approval_required',
    alreadyPending: finalStatus === 'pending' && existedAsPending,
    message:
      finalStatus === 'rejected'
        ? `Brand "${brandRow?.name || name}" was rejected by admin. Please use another brand or request approval again.`
        : finalStatus === 'pending'
          ? existedAsPending
            ? `Brand request for "${brandRow?.name || name}" is already pending admin approval. Wait for admin to approve or reject it before submitting again.`
            : `Brand approval pending for "${brandRow?.name || name}". Wait for admin approval before submitting products.`
          : `Brand approval required for "${brandRow?.name || name}". Please wait for approval before adding products.`,
    brand: brandRow
  };
}
