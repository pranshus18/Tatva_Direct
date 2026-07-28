import { catalogBrandDedupKey, normalizeBrandKey } from './supplyChainSharedService.js';
import {
  findBrandByCatalogDedupKey,
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
  try {
    const { data, error } = await findBrandByCatalogDedupKey(name, supabase);
    if (error) throw error;
    brandRow = data;
    if (!brandRow) {
      const fallback = await findBrandByNormalizedName(normalized, supabase);
      if (fallback.error) throw fallback.error;
      brandRow = fallback.data;
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
      message: '',
      brand: brandRow
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

  if (!brandRow) {
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

  const status = String(brandRow?.status || 'pending');
  if (status === 'approved') {
    return { ok: true, brand: brandRow };
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

  const { data: approvedOffers, error: offerErr } = await supabase
    .from('supplier_products')
    .select(`
      status,
      is_active,
      attributes,
      product:products (
        status,
        brand,
        specifications
      )
    `)
    .eq('status', 'approved')
    .eq('is_active', true)
    .limit(5000);

  if (!offerErr) {
    const hasApprovedEvidence = (approvedOffers || []).some((row) => {
      const productStatus = String(row?.product?.status || '').toLowerCase();
      if (productStatus && productStatus !== 'approved') return false;
      const approvedBrand =
        row?.attributes?.brand ||
        row?.attributes?.brandModel ||
        row?.product?.brand ||
        row?.product?.specifications?.brand ||
        row?.product?.specifications?.brandModel ||
        '';
      return normalizeBrandKey(approvedBrand) === normalized || catalogBrandDedupKey(approvedBrand) === normalized;
    });

    if (hasApprovedEvidence) {
      const nowIso = new Date().toISOString();
      if (brandRow?.id) {
        const { data: updated, error: upErr } = await updateBrandById(brandRow.id, {
          status: 'approved',
          approved_at: nowIso,
          updated_at: nowIso,
          rejection_reason: null
        }, supabase);
        if (!upErr && updated) {
          return { ok: true, brand: updated };
        }
      } else {
        const { data: createdApproved, error: createApprovedErr } = await createBrand({
          name: pickCanonicalBrandDisplayName(name),
          normalized_name: normalized,
          status: 'approved',
          requested_by: requesterUserId,
          requested_at: nowIso,
          approved_at: nowIso,
          created_at: nowIso,
          updated_at: nowIso
        }, supabase);
        if (!createApprovedErr && createdApproved) {
          return { ok: true, brand: createdApproved };
        }
      }
    }
  }

  return {
    ok: false,
    code:
      String(brandRow?.status || '').toLowerCase() === 'pending' ||
      String(brandRow?.status || '').toLowerCase() === 'rejected'
        ? String(brandRow?.status || '').toLowerCase() === 'rejected'
          ? 'brand_approval_required'
          : 'brand_approval_pending'
        : 'brand_approval_required',
    message:
      String(brandRow?.status || '').toLowerCase() === 'rejected'
        ? `Brand "${brandRow?.name || name}" was rejected by admin. Please use another brand or request approval again.`
        : String(brandRow?.status || '').toLowerCase() === 'pending'
          ? `Brand approval pending for "${brandRow?.name || name}". Wait for admin approval before submitting products.`
        : `Brand approval required for "${brandRow?.name || name}". Please wait for approval before adding products.`,
    brand: brandRow
  };
}
