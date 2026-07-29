import { supabase } from '../../config/supabase.js';
import { isAddressComplete, normalizeAddress, sanitizeSignupPlaceholderAddress } from '../po/shared/poHelpers.js';
import {
  branchRecordToAddressInput,
  isSupplierBranchAddressComplete
} from '../../services/upstreamOrderInputService.js';
import { ensureBrandApprovedOrRequest as ensureBrandApprovedOrRequestService } from '../../services/brandApprovalService.js';
import {
  baselineChainFromProfile,
  fetchLatestChainRequest,
  fetchPendingChainRequest,
  fetchSupplierApprovedBrands,
  fetchSupplierBrandRequests,
  mergeChainEntriesForDisplay,
  normalizeCompanyInfoEntries,
  syncApprovedBrandsIntoUserProfile
} from '../../services/supplierChainProfileService.js';
import {
  SUPPLY_CHAIN_ROLES_IN_ORDER,
  catalogBrandDedupKey,
  findCategorySupplyChainRowForBrandKey,
  normalizeBrandKey
} from '../../services/supplyChainSharedService.js';
import {
  buildChainRoleOptionsMessage,
  resolveSupplierBrandLayers
} from '../../services/supplierBrandLayerContract.js';
import { resolveServiceProviderDisplayFromPm } from '../../services/pmUserService.js';

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
const THEME_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const MAX_THEME_IMAGE_DATA_URL_LENGTH = Math.ceil((THEME_IMAGE_MAX_BYTES * 4) / 3) + 64;

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
    normalized: normalizeBrandKey(b),
    dedupKey: catalogBrandDedupKey(b)
  }));

  const { data: brandRows, error: brandError } = await supabase
    .from('brands')
    .select('name, normalized_name, status');
  if (brandError) throw brandError;

  const brandByDedupKey = new Map();
  for (const row of brandRows || []) {
    const key = catalogBrandDedupKey(row?.normalized_name || row?.name);
    if (!key) continue;
    const existing = brandByDedupKey.get(key);
    const rowStatus = String(row?.status || '').toLowerCase();
    const existingStatus = String(existing?.status || '').toLowerCase();
    const rank = { approved: 0, pending: 1, rejected: 2 };
    if (!existing || (rank[rowStatus] ?? 9) < (rank[existingStatus] ?? 9)) {
      brandByDedupKey.set(key, row);
    }
  }

  const { data: chainRows, error: chainError } = await supabase
    .from('category_supply_chains')
    .select('id, category_name, summary, stages, updated_at');
  if (chainError) throw chainError;

  const perBrand = [];
  const roleLists = [];
  const rolesByBrand = {};
  let blockedReason = null;
  const notApprovedBrands = [];
  const missingChainBrands = [];
  for (const b of normalizedBrands) {
    let brandRow = brandByDedupKey.get(b.dedupKey) || null;

    const chainRow =
      findCategorySupplyChainRowForBrandKey(chainRows, b.dedupKey) ||
      findCategorySupplyChainRowForBrandKey(chainRows, b.normalized) ||
      findCategorySupplyChainRowForBrandKey(chainRows, b.original);

    if (!brandRow && chainRow?.category_name) {
      const chainBrandKey = catalogBrandDedupKey(chainRow.category_name);
      brandRow = brandByDedupKey.get(chainBrandKey) || brandRow;
    }

    // Prefer the approved brands-table twin when the supplier typed a catalog spelling variant.
    if (brandRow && String(brandRow.status || '').toLowerCase() !== 'approved' && chainRow?.category_name) {
      const chainBrandKey = catalogBrandDedupKey(chainRow.category_name);
      const approvedChainBrand = brandByDedupKey.get(chainBrandKey) || null;
      if (String(approvedChainBrand?.status || '').toLowerCase() === 'approved') {
        brandRow = approvedChainBrand;
      }
    }

    const layers = resolveSupplierBrandLayers({
      brandInput: b.original,
      brandRow,
      chainRow
    });

    if (!layers.supplierHasAccess) {
      if (!blockedReason) blockedReason = 'brand_not_approved';
      notApprovedBrands.push(layers.brand);
    } else if (!layers.hasSupplyChainDefinition) {
      if (!blockedReason) blockedReason = 'supply_chain_not_defined';
      missingChainBrands.push(layers.brand);
    } else if (layers.canSelectRoles) {
      roleLists.push(layers.roles);
    }

    rolesByBrand[b.normalized] = layers.roles;

    perBrand.push({
      brand: layers.brand,
      normalizedBrand: layers.normalizedBrand,
      // Layer 2 brands-table truth (pending stays pending).
      approvalStatus: layers.approvalStatus,
      // Layer 1
      inApprovedCatalog: layers.inApprovedCatalog,
      // Layer 2
      supplierHasAccess: layers.supplierHasAccess,
      // Layer 3
      hasSupplyChainDefinition: layers.hasSupplyChainDefinition,
      roles: layers.roles,
      canSelectRoles: layers.canSelectRoles,
      // brands-table approval only — role unlock is canSelectRoles, not status.
      status: layers.status,
      supplyChainDefinition: chainRow
        ? {
            id: chainRow.id || null,
            summary: typeof chainRow.summary === 'string' ? chainRow.summary : '',
            stages: Array.isArray(chainRow.stages) ? chainRow.stages : [],
            updatedAt: chainRow.updated_at || null
          }
        : null
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
          ? buildChainRoleOptionsMessage({
              canSelectRoles: false,
              supplierHasAccess: false,
              hasSupplyChainDefinition: false,
              displayBrandName: notApprovedBrands[0] || 'Brand'
            })
          : buildChainRoleOptionsMessage({
              canSelectRoles: false,
              supplierHasAccess: true,
              hasSupplyChainDefinition: false,
              displayBrandName: missingChainBrands.join(', ')
            })
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
  return ensureBrandApprovedOrRequestService({ supabase, brandName, requesterUserId });
}

const SHIPPING_ADDRESS_REQUIRED_FIELDS = ['line1', 'city', 'state', 'pincode', 'country'];

export function shippingAddressEntryFromBranch(branch) {
  const normalized = normalizeAddress(branchRecordToAddressInput(branch));
  const entry = {
    id: String(branch?.id || '').trim(),
    label: String(branch?.name || '').trim(),
    ...normalized
  };
  return {
    ...entry,
    displayName: formatShippingAddressDisplayName(entry)
  };
}

export function normalizeShippingAddressEntry(entry = {}) {
  const nested = entry?.address && typeof entry.address === 'object' ? entry.address : {};
  const flat = normalizeAddress({ ...nested, ...entry });
  return {
    ...(entry.latitude != null ? { latitude: entry.latitude } : {}),
    ...(entry.longitude != null ? { longitude: entry.longitude } : {}),
    ...(entry.geoLocation ? { geoLocation: entry.geoLocation } : {}),
    id: String(entry?.id || '').trim(),
    label: String(entry?.label || entry?.name || '').trim(),
    ...flat
  };
}

export function formatShippingAddressDisplayName(entry, index = 0) {
  const normalized = normalizeShippingAddressEntry(entry);
  const preview = [
    normalized.line1,
    normalized.city,
    normalized.state,
    normalized.pincode,
    normalized.country
  ]
    .filter(Boolean)
    .join(', ');
  if (normalized.label && preview) {
    const label = String(normalized.label).trim();
    const labelNorm = label.toLowerCase();
    const cityNorm = String(normalized.city || '')
      .trim()
      .toLowerCase();
    if (labelNorm === cityNorm || labelNorm === preview.toLowerCase()) {
      return preview;
    }
    return `${label} — ${preview}`;
  }
  if (preview) return preview;
  if (normalized.label) return normalized.label;
  return `Address ${index + 1}`;
}

export function validateShippingAddressEntries(shippingAddresses = [], { userType = '' } = {}) {
  const entries = Array.isArray(shippingAddresses) ? shippingAddresses : [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = normalizeShippingAddressEntry(entries[i] || {});
    const hasAnyField = SHIPPING_ADDRESS_REQUIRED_FIELDS.some((field) =>
      String(entry?.[field] || '').trim()
    );
    if (!hasAnyField) continue;
    const missingField = SHIPPING_ADDRESS_REQUIRED_FIELDS.find(
      (field) => !String(entry?.[field] || '').trim()
    );
    if (missingField) {
      const label = String(entry?.label || '').trim() || `Shipping address ${i + 1}`;
      return {
        ok: false,
        code:
          userType === 'supplier'
            ? 'supplier_shipping_address_incomplete'
            : 'service_provider_shipping_address_incomplete',
        message: `Shipping address "${label}" is missing required field "${missingField}".`
      };
    }
  }
  return { ok: true };
}

/** Single company-registered billing address (users.address), with legacy billingAddresses[0] fallback. */
export function resolveRegisteredBillingAddress(user) {
  const direct = normalizeAddress(user?.address || {});
  if (isAddressComplete(direct)) return direct;

  const legacyList = user?.profile?.billingAddresses;
  if (Array.isArray(legacyList) && legacyList.length > 0) {
    const fromLegacy = normalizeAddress(legacyList[0] || {});
    if (isAddressComplete(fromLegacy)) return fromLegacy;
  }

  return direct;
}

export function deriveShippingAddressesFromProfile(user) {
  const profile = user?.profile || {};
  const userType = user?.user_type || profile?.userType;

  if (userType === 'supplier') {
    return (Array.isArray(profile.branches) ? profile.branches : [])
      .filter((branch) => isSupplierBranchAddressComplete(branch))
      .map((branch) => shippingAddressEntryFromBranch(branch))
      .filter((entry) => entry.id && isAddressComplete(entry));
  }

  return (Array.isArray(profile.shippingAddresses) ? profile.shippingAddresses : [])
    .map((entry) => normalizeShippingAddressEntry(entry))
    .filter((entry) => entry.id && isAddressComplete(entry))
    .map((entry, index) => ({
      ...entry,
      displayName: formatShippingAddressDisplayName(entry, index)
    }));
}

export async function createProfileResponse(user) {
  const registeredBillingAddress = resolveRegisteredBillingAddress(user);
  const displayBillingAddress = sanitizeSignupPlaceholderAddress(registeredBillingAddress, {
    companyName: user.company || ''
  });
  const baseProfile = {
    userId: user.id,
    companyName: user.company || '',
    contactPerson: user.name,
    phone: user.phone || '',
    email: user.email,
    address: displayBillingAddress,
    website: user.profile?.website || '',
    description: user.profile?.description || '',
    profilePhotoUrl: String(user.profile?.profilePhotoUrl || '').trim(),
    userType: user.user_type,
    createdAt: user.created_at
  };

  if (user.user_type === 'service_provider') {
    const purchaseSummary = await computePurchaseSummary(user.id);
    const pmDisplay = resolveServiceProviderDisplayFromPm(user);
    let serviceProviderPortalTheme = { themeId: 'default', customImageDataUrl: '' };
    try {
      serviceProviderPortalTheme = sanitizeServiceProviderThemePrefs(
        user.profile?.serviceProviderPortalTheme || {}
      );
    } catch {
      serviceProviderPortalTheme = { themeId: 'default', customImageDataUrl: '' };
    }

    const { companyName: _companyName, website: _website, description: _description, ...serviceProviderBase } =
      baseProfile;

    return {
      ...serviceProviderBase,
      contactPerson: pmDisplay.contactPerson || baseProfile.contactPerson,
      email: pmDisplay.email || baseProfile.email,
      phone: pmDisplay.phone || baseProfile.phone,
      pmCustomerAccount: pmDisplay.pmCustomerAccount,
      profileIncomplete: user.profile?.profileIncomplete === true,
      projects: user.profile?.projects || [],
      shippingAddresses: deriveShippingAddressesFromProfile(user),
      totalOrdersPlaced: purchaseSummary.totalOrdersPlaced,
      totalAmountPlaced: purchaseSummary.totalAmountPlaced,
      totalAmountPaid: purchaseSummary.totalAmountPaid,
      topPurchasedBrand: purchaseSummary.topPurchasedBrand,
      serviceProviderPortalTheme
    };
  }

  if (user.user_type === 'supplier') {
    const base = await syncApprovedBrandsIntoUserProfile(user.id, user.profile || {});
    const pending = await fetchPendingChainRequest(user.id);
    const latestReq = await fetchLatestChainRequest(user.id);
    const profileContext = {
      ...base,
      chainProfileDraft: base.chainProfileDraft,
      companyInfoEntries: [
        ...(base.companyInfoEntries || []),
        ...(pending?.payload?.companyInfoEntries || []),
        ...(base.chainProfileDraft?.companyInfoEntries || [])
      ]
    };
    const approvedBrands = await fetchSupplierApprovedBrands(user.id, profileContext);
    const supplierBrandRequests = await fetchSupplierBrandRequests(user.id, profileContext);

    const approvedChain = baselineChainFromProfile(base);
    const draftChain = {
      supplierRole: String(base?.chainProfileDraft?.supplierRole || '').trim(),
      brands: typeof base?.chainProfileDraft?.brands === 'string' ? base.chainProfileDraft.brands : '',
      companyInfoEntries: normalizeCompanyInfoEntries(base?.chainProfileDraft?.companyInfoEntries || [])
    };
    const draftHasValues =
      !!draftChain.supplierRole ||
      !!String(draftChain.brands || '').trim() ||
      draftChain.companyInfoEntries.length > 0;
    const pendingChain = pending?.payload
      ? {
          supplierRole: String(pending.payload.supplierRole || '').trim(),
          brands: typeof pending.payload.brands === 'string' ? pending.payload.brands : '',
          companyInfoEntries: normalizeCompanyInfoEntries(pending.payload.companyInfoEntries || [])
        }
      : null;

    const mergedEntries = mergeChainEntriesForDisplay(
      approvedChain.companyInfoEntries,
      pendingChain?.companyInfoEntries,
      draftHasValues ? draftChain.companyInfoEntries : []
    );

    const displayChain = pendingChain
      ? {
          supplierRole: pendingChain.supplierRole || approvedChain.supplierRole,
          brands: pendingChain.brands || approvedChain.brands,
          companyInfoEntries: mergedEntries
        }
      : draftHasValues
        ? {
            supplierRole: draftChain.supplierRole || approvedChain.supplierRole,
            brands: draftChain.brands || approvedChain.brands,
            companyInfoEntries: mergedEntries
          }
        : {
            ...approvedChain,
            companyInfoEntries: mergedEntries.length > 0 ? mergedEntries : approvedChain.companyInfoEntries
          };

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
      shippingAddresses: deriveShippingAddressesFromProfile(user),
      branches: base.branches || [],
      skus: base.skus || [],
      supplierRole: displayChain.supplierRole || (firstEntry?.role || ''),
      gstin: base.gstin || (firstEntry?.gstin || ''),
      ownershipDetails: base.ownershipDetails || (firstEntry?.ownershipDetails || ''),
      brands: displayChain.brands || (firstEntry?.brands || ''),
      authorizationCertificateUrl: base.authorizationCertificateUrl || '',
      companyInfoEntries: entries,
      chainProfileApprovalStatus: pending ? 'pending' : draftHasValues ? 'draft' : 'approved',
      chainProfilePendingSubmittedAt: pending?.created_at || null,
      chainProfilePendingId: pending?.id || null,
      chainProfileDraftSavedAt: base.chainProfileDraftUpdatedAt || null,
      totalOrdersPlaced: purchaseSummary.totalOrdersPlaced,
      totalAmountPlaced: purchaseSummary.totalAmountPlaced,
      totalAmountPaid: purchaseSummary.totalAmountPaid,
      topPurchasedBrand: purchaseSummary.topPurchasedBrand,
      totalOrdersReceived,
      totalRevenueReceived,
      approvedChainProfile:
        pending || draftHasValues
          ? {
              supplierRole: approvedChain.supplierRole,
              brands: approvedChain.brands,
              companyInfoEntries: approvedChain.companyInfoEntries
            }
          : null,
      chainProfileLastRejection,
      supplierPortalTheme,
      adminApprovedBrands: approvedBrands.map((row) => ({
        name: row.name,
        normalizedName: row.normalized_name || normalizeBrandKey(row.name),
        status: 'approved'
      })),
      supplierBrandRequests: supplierBrandRequests.map((row) => ({
        name: row.name,
        normalizedName: row.normalized_name || normalizeBrandKey(row.name),
        status: row.status || 'pending',
        rejectionReason: row.rejectionReason || '',
        requestedAt: row.requestedAt || null,
        submittedAt: row.requestedAt || null
      }))
    };
  }

  return baseProfile;
}
