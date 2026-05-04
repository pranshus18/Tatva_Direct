import { normalizeBrandKey } from './supplyChainSharedService.js';
import {
  createBrand,
  findBrandByNormalizedName,
  updateBrandById
} from '../repositories/brandsRepository.js';

export async function ensureBrandApprovedOrRequest({ supabase, brandName, requesterUserId }) {
  const name = String(brandName || '').trim();
  const normalized = normalizeBrandKey(name);

  if (!name || !normalized) {
    return { ok: false, code: 'brand_required', message: 'Brand is required before adding a product.' };
  }

  let brandRow = null;
  try {
    const { data, error } = await findBrandByNormalizedName(normalized, supabase);
    if (error) throw error;
    brandRow = data;
  } catch (e) {
    return {
      ok: false,
      code: 'brand_workflow_not_ready',
      message: 'Brand approval workflow is not available yet. Please ask admin to run the brand migration.'
    };
  }

  if (!brandRow) {
    const nowIso = new Date().toISOString();
    const { data: created, error: insertError } = await createBrand({
      name,
      normalized_name: normalized,
      status: 'pending',
      requested_by: requesterUserId,
      requested_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso
    }, supabase);

    if (insertError) {
      const { data: reread } = await findBrandByNormalizedName(normalized, supabase);
      brandRow = reread || null;
    } else {
      brandRow = created;
    }
  }

  const status = String(brandRow?.status || 'pending');
  if (status === 'approved') {
    return { ok: true, brand: brandRow };
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
      return normalizeBrandKey(approvedBrand) === normalized;
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
          name,
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
    code: 'brand_approval_required',
    message:
      status === 'rejected'
        ? `Brand "${brandRow?.name || name}" was rejected by admin. Please use another brand or request approval again.`
        : `Brand "${brandRow?.name || name}" is pending admin approval. Please wait for approval before adding products.`,
    brand: brandRow
  };
}
