import { supabase } from '../../config/supabase.js';
import {
  baselineChainFromProfile,
  fetchLatestChainRequest,
  fetchPendingChainRequest,
  normalizeCompanyInfoEntries
} from '../../services/supplierChainProfileService.js';
import {
  SUPPLY_CHAIN_ROLES_IN_ORDER,
  findCategorySupplyChainRowForBrandKey,
  normalizeBrandKey,
  normalizeChainRolesFromStages
} from '../../services/supplyChainSharedService.js';

const SERVICE_PROVIDER_THEME_IDS = new Set([
  'default',
  'sunset',
  'ocean',
  'forest',
  'city-lights',
  'blueprint',
  'custom'
]);
const SUPPLIER_PORTAL_THEME_IDS = new Set(['default', 'ocean', 'sky', 'slate', 'custom']);
const MAX_THEME_IMAGE_DATA_URL_LENGTH = 3_500_000;

/** Max upload size for profile avatar (multer + API validation). */
export const PROFILE_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const PROFILE_PHOTO_MAX_SIZE_LABEL = '20MB';

export function sanitizeServiceProviderThemePrefs(rawTheme) {
  const themeId = String(rawTheme?.themeId || 'default').trim() || 'default';
  const safeThemeId = SERVICE_PROVIDER_THEME_IDS.has(themeId) ? themeId : 'default';
  const customImageDataUrl =
    safeThemeId === 'custom' ? String(rawTheme?.customImageDataUrl || '').trim() : '';
  if (customImageDataUrl.length > MAX_THEME_IMAGE_DATA_URL_LENGTH) {
    throw new Error('Custom wallpaper image is too large. Please upload a smaller image.');
  }
  if (customImageDataUrl && !customImageDataUrl.startsWith('data:image/')) {
    throw new Error('Custom wallpaper must be an image.');
  }
  return {
    themeId: safeThemeId,
    customImageDataUrl
  };
}

export function sanitizeSupplierPortalThemePrefs(rawTheme) {
  const themeId = String(rawTheme?.themeId || 'default').trim() || 'default';
  const safeThemeId = SUPPLIER_PORTAL_THEME_IDS.has(themeId) ? themeId : 'default';
  const customImageDataUrl =
    safeThemeId === 'custom' ? String(rawTheme?.customImageDataUrl || '').trim() : '';
  if (customImageDataUrl.length > MAX_THEME_IMAGE_DATA_URL_LENGTH) {
    throw new Error('Custom wallpaper image is too large. Please upload a smaller image.');
  }
  if (customImageDataUrl && !customImageDataUrl.startsWith('data:image/')) {
    throw new Error('Custom wallpaper must be an image.');
  }
  return {
    themeId: safeThemeId,
    customImageDataUrl
  };
}

export function parseBrandTokens(str) {
  if (!str || !String(str).trim()) return [];
  return String(str)
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function intersectRoleLists(roleLists) {
  if (!Array.isArray(roleLists) || roleLists.length === 0) return [];
  let current = new Set(roleLists[0]);
  for (let i = 1; i < roleLists.length; i += 1) {
    const next = new Set(roleLists[i]);
    current = new Set([...current].filter((r) => next.has(r)));
    if (current.size === 0) break;
  }
  return SUPPLY_CHAIN_ROLES_IN_ORDER.filter((r) => current.has(r));
}

export async function resolveChainRoleOptionsForBrands(brandInputs = []) {
  const brands = [...new Set((brandInputs || []).map((b) => String(b || '').trim()).filter(Boolean))];
  if (brands.length === 0) {
    return {
      brands: [],
      roles: [],
      eligible: false,
      reason: 'no_brand_selected',
      message: 'Select at least one brand to load available supply-chain roles.'
    };
  }

  const normalizedBrands = brands.map((b) => ({
    original: b,
    normalized: normalizeBrandKey(b)
  }));

  const brandKeys = normalizedBrands.map((b) => b.normalized).filter(Boolean);
  const { data: brandRows, error: brandError } = await supabase
    .from('brands')
    .select('name, normalized_name, status')
    .in('normalized_name', brandKeys);
  if (brandError) throw brandError;

  const { data: chainRows, error: chainError } = await supabase
    .from('category_supply_chains')
    .select('category_name, stages, updated_at');
  if (chainError) throw chainError;

  const brandByKey = new Map();
  for (const row of brandRows || []) {
    const key = normalizeBrandKey(row?.normalized_name || row?.name);
    if (key && !brandByKey.has(key)) brandByKey.set(key, row);
  }
  const perBrand = [];
  const roleLists = [];
  const rolesByBrand = {};
  let blockedReason = null;
  const notApprovedBrands = [];
  const missingChainBrands = [];
  for (const b of normalizedBrands) {
    const brandRow = brandByKey.get(b.normalized) || null;
    const brandStatus = String(brandRow?.status || 'missing');

    const chainRow = findCategorySupplyChainRowForBrandKey(chainRows, b.normalized);
    const roles = normalizeChainRolesFromStages(chainRow?.stages);
    if (brandStatus !== 'approved' && roles.length === 0) {
      blockedReason = 'brand_not_approved';
      notApprovedBrands.push(brandRow?.name || b.original);
    }
    if (roles.length === 0) {
      if (!blockedReason) blockedReason = 'supply_chain_not_defined';
      missingChainBrands.push(brandRow?.name || b.original);
    } else {
      roleLists.push(roles);
    }
    rolesByBrand[b.normalized] = roles;

    perBrand.push({
      brand: brandRow?.name || b.original,
      normalizedBrand: b.normalized,
      status: brandStatus,
      hasSupplyChainDefinition: roles.length > 0,
      roles
    });
  }

  if (blockedReason) {
    return {
      brands: perBrand,
      roles: [],
      rolesByBrand,
      eligible: false,
      reason: blockedReason,
      notApprovedBrands,
      missingChainBrands,
      message:
        blockedReason === 'brand_not_approved'
          ? `One or more selected brands are not approved by admin yet: ${notApprovedBrands.join(', ')}.`
          : `Supply chain is not defined by admin for: ${missingChainBrands.join(', ')}.`
    };
  }

  const allowedRoles = intersectRoleLists(roleLists);
  return {
    brands: perBrand,
    roles: allowedRoles,
    rolesByBrand,
    eligible: allowedRoles.length > 0,
    reason: allowedRoles.length > 0 ? null : 'no_common_role',
    message:
      allowedRoles.length > 0
        ? null
        : 'Selected brands do not share a common role. Split brands into separate entries so each brand follows its own admin-defined chain.'
  };
}

function extractBrandFromOrderItem(orderItem = {}) {
  const product = orderItem.product || {};
  const productSpecs = product.specifications || {};
  let lineSpecs = {};
  if (orderItem.specifications && typeof orderItem.specifications === 'string') {
    try {
      lineSpecs = JSON.parse(orderItem.specifications);
    } catch {
      lineSpecs = {};
    }
  } else if (orderItem.specifications && typeof orderItem.specifications === 'object') {
    lineSpecs = orderItem.specifications;
  }

  const rawBrand =
    product.brand ||
    productSpecs.brand ||
    productSpecs.brandModel ||
    lineSpecs.brand ||
    lineSpecs.brandModel ||
    '';

  const normalized = normalizeBrandKey(rawBrand);
  return {
    normalized,
    display: String(rawBrand || '').trim() || 'Unknown'
  };
}

async function computePurchaseSummary(userId) {
  const summary = {
    totalOrdersPlaced: 0,
    totalAmountPlaced: 0,
    totalAmountPaid: 0,
    topPurchasedBrand: null
  };

  const { data: placedOrders, error: placedOrdersError } = await supabase
    .from('orders')
    .select('id, total_amount, payment_status')
    .eq('service_provider_id', userId);

  if (placedOrdersError || !Array.isArray(placedOrders)) {
    if (placedOrdersError) {
      console.error('[Profile] computePurchaseSummary orders error:', placedOrdersError);
    }
    return summary;
  }

  summary.totalOrdersPlaced = placedOrders.length;
  summary.totalAmountPlaced = placedOrders.reduce(
    (sum, row) => sum + (parseFloat(row.total_amount) || 0),
    0
  );
  summary.totalAmountPaid = placedOrders.reduce((sum, row) => {
    const paid = String(row.payment_status || '').toLowerCase() === 'paid';
    return sum + (paid ? parseFloat(row.total_amount) || 0 : 0);
  }, 0);

  const orderIds = placedOrders.map((o) => o.id).filter(Boolean);
  if (orderIds.length === 0) return summary;

  const { data: lineItems, error: lineItemsError } = await supabase
    .from('order_items')
    .select(`
      quantity,
      total_price,
      specifications,
      product:products (
        brand,
        specifications
      )
    `)
    .in('order_id', orderIds);

  if (lineItemsError || !Array.isArray(lineItems)) {
    if (lineItemsError) {
      console.error('[Profile] computePurchaseSummary line items error:', lineItemsError);
    }
    return summary;
  }

  const byBrand = new Map();
  for (const li of lineItems) {
    const { normalized, display } = extractBrandFromOrderItem(li);
    const key = normalized || 'unknown';
    const existing = byBrand.get(key) || {
      brand: display,
      totalQuantity: 0,
      totalAmount: 0,
      orderLineCount: 0
    };
    existing.totalQuantity += parseFloat(li.quantity) || 0;
    existing.totalAmount += parseFloat(li.total_price) || 0;
    existing.orderLineCount += 1;
    if ((existing.brand === 'Unknown' || !existing.brand) && display !== 'Unknown') {
      existing.brand = display;
    }
    byBrand.set(key, existing);
  }

  if (byBrand.size > 0) {
    const ranked = Array.from(byBrand.values()).sort((a, b) => {
      if (b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount;
      if (b.totalQuantity !== a.totalQuantity) return b.totalQuantity - a.totalQuantity;
      return b.orderLineCount - a.orderLineCount;
    });
    summary.topPurchasedBrand = ranked[0];
  }

  summary.totalAmountPlaced = Number(summary.totalAmountPlaced.toFixed(2));
  summary.totalAmountPaid = Number(summary.totalAmountPaid.toFixed(2));
  if (summary.topPurchasedBrand) {
    summary.topPurchasedBrand.totalAmount = Number(summary.topPurchasedBrand.totalAmount.toFixed(2));
    summary.topPurchasedBrand.totalQuantity = Number(summary.topPurchasedBrand.totalQuantity.toFixed(2));
  }

  return summary;
}

export async function ensureBrandApprovedOrRequest({ brandName, requesterUserId }) {
  const name = String(brandName || '').trim();
  const normalized = normalizeBrandKey(name);

  if (!name || !normalized) {
    return { ok: false, code: 'brand_required', message: 'Brand is required.' };
  }

  let brandRow = null;
  try {
    const { data, error } = await supabase
      .from('brands')
      .select('*')
      .eq('normalized_name', normalized)
      .maybeSingle();
    if (error) throw error;
    brandRow = data;
  } catch {
    return {
      ok: false,
      code: 'brand_workflow_not_ready',
      message: 'Brand approval workflow is not available yet. Please ask admin to run the brand migration.'
    };
  }

  if (!brandRow) {
    const nowIso = new Date().toISOString();
    const { data: created, error: insertError } = await supabase
      .from('brands')
      .insert({
        name,
        normalized_name: normalized,
        status: 'pending',
        requested_by: requesterUserId,
        requested_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso
      })
      .select()
      .single();

    if (insertError) {
      const { data: reread } = await supabase
        .from('brands')
        .select('*')
        .eq('normalized_name', normalized)
        .maybeSingle();
      brandRow = reread || null;
    } else {
      brandRow = created;
    }
  }

  const status = String(brandRow?.status || 'pending');
  if (status === 'approved') return { ok: true, brand: brandRow };

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
        const { data: updated, error: upErr } = await supabase
          .from('brands')
          .update({
            status: 'approved',
            approved_at: nowIso,
            updated_at: nowIso,
            rejection_reason: null
          })
          .eq('id', brandRow.id)
          .select()
          .single();
        if (!upErr && updated) return { ok: true, brand: updated };
      } else {
        const { data: createdApproved, error: createApprovedErr } = await supabase
          .from('brands')
          .insert({
            name,
            normalized_name: normalized,
            status: 'approved',
            requested_by: requesterUserId,
            requested_at: nowIso,
            approved_at: nowIso,
            created_at: nowIso,
            updated_at: nowIso
          })
          .select()
          .single();
        if (!createApprovedErr && createdApproved) return { ok: true, brand: createdApproved };
      }
    }
  }

  return {
    ok: false,
    code: 'brand_approval_required',
    message:
      status === 'rejected'
        ? `Brand "${brandRow?.name || name}" was rejected by admin. Please use another brand or request approval again.`
        : `Brand "${brandRow?.name || name}" is pending admin approval. Please wait for approval before proceeding.`,
    brand: brandRow
  };
}

export async function createProfileResponse(user) {
  const baseProfile = {
    userId: user.id,
    companyName: user.company || '',
    contactPerson: user.name,
    phone: user.phone || '',
    email: user.email,
    address: user.address || {},
    website: user.profile?.website || '',
    description: user.profile?.description || '',
    profilePhotoUrl: String(user.profile?.profilePhotoUrl || '').trim(),
    userType: user.user_type,
    createdAt: user.created_at
  };

  if (user.user_type === 'service_provider') {
    const purchaseSummary = await computePurchaseSummary(user.id);
    let serviceProviderPortalTheme = { themeId: 'default', customImageDataUrl: '' };
    try {
      serviceProviderPortalTheme = sanitizeServiceProviderThemePrefs(
        user.profile?.serviceProviderPortalTheme || {}
      );
    } catch {
      serviceProviderPortalTheme = { themeId: 'default', customImageDataUrl: '' };
    }

    return {
      ...baseProfile,
      projects: user.profile?.projects || [],
      billingAddresses: user.profile?.billingAddresses || [],
      totalOrdersPlaced: purchaseSummary.totalOrdersPlaced,
      totalAmountPlaced: purchaseSummary.totalAmountPlaced,
      totalAmountPaid: purchaseSummary.totalAmountPaid,
      topPurchasedBrand: purchaseSummary.topPurchasedBrand,
      serviceProviderPortalTheme
    };
  }

  if (user.user_type === 'supplier') {
    const base = user.profile || {};
    const pending = await fetchPendingChainRequest(user.id);
    const latestReq = await fetchLatestChainRequest(user.id);

    const approvedChain = baselineChainFromProfile(base);
    const displayChain = pending?.payload
      ? {
          supplierRole: String(pending.payload.supplierRole || '').trim(),
          brands: typeof pending.payload.brands === 'string' ? pending.payload.brands : '',
          companyInfoEntries: normalizeCompanyInfoEntries(pending.payload.companyInfoEntries || [])
        }
      : approvedChain;

    const entries = displayChain.companyInfoEntries || [];
    const firstEntry = entries[0];

    const chainProfileLastRejection =
      !pending && latestReq?.status === 'rejected'
        ? {
            reason: latestReq.rejection_reason || null,
            reviewedAt: latestReq.reviewed_at || null
          }
        : null;

    const purchaseSummary = await computePurchaseSummary(user.id);
    let totalOrdersReceived = 0;
    let totalRevenueReceived = 0;
    try {
      const { data: receivedOrders, error: receivedOrdersError } = await supabase
        .from('orders')
        .select('id, total_amount, payment_status')
        .eq('supplier_id', user.id);

      if (!receivedOrdersError && Array.isArray(receivedOrders)) {
        totalOrdersReceived = receivedOrders.length;
        totalRevenueReceived = receivedOrders.reduce((sum, row) => {
          const isPaid = String(row.payment_status || '').toLowerCase() === 'paid';
          return sum + (isPaid ? parseFloat(row.total_amount) || 0 : 0);
        }, 0);
      }
    } catch (statsError) {
      console.error('[Profile] Failed to compute supplier order stats:', statsError);
    }

    let supplierPortalTheme = { themeId: 'default', customImageDataUrl: '' };
    try {
      supplierPortalTheme = sanitizeSupplierPortalThemePrefs(base.supplierPortalTheme || {});
    } catch {
      supplierPortalTheme = { themeId: 'default', customImageDataUrl: '' };
    }

    return {
      ...baseProfile,
      businessType: base.businessType || '',
      categories: base.categories || [],
      billingAddresses: base.billingAddresses || [],
      branches: base.branches || [],
      skus: base.skus || [],
      supplierRole: displayChain.supplierRole || (firstEntry?.role || ''),
      gstin: base.gstin || (firstEntry?.gstin || ''),
      ownershipDetails: base.ownershipDetails || (firstEntry?.ownershipDetails || ''),
      brands: displayChain.brands || (firstEntry?.brands || ''),
      authorizationCertificateUrl: base.authorizationCertificateUrl || '',
      companyInfoEntries: entries,
      chainProfileApprovalStatus: pending ? 'pending' : 'approved',
      chainProfilePendingSubmittedAt: pending?.created_at || null,
      chainProfilePendingId: pending?.id || null,
      totalOrdersPlaced: purchaseSummary.totalOrdersPlaced,
      totalAmountPlaced: purchaseSummary.totalAmountPlaced,
      totalAmountPaid: purchaseSummary.totalAmountPaid,
      topPurchasedBrand: purchaseSummary.topPurchasedBrand,
      totalOrdersReceived,
      totalRevenueReceived,
      approvedChainProfile: pending
        ? {
            supplierRole: approvedChain.supplierRole,
            brands: approvedChain.brands,
            companyInfoEntries: approvedChain.companyInfoEntries
          }
        : null,
      chainProfileLastRejection,
      supplierPortalTheme
    };
  }

  return baseProfile;
}
