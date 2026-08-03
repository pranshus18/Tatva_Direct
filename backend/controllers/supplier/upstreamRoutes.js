/** Supplier routes: upstream */
import {
  ROLE_DEPTH,
  SUPPLIER_ROLE_SET,
  SUPPLY_CHAIN_ROLE_LABELS,
  UPSTREAM_RANK_PRIORITY,
  buildIdentityBundle,
  buildOutletAddressString,
  dedupeUpstreamCandidatesBySupplierPreferClosest,
  geocodeAddressNominatim,
  getContractErrorMessage,
  getFirstSupplierBranchAddressText,
  getImmediateParentRolesUnion,
  getMinDrivingDistanceFromOriginsKm,
  getMinimumOrderValueInrForSellerRole,
  insertNotification,
  isValidGeoLocation,
  loadAdminBrandChainsByName,
  normalizeChainRolesFromStages,
  mapSupplyChainPartner,
  minHaversineKmBuyerOutletsToSeller,
  normalizeBrandKeyFromAttributes,
  parseBrandTokens,
  resolveUpstreamBrandLabel,
  supplierCanAccessBrandStrict,
  parseWithSchema,
  getAllowedUpstreamRolesForBrand,
  buildRegisteredUpstreamPartnerIdsByBrandKey,
  buildNoUpstreamOffersMessage,
  buildUpstreamChainContextForMineOffer,
  collectRequiredUpstreamRolesFromContexts,
  formatUpstreamRoleLabel,
  formatUpstreamRoleLabels,
  pickMatchingUpstreamRoleForSeller,
  pickAnyUpstreamSellerRoleOnChain,
  pickUpstreamSellerRoleForBrand,
  getImmediateUpstreamRoleForBrand,
  rankUpstreamOffersForProduct,
  resolveBuyerRoleForBrand,
  sortRolesByChainDepthDesc,
  getMySupplierRoles,
  recordInventoryMovement,
  resolveGeoFromOutletAddress,
  buildAllowedUpstreamRolesSet,
  resolveRequiredUpstreamRoleFromAdminChain,
  sellerHasAnyUpstreamRoleForBrand,
  sellerMatchesUpstreamForBrand,
  supplierUpstreamCartSaveSchema,
  supplierUpstreamCheckoutReleaseSchema,
  supplierUpstreamCheckoutReserveSchema,
  supplierUpstreamOrdersSchema,
  supplierUpstreamPreviewGroupsSchema
} from './supplierImports.js';
import {
  ORDER_INSERT_MAX_RETRIES,
  isOrderNumberConflictError,
  isSupplierOfferAvailableForUpstream,
  isSupplierOfferEligibleForUpstreamSelection,
  resolveEffectiveSupplierOfferState,
  syncSupplierOfferApprovalFromCatalog
} from './shared/productHelpers.js';
import { validateCreditForOrder } from '../../services/creditAccountService.js';
import {
  isAddressComplete,
  mapToDeliveryAddress,
  normalizeAddress,
  buildTransportGroupId,
  buildShippingAddressKey,
  consolidatePoTransportGroups,
  formatShippingAddressLabel,
  mergeUpstreamSelectedMineQuantity
} from '../po/shared/poHelpers.js';
import {
  normalizeRequiredDateForUpstream,
  resolvePrimarySupplierShippingAddress,
  resolveUpstreamPaymentSelection
} from '../../services/upstreamOrderInputService.js';
import { parseSupplierStockQuantity } from '../../utils/parseSupplierStockQuantity.js';
import { formatPlatformDate } from '../../utils/dateTime.js';
import { deriveShippingAddressesFromProfile } from '../profile/profileHelpers.js';
import { formatShippingAddressText, resolveProjectShippingAddress } from '../../services/vendorRequestContextService.js';
import { geocodeIndianAddress } from '../../utils/geoUtils.js';
import {
  getUpstreamOfferMatchType,
  upstreamOffersMatchForSupplyChain
} from '../../services/upstreamOfferMatchService.js';
import {
  DISCOVERY_DETAIL_AUDIENCES,
  getProductDiscoveryDetail
} from '../../services/productDiscoveryDetailService.js';
import {
  CHECKOUT_RESERVATION_MINUTES,
  computeAvailableStock,
  consumeCheckoutReservationsForOrder,
  expireStaleReservations,
  getActiveReservedQuantitiesByProductIds,
  getUpstreamCheckoutReservationStatus,
  releaseUpstreamCheckoutReservations,
  reserveUpstreamCheckoutLines,
  validateCheckoutReservationsForLines
} from '../../services/upstreamInventoryReservationService.js';

export function registerSupplierUpstreamRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase,
    resolveTaxRatesForProductCreate
  } = ctx;

  const normalizeSelectedMineQuantities = (raw = {}) => {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.entries(raw).forEach(([key, val]) => {
      const mineId = String(key || '').trim();
      if (!mineId) return;
      const qty = parseSupplierStockQuantity(val);
      if (qty != null && qty > 0) out[mineId] = qty;
    });
    return out;
  };

  const hasUpstreamProjectLines = (project = {}) =>
    Object.keys(normalizeSelectedMineQuantities(project?.selectedMine || {})).length > 0;

  const upstreamCartDraftNeedsPersistAfterPrune = (rawDraft = {}, normalizedDraft = {}) => {
    const rawProjects = Array.isArray(rawDraft?.projects) ? rawDraft.projects : [];
    const nextProjects = Array.isArray(normalizedDraft?.projects) ? normalizedDraft.projects : [];
    if (rawProjects.length !== nextProjects.length) return true;
    const rawLineCount = rawProjects.reduce((sum, project) => {
      const mine = project?.selectedMine && typeof project.selectedMine === 'object' ? project.selectedMine : {};
      return sum + Object.keys(mine).length;
    }, 0);
    const nextLineCount = nextProjects.reduce(
      (sum, project) => sum + Object.keys(project?.selectedMine || {}).length,
      0
    );
    return rawLineCount !== nextLineCount;
  };

  const isOfferBrandVisibleForSupplierProfile = (profile, attributes, productBrand) => {
    const brandCandidate = resolveUpstreamBrandLabel(attributes, productBrand);
    return supplierCanAccessBrandStrict(profile || {}, brandCandidate).allowed;
  };

  const applyShippingToUpstreamProject = (project, enrichedShipping) => {
    if (!project || typeof project !== 'object') return project;
    if (enrichedShipping?.clear) {
      const next = { ...project };
      delete next.shippingAddress;
      delete next.shippingAddressId;
      delete next.location;
      delete next.siteGeo;
      return next;
    }
    if (!enrichedShipping?.shippingAddress) return project;
    const next = { ...project, shippingAddress: enrichedShipping.shippingAddress };
    if (enrichedShipping.shippingAddressId) {
      next.shippingAddressId = enrichedShipping.shippingAddressId;
    } else {
      delete next.shippingAddressId;
    }
    if (enrichedShipping.location) next.location = enrichedShipping.location;
    else delete next.location;
    if (enrichedShipping.siteGeo) next.siteGeo = enrichedShipping.siteGeo;
    else delete next.siteGeo;
    return next;
  };

  async function resolveUpstreamProjectShipping(userId, body = {}) {
    const shippingAddressId = String(body?.shippingAddressId || '').trim();
    const inlineAddress =
      body?.shippingAddress && typeof body.shippingAddress === 'object'
        ? normalizeAddress(body.shippingAddress)
        : null;

    if (inlineAddress && isAddressComplete(inlineAddress)) {
      return {
        shippingAddressId: shippingAddressId || null,
        shippingAddress: inlineAddress
      };
    }

    if (!shippingAddressId) {
      return null;
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('profile, user_type')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;

    const saved = deriveShippingAddressesFromProfile(user || {});
    const match = saved.find((entry) => String(entry.id) === shippingAddressId);
    if (!match) {
      return { error: 'Selected shipping address was not found in your profile.' };
    }

    return {
      shippingAddressId,
      shippingAddress: normalizeAddress(match)
    };
  }

  async function enrichUpstreamShippingMeta(shippingMeta) {
    if (!shippingMeta?.shippingAddress) return shippingMeta;
    const location = formatShippingAddressText(shippingMeta.shippingAddress);
    let siteGeo = null;
    try {
      const geo = await geocodeIndianAddress(shippingMeta.shippingAddress);
      if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
        siteGeo = { lat: geo.lat, lng: geo.lng };
      }
    } catch {
      // Geocoding is best-effort; ranking still uses city/state fallback.
    }
    return {
      ...shippingMeta,
      location,
      siteGeo
    };
  }

  async function resolveBuyerGeosForUpstreamSuggestions({
    userId,
    myOffers,
    projectId = '',
    shippingAddressIdOverride = ''
  }) {
    const buyerOutletGeos = [];
    const buyerGeoDiagnostics = {
      cartShippingTried: false,
      cartShippingResolved: false,
      shippingAddressOverrideTried: false,
      shippingAddressOverrideResolved: false,
      outletsChecked: 0,
      outletsResolved: 0,
      profileAddressTried: false,
      profileAddressResolved: false,
      branchesTried: 0,
      branchesResolved: 0,
      inventoryLocationTried: 0,
      inventoryLocationResolved: 0
    };
    let buyerGeoSource = 'none';
    let deliveryAddressLabel = '';

    const applyGeo = (geo, source, label) => {
      if (!isValidGeoLocation(geo)) return false;
      buyerOutletGeos.length = 0;
      buyerOutletGeos.push({ lat: geo.lat, lng: geo.lng });
      buyerGeoSource = source;
      if (label) deliveryAddressLabel = label;
      return true;
    };

    const applyGeoFromShippingProject = async (projectLike, source) => {
      const resolved = await resolveProjectShippingAddress(projectLike, { supabase, userId });
      const label =
        String(resolved.location || '').trim() ||
        formatShippingAddressText(resolved.shippingAddress || {});
      if (resolved.siteGeo && isValidGeoLocation(resolved.siteGeo)) {
        return applyGeo(resolved.siteGeo, source, label);
      }
      if (resolved.shippingAddress && isAddressComplete(normalizeAddress(resolved.shippingAddress))) {
        const geo = await geocodeIndianAddress(resolved.shippingAddress);
        return applyGeo(geo, source, label);
      }
      return false;
    };

    if (projectId) {
      buyerGeoDiagnostics.cartShippingTried = true;
      const { data: cartRow } = await supabase
        .from('po_carts')
        .select('draft_payload')
        .eq('service_provider_id', userId)
        .maybeSingle();
      const draft = normalizeUpstreamCartDraft(
        cartRow?.draft_payload && typeof cartRow.draft_payload === 'object'
          ? cartRow.draft_payload
          : {}
      );
      const project = (draft.projects || []).find((p) => String(p?.projectId || '') === projectId);
      if (project && (await applyGeoFromShippingProject(project, 'cart_shipping_address'))) {
        buyerGeoDiagnostics.cartShippingResolved = true;
      }
    }

    if (buyerOutletGeos.length === 0 && shippingAddressIdOverride) {
      buyerGeoDiagnostics.shippingAddressOverrideTried = true;
      const shippingMeta = await resolveUpstreamProjectShipping(userId, {
        shippingAddressId: shippingAddressIdOverride
      });
      if (shippingMeta?.shippingAddress) {
        const enriched = await enrichUpstreamShippingMeta(shippingMeta);
        if (
          await applyGeoFromShippingProject(
            {
              shippingAddress: enriched.shippingAddress,
              shippingAddressId: enriched.shippingAddressId,
              siteGeo: enriched.siteGeo,
              location: enriched.location
            },
            'selected_shipping_address'
          )
        ) {
          buyerGeoDiagnostics.shippingAddressOverrideResolved = true;
        }
      }
    }

    if (buyerOutletGeos.length === 0) {
      const { data: buyerOutletsGeoRows } = await supabase
        .from('outlets')
        .select('id, geo_location, address')
        .eq('supplier_id', userId)
        .eq('is_active', true)
        .limit(120);
      buyerGeoDiagnostics.outletsChecked = (buyerOutletsGeoRows || []).length;
      for (const o of buyerOutletsGeoRows || []) {
        const g = await resolveGeoFromOutletAddress(o?.geo_location, o?.address);
        if (g && typeof g.lat === 'number' && typeof g.lng === 'number') {
          buyerOutletGeos.push({ lat: g.lat, lng: g.lng });
          buyerGeoDiagnostics.outletsResolved += 1;
        }
      }
      if (buyerOutletGeos.length > 0) buyerGeoSource = 'outlet';
    }

    if (buyerOutletGeos.length === 0) {
      const { data: buyerUser } = await supabase
        .from('users')
        .select('address, profile')
        .eq('id', userId)
        .maybeSingle();
      buyerGeoDiagnostics.profileAddressTried = true;
      const buyerGeoFallback = await resolveGeoFromOutletAddress(null, buyerUser?.address || null);
      if (isValidGeoLocation(buyerGeoFallback)) {
        buyerOutletGeos.push({ lat: buyerGeoFallback.lat, lng: buyerGeoFallback.lng });
        buyerGeoSource = 'profile_address';
        buyerGeoDiagnostics.profileAddressResolved = true;
      }
      if (buyerOutletGeos.length === 0) {
        const legacyBranches = Array.isArray(buyerUser?.profile?.branches)
          ? buyerUser.profile.branches
          : [];
        buyerGeoDiagnostics.branchesTried = legacyBranches.length;
        for (const branch of legacyBranches) {
          const branchAddr = buildOutletAddressString(branch);
          if (!branchAddr) continue;
          const g = await resolveGeoFromOutletAddress(null, branchAddr);
          if (isValidGeoLocation(g)) {
            buyerOutletGeos.push({ lat: g.lat, lng: g.lng });
            buyerGeoSource = 'profile_branches';
            buyerGeoDiagnostics.branchesResolved += 1;
            break;
          }
        }
      }
    }

    if (buyerOutletGeos.length === 0) {
      const buyerLocationTexts = [
        ...new Set((myOffers || []).map((r) => String(r?.location || '').trim()).filter(Boolean))
      ];
      buyerGeoDiagnostics.inventoryLocationTried = buyerLocationTexts.length;
      for (const locText of buyerLocationTexts) {
        const g = await geocodeAddressNominatim(locText);
        if (isValidGeoLocation(g)) {
          buyerOutletGeos.push({ lat: g.lat, lng: g.lng });
          buyerGeoSource = 'inventory_location_text';
          buyerGeoDiagnostics.inventoryLocationResolved += 1;
          break;
        }
      }
    }

    return {
      buyerOutletGeos,
      buyerGeoSource,
      buyerGeoDiagnostics,
      deliveryAddressLabel
    };
  }

  const buildUpstreamProject = (payload = {}) => {
    const projectId = String(payload.projectId || `sup-proj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    const cartNameRaw = String(payload.cartName || '').trim();
    const rawRequiredDate = String(payload.requiredDate || '').trim();
    const requiredDate = /^\d{4}-\d{2}-\d{2}$/.test(rawRequiredDate) ? rawRequiredDate : '';
    const project = {
      projectId,
      cartName: cartNameRaw || `Project ${formatPlatformDate(new Date())}`,
      requiredDate,
      selectedMine: normalizeSelectedMineQuantities(
        payload.selectedMine && typeof payload.selectedMine === 'object' ? payload.selectedMine : {}
      ),
      selectedUpstreamOffer:
        payload.selectedUpstreamOffer && typeof payload.selectedUpstreamOffer === 'object'
          ? payload.selectedUpstreamOffer
          : {},
      suggestions: Array.isArray(payload.suggestions) ? payload.suggestions : [],
      brandFilter: String(payload.brandFilter || '').trim(),
      searchTerm: String(payload.searchTerm || '').trim(),
      createdAt: payload.createdAt || new Date().toISOString()
    };
    const shippingAddressId = String(payload.shippingAddressId || '').trim();
    const shippingAddress =
      payload.shippingAddress && typeof payload.shippingAddress === 'object'
        ? normalizeAddress(payload.shippingAddress)
        : null;
    if (shippingAddressId) project.shippingAddressId = shippingAddressId;
    if (shippingAddress && isAddressComplete(shippingAddress)) {
      project.shippingAddress = shippingAddress;
    }
    if (payload.location) project.location = String(payload.location).trim();
    if (payload.siteGeo && typeof payload.siteGeo === 'object') {
      project.siteGeo = payload.siteGeo;
    }
    return project;
  };

  const normalizeUpstreamProjectNameKey = (value) => String(value || '').trim().toLowerCase();
  const normalizeUpstreamProjectDateKey = (value) => String(value || '').trim().slice(0, 10);
  const hasDuplicateUpstreamProject = (projects, cartName, requiredDate, excludeProjectId = '') => {
    const nameKey = normalizeUpstreamProjectNameKey(cartName);
    const dateKey = normalizeUpstreamProjectDateKey(requiredDate);
    return (Array.isArray(projects) ? projects : []).some((project) => {
      const projectId = String(project?.projectId || '').trim();
      if (excludeProjectId && projectId === excludeProjectId) return false;
      return (
        normalizeUpstreamProjectNameKey(project?.cartName || '') === nameKey &&
        normalizeUpstreamProjectDateKey(project?.requiredDate || '') === dateKey
      );
    });
  };

  const normalizeUpstreamCartDraft = (rawDraft = {}) => {
    const raw = rawDraft && typeof rawDraft === 'object' ? rawDraft : {};
    let projects = [];
    if (Array.isArray(raw.projects)) {
      projects = raw.projects
        .map((p) => buildUpstreamProject(p))
        .filter(hasUpstreamProjectLines);
    } else {
      const legacyHasData =
        (raw.selectedMine && Object.keys(raw.selectedMine || {}).length > 0) ||
        (raw.selectedUpstreamOffer && Object.keys(raw.selectedUpstreamOffer || {}).length > 0) ||
        (Array.isArray(raw.suggestions) && raw.suggestions.length > 0);
      if (legacyHasData) {
        const legacyProject = buildUpstreamProject({
          projectId: raw.projectId || null,
          cartName: raw.cartName || 'Supplier Cart',
          selectedMine: raw.selectedMine || {},
          selectedUpstreamOffer: raw.selectedUpstreamOffer || {},
          suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : [],
          brandFilter: String(raw.brandFilter || '').trim(),
          searchTerm: String(raw.searchTerm || '').trim(),
          createdAt: raw.createdAt || new Date().toISOString()
        });
        if (hasUpstreamProjectLines(legacyProject)) {
          projects = [legacyProject];
        }
      }
    }
    projects.sort((a, b) => {
      const aTs = Date.parse(a?.createdAt || 0) || 0;
      const bTs = Date.parse(b?.createdAt || 0) || 0;
      if (bTs !== aTs) return bTs - aTs;
      return String(a?.projectId || '').localeCompare(String(b?.projectId || ''));
    });
    const latestProject = projects.length > 0 ? projects[0] : null;
    return {
      mode: 'supplier_upstream',
      projects,
      projectId: latestProject?.projectId || null,
      cartName: latestProject?.cartName || String(raw.cartName || 'Supplier Cart'),
      selectedMine: latestProject?.selectedMine || {},
      selectedUpstreamOffer: latestProject?.selectedUpstreamOffer || {},
      suggestions: latestProject?.suggestions || [],
      brandFilter: latestProject?.brandFilter || '',
      searchTerm: latestProject?.searchTerm || ''
    };
  };

// Catalog detail for a product a supplier is sourcing upstream. Same payload as service-provider
// discovery detail, but offers are not restricted to the brand's retailer-facing terminal tier.
router.get('/upstream/products/:productId/detail', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res
        .status(403)
        .json({ status: 'error', message: 'Only suppliers can view upstream product details' });
    }

    const productId = String(req.params.productId || '').trim();
    const result = await getProductDiscoveryDetail(supabase, {
      productId,
      audience: DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM,
      viewerSupplierId: req.userId
    });

    if (!result.ok) {
      return res.status(result.status || 404).json({
        status: 'error',
        message: result.message || 'Product not found'
      });
    }

    return res.json({
      status: 'success',
      audience: result.audience,
      product: result.product,
      family: result.family,
      hasVariants: result.hasVariants,
      variantCount: result.variantCount,
      variantOptions: result.variantOptions,
      variants: result.variants
    });
  } catch (error) {
    console.error('Upstream product detail error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.get('/upstream/suggestions', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can fetch upstream suggestions' });
    }

    const supplierProductIdsRaw = req.query.supplierProductIds;
    const supplierProductIds = Array.isArray(supplierProductIdsRaw)
      ? supplierProductIdsRaw
      : String(supplierProductIdsRaw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    const limitPerItem = Math.min(10, Math.max(1, parseInt(req.query.limit, 10) || 5));
    const queryProjectId = String(req.query.projectId || '').trim();
    const queryShippingAddressId = String(req.query.shippingAddressId || '').trim();

    if (supplierProductIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'supplierProductIds is required (comma-separated)'
      });
    }

    // Load my selected supplier offers
    const { data: myRows, error: myErr } = await supabase
      .from('supplier_products')
      .select(
        'id, product_id, variant_key, variant_asin, stock, min_order_quantity, outlet_id, location, attributes, is_active, status, product:products(brand, status)'
      )
      .eq('supplier_id', req.userId)
      .in('id', supplierProductIds)
      .eq('is_active', true)
      .neq('status', 'rejected');

    if (myErr) throw myErr;

    const myOffers = (myRows || []).filter(
      (r) =>
        isOfferBrandVisibleForSupplierProfile(req.user?.profile || {}, r?.attributes, r?.product?.brand) &&
        isSupplierOfferEligibleForUpstreamSelection(r, r.product)
    );
    if (myOffers.length === 0) {
      return res.json({ status: 'success', parentRole: null, parentRoles: [], items: [] });
    }

    // Fallback union of immediate upstream partner types for every role the buyer declared (multi-role safe).
    const parentRolesUnion = getImmediateParentRolesUnion(req.user.profile);
    const parentRolesSorted = [...parentRolesUnion].sort((a, b) => (ROLE_DEPTH[a] ?? 99) - (ROLE_DEPTH[b] ?? 99));
    const parentRole = parentRolesSorted[0] || null; // legacy single label (first tier toward MGF)

    if (parentRolesUnion.size === 0) {
      return res.json({
        status: 'success',
        parentRole: null,
        parentRoles: [],
        items: myOffers.map((r) => ({
          mineSupplierProductId: r.id,
          productId: r.product_id,
          brandModel: r?.attributes?.brandModel || null,
          upstreamOffers: [],
          message: 'No upstream role available for your current supply-chain role (e.g. manufacturer has no upstream).'
        }))
      });
    }

    const selectedBrandNames = [
      ...new Set(
        myOffers
          .map((r) => resolveUpstreamBrandLabel(r?.attributes, r?.product?.brand))
          .filter(Boolean)
      )
    ];
    const adminBrandChainMap = await loadAdminBrandChainsByName({
      supabase,
      brandNames: selectedBrandNames
    });

    // Fetch upstream offers for the same catalog product (and variant when available).
    // Supply-chain orders match registered upstream partners on shared catalog product id (TSIN);
    // exact variant_key / variant_asin is preferred in ranking but not required.
    const productIds = [...new Set(myOffers.map((r) => r.product_id).filter(Boolean))];
    const myVariantKeys = [
      ...new Set(myOffers.map((r) => String(r?.variant_key || '').trim()).filter(Boolean))
    ];
    const myVariantAsins = [
      ...new Set(myOffers.map((r) => String(r?.variant_asin || '').trim()).filter(Boolean))
    ];

    if (productIds.length === 0 && myVariantKeys.length === 0 && myVariantAsins.length === 0) {
      return res.json({
        status: 'success',
        parentRole,
        parentRoles: parentRolesSorted,
        rankPriority: UPSTREAM_RANK_PRIORITY,
        limit: limitPerItem,
        items: myOffers.map((r) => ({
          mineSupplierProductId: r.id,
          productId: r.product_id || null,
          brandModel: r?.attributes?.brandModel || null,
          upstreamOffers: [],
          message: 'No catalog product id found for selected item(s).'
        }))
      });
    }

    const upstreamOfferSelect =
      'id, product_id, variant_key, variant_asin, supplier_id, stock, price, outlet_id, location, status, is_active, attributes, min_order_quantity, product:products(brand, status)';

    // Load upstream offers directly (source of truth) and then load supplier profiles for display.
    const upstreamOffersById = new Map();
    const registerUpstreamRows = async (rows = []) => {
      for (const row of rows || []) {
        if (!row?.id) continue;
        let effectiveRow = row;
        const { needsCatalogSync } = resolveEffectiveSupplierOfferState(row, row.product);
        if (needsCatalogSync) {
          effectiveRow = await syncSupplierOfferApprovalFromCatalog(supabase, row);
        }
        if (isSupplierOfferAvailableForUpstream(effectiveRow, effectiveRow.product)) {
          upstreamOffersById.set(effectiveRow.id, effectiveRow);
        }
      }
    };
    if (productIds.length > 0) {
      const { data: rowsByProductId } = await supabase
        .from('supplier_products')
        .select(upstreamOfferSelect)
        .in('product_id', productIds)
        .neq('status', 'rejected')
        .gt('stock', 0);
      await registerUpstreamRows(rowsByProductId || []);
    }
    if (myVariantKeys.length > 0) {
      const { data: rowsByVariantKey } = await supabase
        .from('supplier_products')
        .select(upstreamOfferSelect)
        .in('variant_key', myVariantKeys)
        .neq('status', 'rejected')
        .gt('stock', 0);
      await registerUpstreamRows(rowsByVariantKey || []);
    }
    if (myVariantAsins.length > 0) {
      const { data: rowsByVariantAsin } = await supabase
        .from('supplier_products')
        .select(upstreamOfferSelect)
        .in('variant_asin', myVariantAsins)
        .neq('status', 'rejected')
        .gt('stock', 0);
      await registerUpstreamRows(rowsByVariantAsin || []);
    }
    const upstreamOffers = [...upstreamOffersById.values()];
    const reservedQtyByProductId = await getActiveReservedQuantitiesByProductIds(
      upstreamOffers.map((offer) => offer.id)
    );

    const upstreamSupplierIds = [
      ...new Set((upstreamOffers || []).map((o) => o.supplier_id).filter(Boolean))
    ].filter((id) => id !== req.userId);

    if (upstreamSupplierIds.length === 0) {
      const emptyItemContexts = myOffers.map((mine) =>
        buildUpstreamChainContextForMineOffer({
          profile: req.user.profile || {},
          mineOffer: mine,
          adminBrandChainMap,
          parentRolesUnion
        })
      );
      const requiredRoles = collectRequiredUpstreamRolesFromContexts(emptyItemContexts);
      const responseParentRoles =
        requiredRoles.length > 0 ? requiredRoles : [];
      const responseParentRole = responseParentRoles[0] || null;

      return res.json({
        status: 'success',
        parentRole: responseParentRole,
        parentRoles: responseParentRoles,
        items: myOffers.map((mine, index) => {
          const ctx = emptyItemContexts[index];
          return {
            mineSupplierProductId: mine.id,
            productId: mine.product_id,
            mineVariantKey: String(mine?.variant_key || '').trim() || null,
            mineVariantAsin: String(mine?.variant_asin || '').trim() || null,
            brandModel: ctx.brandLabel || mine?.attributes?.brandModel || null,
            upstreamRole: ctx.requiredUpstreamRole || responseParentRole,
            upstreamRoles: ctx.requiredUpstreamRole ? [ctx.requiredUpstreamRole] : responseParentRoles,
            chainRouting: ctx.chainRouting,
            upstreamOffers: [],
            message: buildNoUpstreamOffersMessage(ctx)
          };
        })
      });
    }

    // Brand overlap tokens: union of brandModel tokens from selected offers.
    const viewerBrandTokens = new Set();
    for (const r of myOffers) {
      parseBrandTokens(r?.attributes?.brandModel).forEach((t) => viewerBrandTokens.add(t));
    }

    // Load upstream suppliers (only those who actually have offers)
    const { data: upstreamUsers } = await supabase
      .from('users')
      .select('id, name, company, email, phone, address, profile')
      .eq('user_type', 'supplier')
      .eq('is_active', true)
      .in('id', upstreamSupplierIds);

    // Load upstream supplier display info map
    const upstreamUserMap = {};
    (upstreamUsers || []).forEach((u) => {
      upstreamUserMap[u.id] = u;
    });

    const registeredPartnerIdsByBrandKey = buildRegisteredUpstreamPartnerIdsByBrandKey({
      buyerProfile: req.user.profile || {},
      adminBrandChainMap,
      upstreamUsers: upstreamUsers || [],
      parentRolesUnion
    });

    // Distance ranking origin: selected cart shipping address first, then legacy outlet/profile fallbacks.
    const {
      buyerOutletGeos,
      buyerGeoSource,
      buyerGeoDiagnostics,
      deliveryAddressLabel
    } = await resolveBuyerGeosForUpstreamSuggestions({
      userId: req.userId,
      myOffers,
      projectId: queryProjectId,
      shippingAddressIdOverride: queryShippingAddressId
    });

    // Load upstream outlet geo for distance calc
    const upstreamOutletIds = [...new Set((upstreamOffers || []).map((r) => r.outlet_id).filter(Boolean))];
    const upstreamOutletGeoById = {};
    const upstreamOutletAddressTextById = {};
    if (upstreamOutletIds.length > 0) {
      const { data: outs } = await supabase
        .from('outlets')
        .select('id, geo_location, address')
        .in('id', upstreamOutletIds)
        .eq('is_active', true);
      for (const o of outs || []) {
        const g = await resolveGeoFromOutletAddress(o?.geo_location, o?.address);
        if (isValidGeoLocation(g)) upstreamOutletGeoById[o.id] = g;
        const addrText = buildOutletAddressString(o?.address || '');
        if (addrText) upstreamOutletAddressTextById[o.id] = addrText;
      }
    }

    // Fallback: if an offer has no resolvable outlet geo, try geocoding its location text.
    const offerGeoByOfferId = {};
    const locationGeoCache = new Map();
    const supplierGeoCache = new Map();
    const supplierBranchGeoCache = new Map();
    for (const offer of upstreamOffers || []) {
      let geoSource = 'none';
      let geo = offer?.outlet_id ? upstreamOutletGeoById[offer.outlet_id] : null;
      if (isValidGeoLocation(geo)) geoSource = 'outlet';
      if (!isValidGeoLocation(geo)) {
        const locText = String(offer?.location || '').trim();
        if (locText) {
          if (!locationGeoCache.has(locText)) {
            locationGeoCache.set(locText, await geocodeAddressNominatim(locText));
          }
          const approx = locationGeoCache.get(locText);
          if (isValidGeoLocation(approx)) {
            geo = approx;
            geoSource = 'offer_location_text';
          }
        }
      }
      if (!isValidGeoLocation(geo)) {
        const sup = upstreamUserMap[offer.supplier_id];
        if (sup?.id) {
          if (!supplierGeoCache.has(sup.id)) {
            supplierGeoCache.set(sup.id, await resolveGeoFromOutletAddress(null, sup.address || null));
          }
          const approxAddrGeo = supplierGeoCache.get(sup.id);
          if (isValidGeoLocation(approxAddrGeo)) {
            geo = approxAddrGeo;
            geoSource = 'supplier_profile_address';
          }
        }
      }
      // Legacy fallback: many suppliers only saved branch locations in profile.branches.
      if (!isValidGeoLocation(geo)) {
        const sup = upstreamUserMap[offer.supplier_id];
        if (sup?.id) {
          if (!supplierBranchGeoCache.has(sup.id)) {
            let branchGeo = null;
            const branches = Array.isArray(sup?.profile?.branches) ? sup.profile.branches : [];
            for (const branch of branches) {
              const branchAddr = buildOutletAddressString(branch);
              if (!branchAddr) continue;
              const g = await resolveGeoFromOutletAddress(null, branchAddr);
              if (isValidGeoLocation(g)) {
                branchGeo = g;
                break;
              }
            }
            supplierBranchGeoCache.set(sup.id, branchGeo);
          }
          const approxBranchGeo = supplierBranchGeoCache.get(sup.id);
          if (isValidGeoLocation(approxBranchGeo)) {
            geo = approxBranchGeo;
            geoSource = 'supplier_profile_branches';
          }
        }
      }
      offerGeoByOfferId[offer.id] = isValidGeoLocation(geo) ? { geo, source: geoSource } : null;
    }

    // Precompute nearest road distance from buyer outlets to each upstream offer.
    // This avoids straight-line bias and keeps ranking stable for delivery relevance.
    const roadDistanceKmByOfferId = {};
    if (buyerOutletGeos.length > 0) {
      const uniqueOfferGeoEntries = [];
      const geoKeyToIndex = new Map();
      const offerIdToGeoIndex = new Map();
      for (const offer of upstreamOffers || []) {
        const geoInfo = offerGeoByOfferId[offer.id];
        const geo = geoInfo?.geo;
        if (!geo || typeof geo.lat !== 'number' || typeof geo.lng !== 'number') continue;
        const geoKey = `${geo.lat.toFixed(6)},${geo.lng.toFixed(6)}`;
        let idx = geoKeyToIndex.get(geoKey);
        if (idx == null) {
          idx = uniqueOfferGeoEntries.length;
          uniqueOfferGeoEntries.push(geo);
          geoKeyToIndex.set(geoKey, idx);
        }
        offerIdToGeoIndex.set(offer.id, idx);
      }

      if (uniqueOfferGeoEntries.length > 0) {
        const minRoadKmByGeoIdx = await getMinDrivingDistanceFromOriginsKm(
          buyerOutletGeos,
          uniqueOfferGeoEntries
        );
        for (const offer of upstreamOffers || []) {
          const geoInfo = offerGeoByOfferId[offer.id];
          const geo = geoInfo?.geo;
          const geoIdx = offerIdToGeoIndex.get(offer.id);
          const roadKm = typeof geoIdx === 'number' ? minRoadKmByGeoIdx[geoIdx] : null;
          if (roadKm != null && Number.isFinite(roadKm)) {
            roadDistanceKmByOfferId[offer.id] = roadKm;
            continue;
          }
          if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
            // Fallback only when routing API cannot resolve.
            roadDistanceKmByOfferId[offer.id] = minHaversineKmBuyerOutletsToSeller(buyerOutletGeos, geo);
          } else {
            roadDistanceKmByOfferId[offer.id] = null;
          }
        }
      }
    }

    // Average supplier ratings (from past orders — service providers and chain buyers)
    const ratingSumBySupplier = new Map();
    const ratingCountBySupplier = new Map();
    if (upstreamSupplierIds.length > 0) {
      const { data: ratingRows } = await supabase
        .from('supplier_ratings')
        .select('supplier_id, rating')
        .in('supplier_id', upstreamSupplierIds);
      for (const row of ratingRows || []) {
        const sid = row.supplier_id;
        if (!sid) continue;
        const rv = parseFloat(row.rating);
        if (!Number.isFinite(rv)) continue;
        ratingCountBySupplier.set(sid, (ratingCountBySupplier.get(sid) || 0) + 1);
        ratingSumBySupplier.set(sid, (ratingSumBySupplier.get(sid) || 0) + rv);
      }
    }

    const getSupplierRatingSummary = (supplierId) => {
      const n = ratingCountBySupplier.get(supplierId) || 0;
      if (!n) return { averageRating: null, ratingCount: 0 };
      const avg = ratingSumBySupplier.get(supplierId) / n;
      return { averageRating: Math.round(avg * 100) / 100, ratingCount: n };
    };

    const items = myOffers.map((mine) => {
      const mineVariantKey = String(mine?.variant_key || '').trim();
      const mineVariantAsin = String(mine?.variant_asin || '').trim();
      const chainContext = buildUpstreamChainContextForMineOffer({
        profile: req.user.profile || {},
        mineOffer: mine,
        adminBrandChainMap,
        parentRolesUnion
      });
      const brandLabel = chainContext.brandLabel;
      const desiredBrand = String(brandLabel || '').trim().toLowerCase();
      const brandKey = chainContext.brandKey;
      const chainRow = chainContext.chainRow;
      const buyerRole = chainContext.buyerRole;
      const allowedRolesSet = chainContext.allowedRolesSet;
      const { chainRouting } = chainContext;

      const upstreamEligiblePool = (upstreamOffers || []).filter((offer) => {
        if (!offer) return false;
        if (offer.supplier_id === req.userId) return false;
        return upstreamOffersMatchForSupplyChain(mine, offer);
      });

      const brandMatchedPool = upstreamEligiblePool.filter((u) => {
        if (!desiredBrand) return true;
        const offerBrand = resolveUpstreamBrandLabel(u?.attributes, u?.product?.brand).toLowerCase();
        return offerBrand
          ? offerBrand === desiredBrand || offerBrand.includes(desiredBrand) || desiredBrand.includes(offerBrand)
          : true;
      });

      const brandTokenForMatch = brandLabel || desiredBrand || '';
      const registeredPartnerIds = registeredPartnerIdsByBrandKey.get(brandKey) || new Set();
      const candidates = brandMatchedPool
        .filter((offer) => {
          if (!offer.supplier_id || offer.supplier_id === req.userId) return false;
          const sup = upstreamUserMap[offer.supplier_id];
          if (!sup?.profile) return false;
          if (registeredPartnerIds.has(offer.supplier_id)) return true;
          if (
            sellerMatchesUpstreamForBrand(
              sup.profile,
              allowedRolesSet,
              brandTokenForMatch,
              chainRouting
            )
          ) {
            return true;
          }
          return sellerHasAnyUpstreamRoleForBrand(
            sup.profile,
            buyerRole,
            brandTokenForMatch,
            chainRow
          );
        })
        .map((u) => {
          const geoInfo = offerGeoByOfferId[u.id] || null;
          const geo = geoInfo?.geo || null;
          const distRaw =
            roadDistanceKmByOfferId[u.id] != null ? roadDistanceKmByOfferId[u.id] : null;
          const dist = distRaw != null ? Math.round(distRaw * 10) / 10 : null;
          const sup = upstreamUserMap[u.supplier_id];
          const outletAddressText = u?.outlet_id ? upstreamOutletAddressTextById[u.outlet_id] || '' : '';
          const supplierAddressText = buildOutletAddressString(sup?.address || '');
          const supplierBranchAddressText = getFirstSupplierBranchAddressText(sup?.profile || {});
          const offerLocationText = String(u?.location || '').trim();
          let locationDisplay = '';
          let locationSource = null;
          if (offerLocationText) {
            locationDisplay = offerLocationText;
            locationSource = 'offer_location';
          } else if (outletAddressText) {
            locationDisplay = outletAddressText;
            locationSource = 'offer_outlet_address';
          } else if (supplierAddressText) {
            locationDisplay = supplierAddressText;
            locationSource = 'supplier_profile_address';
          } else if (supplierBranchAddressText) {
            locationDisplay = supplierBranchAddressText;
            locationSource = 'supplier_profile_branches';
          }
          const matchedRole = sup
            ? pickUpstreamSellerRoleForBrand(
                sup.profile,
                allowedRolesSet,
                brandTokenForMatch,
                chainRouting
              ) ||
              pickAnyUpstreamSellerRoleOnChain(sup.profile, buyerRole, brandTokenForMatch, chainRow) ||
              (registeredPartnerIds.has(u.supplier_id)
                ? getImmediateUpstreamRoleForBrand({
                    profile: req.user.profile || {},
                    brandKey,
                    chainRow,
                    buyerRole,
                    parentRolesUnion
                  })
                : null)
            : null;
          const roleForMap = matchedRole || parentRole;
          const { averageRating, ratingCount } = getSupplierRatingSummary(u.supplier_id);
          const variantMatchType = getUpstreamOfferMatchType(mine, u) || 'catalog_product';
          const supplierDetails =
            sup && roleForMap
              ? (mapSupplyChainPartner(sup, roleForMap, viewerBrandTokens) || {
                  id: sup.id,
                  name: sup.name,
                  company: sup.company || '',
                  phone: sup.phone || '',
                  email: sup.email || '',
                  address: sup.address || {},
                  supplierRole: roleForMap,
                  supplierRoleLabel: SUPPLY_CHAIN_ROLE_LABELS[roleForMap] || roleForMap,
                  brands: sup?.profile?.brands || ''
                })
              : null;
          const onHandStock = parseSupplierStockQuantity(u.stock) ?? 0;
          const availableStock = computeAvailableStock(
            onHandStock,
            reservedQtyByProductId.get(u.id) || 0
          );
          return {
            supplierId: u.supplier_id,
            supplierName: sup?.name || sup?.company || 'Supplier',
            supplierCompany: sup?.company || '',
            upstreamRole: roleForMap,
            mineSupplierProductId: mine.id,
            upstreamSupplierProductId: u.id,
            productId: mine.product_id,
            upstreamProductId: u.product_id,
            offerStatus: u.status,
            isActive: u.is_active,
            stock: availableStock,
            availableStock,
            price: u.price,
            minOrderQuantity: u.min_order_quantity,
            location: locationDisplay,
            locationSource,
            offerOutletAddress: outletAddressText || null,
            offerGeoLocation: geo || null,
            distanceSource: geoInfo?.source || null,
            brandModel: u?.attributes?.brandModel || null,
            mineVariantKey: mineVariantKey || null,
            mineVariantAsin: mineVariantAsin || null,
            upstreamVariantKey: String(u?.variant_key || '').trim() || null,
            upstreamVariantAsin: String(u?.variant_asin || '').trim() || null,
            variantMatchType,
            supplierDetails,
            distanceKm: dist,
            distanceKmRaw: distRaw,
            averageRating,
            ratingCount,
            minimumOrderValueInr: roleForMap
              ? getMinimumOrderValueInrForSellerRole(sup?.profile || {}, roleForMap)
              : 0
          };
        });

      const deduped = dedupeUpstreamCandidatesBySupplierPreferClosest(candidates);
      const ranked = rankUpstreamOffersForProduct(deduped);
      const top = ranked.slice(0, limitPerItem).map(({ distanceKmRaw: _r, ...rest }) => rest);

      let itemMessage = null;
      if (top.length === 0) {
        const exactVariantPool = upstreamEligiblePool.filter((offer) =>
          getUpstreamOfferMatchType(mine, offer) === 'exact_variant'
        );
        if (upstreamEligiblePool.length === 0) {
          const upstreamLabel =
            chainContext.requiredUpstreamRoleLabel ||
            formatUpstreamRoleLabel(chainRouting.requiredUpstreamRole) ||
            'your upstream supply-chain partner';
          itemMessage = `No upstream partners list this product with stock right now. Ask your ${upstreamLabel} to add it.`;
        } else if (exactVariantPool.length === 0 && registeredPartnerIds.size > 0) {
          const registeredNames = [...registeredPartnerIds]
            .map((id) => upstreamUserMap[id]?.name || upstreamUserMap[id]?.company)
            .filter(Boolean);
          itemMessage = `Your upstream partner(s) for "${brandLabel || desiredBrand}" (${registeredNames.join(', ')}) list this product but none passed supply-chain validation. Check their role and brand on Who are you.`;
        } else if (brandMatchedPool.length === 0) {
          itemMessage = `No upstream listings matched brand "${brandLabel || desiredBrand}".`;
        } else if (candidates.length === 0 && allowedRolesSet.size > 0) {
          const preferredTier =
            chainContext.requiredUpstreamRoleLabel ||
            formatUpstreamRoleLabel(chainRouting.requiredUpstreamRole) ||
            'your upstream supply-chain partner';
          const registeredNames = [...registeredPartnerIds]
            .map((id) => upstreamUserMap[id]?.name || upstreamUserMap[id]?.company)
            .filter(Boolean);
          const registeredHint =
            registeredNames.length > 0
              ? ` Your registered upstream partner(s) for this brand (${registeredNames.join(', ')}) do not list this exact variant with stock — ask them to add it, or check their supply-chain role and brand on Who are you.`
              : '';
          itemMessage = `Listings exist for this product, but none from ${preferredTier} for brand "${brandLabel || desiredBrand}". Only the layer directly above you on the admin supply chain is accepted.${registeredHint}`;
        } else if (candidates.length === 0) {
          itemMessage =
            'Partners exist for this product, but none match your allowed upstream supply-chain layer.';
        } else {
          itemMessage = 'No upstream offers available after ranking.';
        }
      }

      return {
        mineSupplierProductId: mine.id,
        productId: mine.product_id,
        mineVariantKey: mineVariantKey || null,
        mineVariantAsin: mineVariantAsin || null,
        brandModel: brandLabel || mine?.attributes?.brandModel || null,
        upstreamRole: chainContext.requiredUpstreamRole || chainRouting.requiredUpstreamRole || null,
        upstreamRoles: chainContext.requiredUpstreamRole ? [chainContext.requiredUpstreamRole] : [],
        chainRouting: chainContext.chainRouting,
        upstreamOffers: top,
        message: itemMessage
      };
    });

    const itemContexts = items.map((item) => ({
      requiredUpstreamRole: item?.chainRouting?.requiredUpstreamRole || item?.upstreamRole || null,
      chainRouting: item.chainRouting
    }));
    const responseParentRoles = collectRequiredUpstreamRolesFromContexts(itemContexts);
    const resolvedParentRoles =
      responseParentRoles.length > 0 ? responseParentRoles : [];

    return res.json({
      status: 'success',
      parentRole: resolvedParentRoles[0] || null,
      parentRoles: resolvedParentRoles,
      rankPriority: UPSTREAM_RANK_PRIORITY,
      limit: limitPerItem,
      distanceAvailable: buyerOutletGeos.length > 0,
      buyerGeoSource,
      buyerGeoDiagnostics,
      deliveryAddressLabel: deliveryAddressLabel || null,
      chainPolicy:
        'Uses Admin → Supply Chain per brand. Upstream seller = tier directly above you in that chain (walkback skips absent tiers e.g. dealer).',
      distanceRanking:
        buyerOutletGeos.length > 0
          ? buyerGeoSource === 'selected_shipping_address' || buyerGeoSource === 'cart_shipping_address'
            ? `Partners are ranked by road distance from your selected delivery address${
                deliveryAddressLabel ? ` (${deliveryAddressLabel})` : ''
              }. The nearest seller appears first for each product.`
            : 'Distance ranking uses your outlet or profile location. Select a delivery address on the cart or upstream page for delivery-site ranking.'
          : queryProjectId || queryShippingAddressId
            ? 'Distance ranking is unavailable because the selected delivery address could not be geocoded. Check the address (street, city, state, PIN) and try again.'
            : 'Distance ranking is unavailable because no delivery address was selected and your location could not be resolved. Add a shipping address to your cart project or profile.',
      items
    });
  } catch (e) {
    console.error('Upstream suggestions error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to load upstream suggestions' });
  }
});

/**
 * Preview how upstream checkout lines club into transport / order groups.
 * Same upstream supplier + same delivery address → one group (one transport button).
 */
router.post('/upstream/orders/preview-groups', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can preview upstream order groups' });
    }

    const payload = parseWithSchema(supplierUpstreamPreviewGroupsSchema, req.body || {});
    const normalizedShipping = normalizeAddress(payload.shippingAddress || {});
    const normalizedBilling = normalizeAddress(payload.billingAddress || {});
    const deliveryDestination =
      String(payload.deliveryDestination || 'shipping').toLowerCase() === 'billing' ? 'billing' : 'shipping';
    const defaultDelivery =
      deliveryDestination === 'billing' && isAddressComplete(normalizedBilling)
        ? normalizedBilling
        : normalizedShipping;

    const rawGroups = [];
    for (const line of payload.reviewLines || []) {
      const vendorId = String(line?.supplierId || '').trim();
      if (!vendorId) continue;
      const lineShipping = line?.shippingAddress
        ? normalizeAddress(line.shippingAddress)
        : defaultDelivery;
      const transportGroupId = buildTransportGroupId(vendorId, lineShipping);
      const qty = Number(line?.quantity || 0) || 0;
      const unitPrice = Number(line?.unitPrice || 0) || 0;
      const lineTotal = Number(line?.lineTotal ?? qty * unitPrice) || 0;

      rawGroups.push({
        vendorId,
        transportGroupId,
        shippingAddressKey: buildShippingAddressKey(lineShipping),
        shippingAddress: lineShipping,
        shippingAddressLabel: formatShippingAddressLabel(lineShipping),
        vendorName: String(line?.supplierName || 'Supplier'),
        total: lineTotal,
        items: [
          {
            name: String(line?.productName || 'Product'),
            quantity: qty,
            unit: String(line?.unit || 'nos'),
            price: unitPrice,
            specifications: line?.specifications || null,
            images: Array.isArray(line?.images) ? line.images : []
          }
        ]
      });
    }

    const groups = consolidatePoTransportGroups(rawGroups).map((group) => ({
      ...group,
      total: Math.round((Number(group.total || 0)) * 100) / 100
    }));

    return res.json({
      status: 'success',
      groups,
      message:
        groups.length > 0
          ? `${groups.length} shipment group(s) — same supplier + same delivery address are clubbed together`
          : 'No groups could be built from the supplied lines'
    });
  } catch (error) {
    console.error('Upstream preview groups error:', error);
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    return res.status(500).json({ status: 'error', message: 'Failed to preview upstream order groups' });
  }
});

router.get('/upstream/checkout-reservation-config', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can read checkout reservation config' });
    }
    return res.json({
      status: 'success',
      expiresInMinutes: CHECKOUT_RESERVATION_MINUTES
    });
  } catch (error) {
    console.error('Upstream checkout reservation config error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load checkout reservation config' });
  }
});

router.post('/upstream/checkout-reservations', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can reserve upstream inventory' });
    }

    const payload = parseWithSchema(supplierUpstreamCheckoutReserveSchema, req.body || {});
    const result = await reserveUpstreamCheckoutLines({
      buyerUserId: req.userId,
      checkoutSessionId: payload.checkoutSessionId,
      lines: payload.lines
    });

    return res.json({
      status: 'success',
      message: `Inventory held for ${CHECKOUT_RESERVATION_MINUTES} minutes while you complete checkout`,
      checkoutSessionId: result.checkoutSessionId,
      expiresAt: result.expiresAt,
      expiresInMinutes: result.expiresInMinutes,
      reservations: (result.reservations || []).map((row) => ({
        id: row.id,
        supplierProductId: row.supplier_product_id,
        supplierId: row.supplier_id,
        reservedQuantity: row.reserved_quantity,
        expiresAt: row.expires_at
      }))
    });
  } catch (error) {
    console.error('Upstream checkout reserve error:', error);
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    const rawMessage = String(error?.message || '');
    const isDuplicateReservation =
      String(error?.code || '') === '23505' ||
      /inventory_reservations_idempotency_key/i.test(rawMessage) ||
      /duplicate key value violates unique constraint/i.test(rawMessage);
    return res.status(400).json({
      status: 'error',
      message: isDuplicateReservation
        ? 'Could not reserve inventory because a checkout hold is already in progress. Please retry checkout.'
        : rawMessage || 'Failed to reserve inventory for checkout'
    });
  }
});

router.get('/upstream/checkout-reservations/:checkoutSessionId', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can view checkout reservations' });
    }

    const checkoutSessionId = String(req.params?.checkoutSessionId || '').trim();
    if (!checkoutSessionId) {
      return res.status(400).json({ status: 'error', message: 'checkoutSessionId is required' });
    }

    const status = await getUpstreamCheckoutReservationStatus({
      buyerUserId: req.userId,
      checkoutSessionId
    });

    return res.json({ status: 'success', ...status });
  } catch (error) {
    console.error('Upstream checkout reservation status error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load checkout reservation status' });
  }
});

router.delete('/upstream/checkout-reservations', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can release checkout reservations' });
    }

    const payload = parseWithSchema(supplierUpstreamCheckoutReleaseSchema, req.body || {});
    const result = await releaseUpstreamCheckoutReservations({
      buyerUserId: req.userId,
      checkoutSessionId: payload.checkoutSessionId || null,
      actorUserId: req.userId
    });

    return res.json({
      status: 'success',
      message:
        result.released > 0
          ? 'Inventory hold released — stock is available again for other buyers'
          : 'No active inventory hold to release',
      released: result.released
    });
  } catch (error) {
    console.error('Upstream checkout release error:', error);
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    return res.status(500).json({ status: 'error', message: 'Failed to release checkout reservations' });
  }
});

/**
 * Create upstream order(s): supplier (buyer) -> upstream supplier(s) (seller)
 *
 * Body:
 * {
 *   lines: [
 *     { mineSupplierProductId, upstreamSupplierProductId, quantity }
 *   ]
 * }
 */
router.post('/upstream/orders', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can create upstream orders' });
    }

    const payloadInput = parseWithSchema(supplierUpstreamOrdersSchema, req.body || {});
    const {
      lines,
      requiredDate,
      paymentMethod,
      shippingAddress,
      shippingAddressId,
      billingAddress,
      deliveryDestination,
      checkoutSessionId
    } = payloadInput;

    // Scoped to this buyer's own holds before consuming them for the new order.
    await expireStaleReservations({ buyerUserId: req.userId });

    const { expectedDeliveryDate, error: requiredDateError } =
      normalizeRequiredDateForUpstream(requiredDate);
    if (requiredDateError) {
      return res.status(400).json({ status: 'error', message: requiredDateError });
    }

    // Map UI-friendly paymentMethod (online|cod|bank_transfer|credit|card)
    // to DB payment_method + derived payment_status.
    const { payment_method: upstreamPaymentMethod, payment_status: upstreamPaymentStatus } =
      resolveUpstreamPaymentSelection(paymentMethod);

    // Preload supplier profile for defaults + GSTIN detection.
    const { data: supplierProfileRow, error: supplierProfileErr } = await supabase
      .from('users')
      .select('address, profile, user_type')
      .eq('id', req.userId)
      .single();
    if (supplierProfileErr || !supplierProfileRow) {
      return res.status(404).json({ status: 'error', message: 'Supplier profile not found' });
    }

    const profileGstin = String(supplierProfileRow?.profile?.gstin || supplierProfileRow?.profile?.mainGstin || '').trim();
    const hasGstin = Boolean(profileGstin);

    const normalizedShippingAddress = resolvePrimarySupplierShippingAddress({
      shippingAddress,
      shippingAddressId,
      profileRow: supplierProfileRow
    });
    const profileBillingAddress = normalizeAddress(supplierProfileRow?.address || {});
    const requestedBillingAddress = normalizeAddress(billingAddress || {});
    const normalizedBillingAddress = isAddressComplete(requestedBillingAddress)
      ? requestedBillingAddress
      : profileBillingAddress;

    const selectedDeliveryDestination = (() => {
      const raw = String(deliveryDestination || 'shipping').toLowerCase().trim();
      if (hasGstin && raw === 'billing') return 'billing';
      return 'shipping';
    })();

    const selectedDeliveryAddress =
      selectedDeliveryDestination === 'billing' ? normalizedBillingAddress : normalizedShippingAddress;

    if (!isAddressComplete(normalizedShippingAddress)) {
      return res.status(400).json({
        status: 'error',
        message:
          'Shipping address is incomplete. Add a complete shipping address in your supplier profile.'
      });
    }
    if (hasGstin && !isAddressComplete(normalizedBillingAddress)) {
      return res.status(400).json({
        status: 'error',
        message: 'Registered billing address is incomplete. Update it in your supplier profile.'
      });
    }

    const deliveryAddressForOrder = {
      ...mapToDeliveryAddress(selectedDeliveryAddress),
      shippingAddress: mapToDeliveryAddress(normalizedShippingAddress),
      billingAddress: mapToDeliveryAddress(normalizedBillingAddress),
      deliveryDestination: selectedDeliveryDestination,
      gstin: hasGstin ? profileGstin : null,
      gstTaxApplicableOnBillingAddressOnly: hasGstin
    };

    const mineIds = [...new Set(lines.map((l) => l?.mineSupplierProductId).filter(Boolean))];
    const upstreamOfferIds = [...new Set(lines.map((l) => l?.upstreamSupplierProductId).filter(Boolean))];

    try {
      await validateCheckoutReservationsForLines({
        buyerUserId: req.userId,
        checkoutSessionId,
        lines
      });
    } catch (reservationError) {
      return res.status(409).json({
        status: 'error',
        code: 'inventory_hold_expired',
        message: reservationError?.message || 'Inventory hold has expired. Return to your cart and proceed again.',
      });
    }

    // Validate my selected supplier products
    const { data: myRows, error: myErr } = await supabase
      .from('supplier_products')
      .select('id, product_id, variant_key, variant_asin, attributes, status, is_active, product:products(brand, status)')
      .eq('supplier_id', req.userId)
      .in('id', mineIds);
    if (myErr) throw myErr;
    const myByMineId = {};
    (myRows || [])
      .filter(
        (r) =>
          isOfferBrandVisibleForSupplierProfile(req.user?.profile || {}, r?.attributes, r?.product?.brand) &&
          isSupplierOfferEligibleForUpstreamSelection(r, r.product)
      )
      .forEach((r) => {
        myByMineId[r.id] = r;
      });

    const invalidMineIds = mineIds.filter((id) => !myByMineId[id]);
    if (invalidMineIds.length > 0) {
      return res.status(403).json({
        status: 'error',
        message:
          'One or more selected products are rejected or pending approval and cannot be used for upstream sourcing.'
      });
    }

    const { data: upstreamOffers, error: upstreamErr } = await supabase
      .from('supplier_products')
      .select(
        'id, supplier_id, product_id, variant_key, variant_asin, price, stock, min_order_quantity, attributes, outlet_id, location, status, is_active, product:products(id, name, category, unit, description, specifications, brand, status)'
      )
      .neq('status', 'rejected')
      .in('id', upstreamOfferIds);
    if (upstreamErr) throw upstreamErr;

    const upstreamOfferById = {};
    for (const row of upstreamOffers || []) {
      let effectiveRow = row;
      const { needsCatalogSync } = resolveEffectiveSupplierOfferState(row, row.product);
      if (needsCatalogSync) {
        effectiveRow = await syncSupplierOfferApprovalFromCatalog(supabase, row);
      }
      if (isSupplierOfferAvailableForUpstream(effectiveRow, effectiveRow.product)) {
        upstreamOfferById[effectiveRow.id] = effectiveRow;
      }
    }

    // Security guard: seller must match at least one immediate upstream role for any role the buyer declared.
    const parentRolesUnion = getImmediateParentRolesUnion(req.user.profile);
    const selectedBrandNames = [
      ...new Set(
        Object.values(myByMineId)
          .map((r) => resolveUpstreamBrandLabel(r?.attributes, r?.product?.brand))
          .filter(Boolean)
      )
    ];
    const adminBrandChainMap = await loadAdminBrandChainsByName({
      supabase,
      brandNames: selectedBrandNames
    });

    if (parentRolesUnion.size === 0) {
      return res.status(403).json({
        status: 'error',
        message: 'No upstream role available for your current supply-chain role (e.g. manufacturer cannot place upstream orders).'
      });
    }

    const upstreamSupplierIds = [...new Set((upstreamOffers || []).map((r) => r.supplier_id).filter(Boolean))];
    const { data: upstreamUsers } = await supabase
      .from('users')
      .select('id, profile')
      .in('id', upstreamSupplierIds);

    const upstreamProfileById = {};
    (upstreamUsers || []).forEach((u) => {
      upstreamProfileById[u.id] = u.profile;
    });

    const sameVariantMatch = (mineOffer, upstreamOffer) =>
      upstreamOffersMatchForSupplyChain(mineOffer, upstreamOffer);

    // Group lines by upstream supplier + delivery address (one order / transport per club)
    const groups = new Map(); // transportGroupId -> { supplierId, transportGroupId, items: [...] }

    for (const line of lines) {
      const mineSupplierProductId = line?.mineSupplierProductId;
      const upstreamSupplierProductId = line?.upstreamSupplierProductId;
      const rawQty = line?.quantity;
      const quantity = parseSupplierStockQuantity(rawQty);

      if (!mineSupplierProductId || !upstreamSupplierProductId) {
        return res.status(400).json({ status: 'error', message: 'mineSupplierProductId and upstreamSupplierProductId are required for each line' });
      }
      if (quantity === null || quantity <= 0) {
        return res.status(400).json({
          status: 'error',
          message: 'quantity must be a valid whole number (1 or greater) for each line'
        });
      }

      const myOffer = myByMineId[mineSupplierProductId];
      const myProductId = myOffer?.product_id;
      if (!myOffer || !myProductId) {
        return res.status(403).json({ status: 'error', message: 'One of the selected items is not owned by you' });
      }

      const upstreamOffer = upstreamOfferById[upstreamSupplierProductId];
      if (!upstreamOffer) {
        return res.status(404).json({ status: 'error', message: 'One of the selected upstream offers no longer exists' });
      }

      if (!sameVariantMatch(myOffer, upstreamOffer)) {
        return res.status(400).json({
          status: 'error',
          message:
            'Selected upstream offer does not match your product on the shared catalog (same product family required).'
        });
      }

      const minQty = Math.max(
        1,
        parseSupplierStockQuantity(upstreamOffer.min_order_quantity) ?? 1
      );
      if (quantity < minQty) {
        return res.status(400).json({
          status: 'error',
          message: `Quantity must be at least ${minQty} (minimum order for this upstream offer)`
        });
      }

      const onHandStock = parseSupplierStockQuantity(upstreamOffer.stock) ?? 0;
      if (quantity > onHandStock) {
        return res.status(400).json({
          status: 'error',
          message: `Insufficient stock for one of the selected upstream offers (requested ${quantity}, on hand ${onHandStock}).`
        });
      }

      const supplierId = upstreamOffer.supplier_id;
      const groupKey = buildTransportGroupId(supplierId, selectedDeliveryAddress);

      if (supplierId === req.userId) {
        return res.status(400).json({ status: 'error', message: 'You cannot place an upstream order to your own listing.' });
      }

      const upProfile = upstreamProfileById[supplierId];
      const brandKey = normalizeBrandKeyFromAttributes(
        resolveUpstreamBrandLabel(myOffer?.attributes, myOffer?.product?.brand)
      );
      const chainRow = adminBrandChainMap.get(brandKey) || null;
      const buyerRole = resolveBuyerRoleForBrand(
        req.user.profile || {},
        resolveUpstreamBrandLabel(myOffer?.attributes, myOffer?.product?.brand) || brandKey
      );
      const allowedRolesSet = getAllowedUpstreamRolesForBrand({
        profile: req.user.profile || {},
        brandKey,
        chainRow,
        buyerRole,
        parentRolesUnion
      });
      const { chainRouting } = buildAllowedUpstreamRolesSet({
        profile: req.user.profile || {},
        brandKey,
        chainRow,
        parentRolesUnion,
        buyerRoleHint: buyerRole
      });

      const cartBrandToken =
        resolveUpstreamBrandLabel(myOffer?.attributes, myOffer?.product?.brand) || brandKey;
      const supplierAllowed =
        sellerMatchesUpstreamForBrand(upProfile, allowedRolesSet, cartBrandToken, chainRouting) ||
        sellerHasAnyUpstreamRoleForBrand(upProfile, buyerRole, cartBrandToken, chainRow);
      if (!supplierAllowed) {
        return res.status(403).json({
          status: 'error',
          message: `Selected upstream supplier is not registered for brand "${cartBrandToken}" at any allowed supply-chain tier above you (per admin chain for that brand).`
        });
      }

      if (!groups.has(groupKey)) {
        groups.set(groupKey, { supplierId, transportGroupId: groupKey, items: [] });
      }
      groups.get(groupKey).items.push({
        mineSupplierProductId,
        upstreamSupplierProductId,
        quantity,
        unitPrice: parseFloat(upstreamOffer.price || 0) || 0,
        upstreamOffer,
        chainRouting
      });
    }

    // Minimum order value (INR) per upstream seller — sum of lines to that supplier must meet their profile MOV
    for (const group of groups.values()) {
      const upProfile = upstreamProfileById[group.supplierId];
      const requiredRoles = group.items
        .map((it) => it?.chainRouting?.requiredUpstreamRole)
        .filter((r) => r && SUPPLIER_ROLE_SET.has(r));
      const allowedRolesForMov =
        requiredRoles.length > 0 ? new Set(requiredRoles) : parentRolesUnion;
      const movBrandToken =
        resolveUpstreamBrandLabel(
          group.items[0]?.upstreamOffer?.attributes,
          group.items[0]?.upstreamOffer?.product?.brand
        ) || '';
      const movChainRouting = group.items[0]?.chainRouting || {};
      const matchedRole =
        pickUpstreamSellerRoleForBrand(
          upProfile,
          allowedRolesForMov,
          movBrandToken,
          movChainRouting
        ) || pickMatchingUpstreamRoleForSeller(upProfile, allowedRolesForMov);
      const mov = getMinimumOrderValueInrForSellerRole(upProfile || {}, matchedRole || '');
      if (mov <= 0) continue;
      let subtotal = 0;
      for (const it of group.items) {
        subtotal += (parseInt(it.quantity, 10) || 0) * (parseFloat(it.unitPrice) || 0);
      }
      subtotal = Math.round(subtotal * 100) / 100;
      if (subtotal + 1e-6 < mov) {
        return res.status(400).json({
          status: 'error',
          code: 'minimum_order_value_not_met',
          message: `Minimum order value for this supplier is ₹${mov.toLocaleString('en-IN')}. Your order total to them is ₹${subtotal.toLocaleString('en-IN')}. Increase quantity or add lines to reach the minimum.`,
          minimumOrderValueInr: mov,
          orderSubtotalInr: subtotal,
          supplierId: group.supplierId
        });
      }
    }

    const buyer = await supabase
      .from('users')
      .select('name, company')
      .eq('id', req.userId)
      .single();

    const buyerName = buyer?.data?.name || buyer?.data?.company || 'Supplier';

    const createdOrders = [];

    for (const group of groups.values()) {
      const supplierId = group.supplierId;

      const orderItems = group.items.map((it) => {
        const up = it.upstreamOffer;
        const identity = buildIdentityBundle({
          name: up.product?.name || '',
          category: up.product?.category || '',
          brand: up.product?.brand || up?.attributes?.brandModel || up?.attributes?.brand || '',
          unit: up.product?.unit || '',
          packSize: up.attributes?.packSize || '',
          brandModel: up.attributes?.brandModel || null,
          gtin: up.attributes?.gtin || null,
          mpn: up.attributes?.mpn || null
        });

        return {
          product_id: up.product_id,
          supplier_product_id: it.upstreamSupplierProductId,
          quantity: it.quantity,
          unit_price: it.unitPrice,
          total_price: it.unitPrice * it.quantity,
          specifications: JSON.stringify({
            snapshotAt: new Date().toISOString(),
            brandModel: up?.attributes?.brandModel || null,
            identity
          })
        };
      });

      const totalAmount = orderItems.reduce((sum, li) => sum + parseFloat(li.total_price || 0), 0);
      let order = null;
      let orderErr = null;

      // If buyer chose "credit", validate seller credit-account eligibility for this buyer.
      if (upstreamPaymentMethod === 'credit') {
        const creditCheck = await validateCreditForOrder({
          supplierId,
          buyerUserId: req.userId,
          orderAmount: totalAmount
        });

        if (!creditCheck.payLaterOffered || !creditCheck.allowed) {
          return res.status(400).json({
            status: 'error',
            message: `Pay later not available: ${creditCheck.message} Use online, COD, bank transfer, or card instead.`,
            credit: creditCheck
          });
        }
      }

      for (let attempt = 0; attempt <= ORDER_INSERT_MAX_RETRIES; attempt++) {
        const orderInsertResult = await supabase
          .from('orders')
          .insert({
            service_provider_id: req.userId, // buyer = current supplier
            supplier_id: supplierId, // seller = upstream supplier
            total_amount: totalAmount,
            expected_delivery_date: expectedDeliveryDate,
            delivery_address: deliveryAddressForOrder,
            status: 'confirmed',
            payment_status: upstreamPaymentStatus,
            payment_method: upstreamPaymentMethod,
            channel: 'b2b_po',
            outlet_id: null,
            status_history: [{
              status: 'confirmed',
              updatedBy: req.userId,
              notes: 'Upstream order created and confirmed by supplier',
              timestamp: new Date().toISOString()
            }],
            is_active: true
          })
          .select()
          .single();
        order = orderInsertResult.data || null;
        orderErr = orderInsertResult.error || null;
        if (!orderErr && order) {
          break;
        }
        if (!isOrderNumberConflictError(orderErr) || attempt === ORDER_INSERT_MAX_RETRIES) {
          break;
        }
      }

      if (orderErr || !order) {
        console.error('[Upstream Orders] order insert error:', orderErr);
        throw new Error(orderErr?.message || 'Failed to create upstream order');
      }

      const orderItemsWithOrderId = orderItems.map((oi) => ({ ...oi, order_id: order.id }));
      const { data: insertedItems, error: itemsErr } = await supabase
        .from('order_items')
        .insert(orderItemsWithOrderId)
        .select();

      if (itemsErr) {
        console.error('[Upstream Orders] order_items insert error:', itemsErr);
        await supabase.from('orders').delete().eq('id', order.id);
        throw new Error('Failed to create upstream order items');
      }

      // Inventory: consume the checkout hold (deducts upstream seller stock once).
      try {
        const orderItemBySupplierProductId = {};
        for (const inserted of insertedItems || []) {
          if (!inserted?.supplier_product_id) continue;
          orderItemBySupplierProductId[inserted.supplier_product_id] = {
            orderId: order.id,
            orderItemId: inserted.id
          };
        }

        const groupLines = group.items.map((it) => ({
          upstreamSupplierProductId: it.upstreamSupplierProductId,
          supplierId: group.supplierId,
          quantity: it.quantity
        }));
        await consumeCheckoutReservationsForOrder({
          buyerUserId: req.userId,
          checkoutSessionId,
          lines: groupLines,
          orderItemBySupplierProductId
        });
      } catch (invErr) {
        console.error('[Upstream Orders] reservation consume error:', invErr);
        await supabase.from('order_items').delete().eq('order_id', order.id);
        await supabase.from('orders').delete().eq('id', order.id);
        throw new Error(invErr?.message || 'Failed to finalize inventory for upstream order');
      }

      // Notify upstream supplier
      try {
        const { data: supplierUser } = await supabase
          .from('users')
          .select('name, company')
          .eq('id', supplierId)
          .single();

        const supplierName = supplierUser?.name || supplierUser?.company || 'Supplier';

        await insertNotification({
          user_id: supplierId,
          type: 'order_status',
          title: 'New Upstream Order Received',
          message: `You have received an upstream order ${order.order_number} from ${buyerName}.`,
          related_order_id: order.id,
          is_read: false,
          metadata: {
            buyerId: req.userId
          }
        }, supabase);
      } catch (notifErr) {
        console.error('[Upstream Orders] notification error:', notifErr);
      }

      createdOrders.push({
        id: order.id,
        orderNumber: order.order_number,
        supplierId: order.supplier_id,
        transportGroupId: group.transportGroupId || buildTransportGroupId(supplierId, selectedDeliveryAddress),
        totalAmount,
        status: order.status,
        paymentStatus: order.payment_status,
        paymentMethod: order.payment_method,
        expectedDeliveryDate: order.expected_delivery_date
      });
    }

    return res.json({
      status: 'success',
      orders: createdOrders,
      message: `Successfully created ${createdOrders.length} upstream order(s)`
    });
  } catch (error) {
    console.error('Upstream order creation error:', error);
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    return res.status(500).json({ status: 'error', message: 'Failed to create upstream orders', error: error.message });
  }
});

router.post('/upstream/cart/items', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can add items to upstream cart' });
    }

    const mineSupplierProductId = String(req.body?.mineSupplierProductId || '').trim();
    const requestedQuantity = parseSupplierStockQuantity(req.body?.quantity);
    const targetProjectId = String(req.body?.projectId || '').trim();
    const requestedCartName = String(req.body?.cartName || '').trim();
    const rawRequiredDate = String(req.body?.requiredDate || '').trim();
    const requiredDate = /^\d{4}-\d{2}-\d{2}$/.test(rawRequiredDate) ? rawRequiredDate : '';
    if (!mineSupplierProductId) {
      return res.status(400).json({ status: 'error', message: 'mineSupplierProductId is required' });
    }
    if (requestedQuantity === null || requestedQuantity < 1) {
      return res.status(400).json({
        status: 'error',
        message: 'quantity must be a valid whole number (1 or greater)'
      });
    }
    if (!targetProjectId && !requestedCartName) {
      return res.status(400).json({
        status: 'error',
        message: 'cartName is required when creating a new project'
      });
    }
    if (!targetProjectId && !requiredDate) {
      return res.status(400).json({
        status: 'error',
        message: 'requiredDate is required when creating a new project'
      });
    }
    if (rawRequiredDate && !requiredDate) {
      return res.status(400).json({
        status: 'error',
        message: 'requiredDate must be in YYYY-MM-DD format'
      });
    }

    const hasShippingFields =
      Object.prototype.hasOwnProperty.call(req.body || {}, 'shippingAddressId') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'shippingAddress');
    const shippingMeta = hasShippingFields
      ? await resolveUpstreamProjectShipping(req.userId, req.body || {})
      : null;
    if (shippingMeta?.error) {
      return res.status(400).json({ status: 'error', message: shippingMeta.error });
    }
    const enrichedShipping = shippingMeta ? await enrichUpstreamShippingMeta(shippingMeta) : null;

    const { data: mineRow, error: mineError } = await supabase
      .from('supplier_products')
      .select('id, supplier_id, min_order_quantity, attributes, status, is_active, product:products(brand, status)')
      .eq('id', mineSupplierProductId)
      .eq('supplier_id', req.userId)
      .maybeSingle();
    if (mineError) throw mineError;
    if (!mineRow) {
      return res.status(404).json({ status: 'error', message: 'Selected product was not found in your inventory' });
    }
    if (!isSupplierOfferEligibleForUpstreamSelection(mineRow, mineRow.product)) {
      return res.status(403).json({
        status: 'error',
        message:
          'This product is not approved for upstream sourcing. Rejected or pending products cannot be sourced from upstream partners.'
      });
    }
    if (!isOfferBrandVisibleForSupplierProfile(req.user?.profile || {}, mineRow?.attributes, mineRow?.product?.brand)) {
      return res.status(403).json({
        status: 'error',
        message: 'Selected product brand is not approved in your current supplier profile.'
      });
    }

    const minQty = Math.max(
      1,
      parseSupplierStockQuantity(mineRow.min_order_quantity) ?? 1
    );
    const quantity = Math.max(minQty, requestedQuantity);
    const quantityAdjusted = quantity !== requestedQuantity;

    const { data: cartRow, error: cartError } = await supabase
      .from('po_carts')
      .select('id, draft_payload, updated_at')
      .eq('service_provider_id', req.userId)
      .maybeSingle();
    if (cartError) throw cartError;

    const currentDraft = normalizeUpstreamCartDraft(
      cartRow?.draft_payload && typeof cartRow.draft_payload === 'object'
        ? cartRow.draft_payload
        : {}
    );
    const currentProjects = Array.isArray(currentDraft.projects) ? [...currentDraft.projects] : [];
    let updatedProject = null;
    let nextProjects = currentProjects;
    if (targetProjectId) {
      const idx = currentProjects.findIndex((project) => String(project?.projectId || '') === targetProjectId);
      if (idx < 0) {
        return res.status(404).json({ status: 'error', message: 'Selected project not found' });
      }
      const existing = buildUpstreamProject(currentProjects[idx]);
      // Same product added again to the SAME project: increase the existing quantity instead of
      // overwriting it. A different project always gets its own entry (the `else` branch below
      // creates a brand-new project), so this only merges quantities within one project.
      const mergedQuantity = mergeUpstreamSelectedMineQuantity(
        existing.selectedMine,
        mineSupplierProductId,
        quantity
      );
      updatedProject = applyShippingToUpstreamProject(
        {
          ...existing,
          selectedMine: {
            ...(existing.selectedMine || {}),
            [mineSupplierProductId]: mergedQuantity
          }
        },
        enrichedShipping
      );
      nextProjects[idx] = updatedProject;
    } else {
      if (hasDuplicateUpstreamProject(currentProjects, requestedCartName, requiredDate)) {
        return res.status(400).json({
          status: 'error',
          message: 'A supplier project with the same name and expected dispatch date already exists'
        });
      }
      updatedProject = applyShippingToUpstreamProject(
        buildUpstreamProject({
          cartName: requestedCartName || `Quick Add - ${mineSupplierProductId.slice(0, 8)}`,
          requiredDate,
          selectedMine: { [mineSupplierProductId]: quantity },
          selectedUpstreamOffer: {},
          suggestions: [],
          brandFilter: '',
          searchTerm: ''
        }),
        enrichedShipping
      );
      // New add must appear first in cart.
      nextProjects = [updatedProject, ...currentProjects];
    }
    const nextDraftPayload = normalizeUpstreamCartDraft({
      ...currentDraft,
      projects: nextProjects
    });

    const { data: saved, error: saveError } = await supabase
      .from('po_carts')
      .upsert(
        {
          service_provider_id: req.userId,
          draft_payload: nextDraftPayload
        },
        { onConflict: 'service_provider_id' }
      )
      .select('id, updated_at')
      .single();
    if (saveError) throw saveError;

    return res.json({
      status: 'success',
      message: quantityAdjusted
        ? `Item added. Quantity adjusted to minimum order quantity (${quantity}).`
        : 'Item added to upstream cart',
      item: {
        mineSupplierProductId,
        quantity,
        requestedQuantity,
        quantityAdjusted
      },
      project: {
        projectId: updatedProject.projectId,
        cartName: updatedProject.cartName,
        requiredDate: updatedProject.requiredDate || null
      },
      cart: {
        id: saved.id,
        updatedAt: saved.updated_at
      }
    });
  } catch (error) {
    console.error('Add upstream cart item error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to add item to upstream cart' });
  }
});

router.get('/upstream/cart', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can access upstream cart' });
    }

    const { data: cart, error } = await supabase
      .from('po_carts')
      .select('id, draft_payload, updated_at, created_at')
      .eq('service_provider_id', req.userId)
      .maybeSingle();
    if (error) throw error;

    if (!cart) {
      return res.json({ status: 'success', cart: null });
    }

    const rawDraft = cart.draft_payload && typeof cart.draft_payload === 'object' ? cart.draft_payload : {};
    const draft = normalizeUpstreamCartDraft(rawDraft);
    if (upstreamCartDraftNeedsPersistAfterPrune(rawDraft, draft)) {
      await supabase
        .from('po_carts')
        .update({ draft_payload: draft })
        .eq('id', cart.id)
        .eq('service_provider_id', req.userId);
    }

    return res.json({
      status: 'success',
      cart: {
        id: cart.id,
        draft,
        updatedAt: cart.updated_at,
        createdAt: cart.created_at
      }
    });
  } catch (error) {
    console.error('Get upstream cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load upstream cart' });
  }
});

router.patch('/upstream/cart/name', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can update upstream cart name' });
    }
    const cartName = String(req.body?.cartName || '').trim();
    const targetProjectId = String(req.body?.projectId || '').trim();
    const rawRequiredDate = String(req.body?.requiredDate || '').trim();
    const requiredDate = /^\d{4}-\d{2}-\d{2}$/.test(rawRequiredDate) ? rawRequiredDate : '';
    if (!cartName) {
      return res.status(400).json({ status: 'error', message: 'Project name is required' });
    }
    if (cartName.length > 120) {
      return res.status(400).json({ status: 'error', message: 'Project name must be 120 characters or fewer' });
    }
    if (rawRequiredDate && !requiredDate) {
      return res.status(400).json({ status: 'error', message: 'requiredDate must be in YYYY-MM-DD format' });
    }

    const hasShippingAddressIdField = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'shippingAddressId'
    );
    const hasShippingAddressField = Object.prototype.hasOwnProperty.call(
      req.body || {},
      'shippingAddress'
    );
    const wantsShippingUpdate = hasShippingAddressIdField || hasShippingAddressField;
    let enrichedShipping = null;
    if (wantsShippingUpdate) {
      const shippingIdRaw = hasShippingAddressIdField
        ? String(req.body?.shippingAddressId || '').trim()
        : '';
      const hasInlineShipping =
        hasShippingAddressField &&
        req.body?.shippingAddress &&
        typeof req.body.shippingAddress === 'object';
      if (!shippingIdRaw && !hasInlineShipping) {
        enrichedShipping = { clear: true };
      } else {
        const shippingMeta = await resolveUpstreamProjectShipping(req.userId, req.body || {});
        if (shippingMeta?.error) {
          return res.status(400).json({ status: 'error', message: shippingMeta.error });
        }
        if (shippingMeta) {
          enrichedShipping = await enrichUpstreamShippingMeta(shippingMeta);
        }
      }
    }

    const { data: cartRow, error: cartError } = await supabase
      .from('po_carts')
      .select('id, draft_payload, updated_at')
      .eq('service_provider_id', req.userId)
      .maybeSingle();
    if (cartError) throw cartError;

    const currentDraft = normalizeUpstreamCartDraft(
      cartRow?.draft_payload && typeof cartRow.draft_payload === 'object'
        ? cartRow.draft_payload
        : {}
    );
    const projects = Array.isArray(currentDraft.projects) ? [...currentDraft.projects] : [];
    const targetIdx = targetProjectId
      ? projects.findIndex((p) => String(p?.projectId || '') === targetProjectId)
      : 0;
    const safeTargetIdx = targetIdx >= 0 ? targetIdx : 0;
    const effectiveRequiredDate = rawRequiredDate
      ? requiredDate
      : String(projects[safeTargetIdx]?.requiredDate || '').trim();
    const effectiveProjectId = String(projects[safeTargetIdx]?.projectId || '').trim();
    if (
      hasDuplicateUpstreamProject(
        projects,
        cartName,
        effectiveRequiredDate,
        targetProjectId || effectiveProjectId
      )
    ) {
      return res.status(400).json({
        status: 'error',
        message: 'A supplier project with the same name and expected dispatch date already exists'
      });
    }
    if (projects.length === 0) {
      projects.push(
        applyShippingToUpstreamProject(
          buildUpstreamProject({
            projectId: targetProjectId || null,
            cartName
          }),
          wantsShippingUpdate ? enrichedShipping : null
        )
      );
    } else {
      const idx = targetProjectId
        ? projects.findIndex((p) => String(p?.projectId || '') === targetProjectId)
        : 0;
      const safeIdx = idx >= 0 ? idx : 0;
      projects[safeIdx] = applyShippingToUpstreamProject(
        buildUpstreamProject({
          ...projects[safeIdx],
          cartName,
          requiredDate
        }),
        wantsShippingUpdate ? enrichedShipping : null
      );
    }
    const nextDraftPayload = normalizeUpstreamCartDraft({
      ...currentDraft,
      projects
    });

    const { data: saved, error: saveError } = await supabase
      .from('po_carts')
      .upsert(
        {
          service_provider_id: req.userId,
          draft_payload: nextDraftPayload
        },
        { onConflict: 'service_provider_id' }
      )
      .select('id, updated_at')
      .single();
    if (saveError) throw saveError;

    const savedProject =
      projects.find((p) => String(p?.projectId || '') === (targetProjectId || effectiveProjectId)) ||
      projects[safeTargetIdx] ||
      null;

    return res.json({
      status: 'success',
      message: 'Upstream project details updated',
      cart: {
        id: saved.id,
        updatedAt: saved.updated_at,
        projectId: targetProjectId || null,
        cartName,
        requiredDate: requiredDate || null
      },
      project: savedProject
        ? {
            projectId: savedProject.projectId,
            cartName: savedProject.cartName,
            requiredDate: savedProject.requiredDate || null,
            shippingAddressId: enrichedShipping?.clear
              ? null
              : savedProject.shippingAddressId || null,
            shippingAddress: enrichedShipping?.clear ? null : savedProject.shippingAddress || null,
            location: enrichedShipping?.clear ? null : savedProject.location || null,
            siteGeo: enrichedShipping?.clear ? null : savedProject.siteGeo || null
          }
        : null
    });
  } catch (error) {
    console.error('Update upstream cart name error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to update upstream project name' });
  }
});

router.put('/upstream/cart', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can save upstream cart' });
    }

    const payloadInput = parseWithSchema(supplierUpstreamCartSaveSchema, req.body || {});
    const hasShippingFields =
      Object.prototype.hasOwnProperty.call(req.body || {}, 'shippingAddressId') ||
      Object.prototype.hasOwnProperty.call(req.body || {}, 'shippingAddress');
    const shippingMeta = hasShippingFields
      ? await resolveUpstreamProjectShipping(req.userId, payloadInput)
      : null;
    if (shippingMeta?.error) {
      return res.status(400).json({ status: 'error', message: shippingMeta.error });
    }
    const enrichedShipping = shippingMeta ? await enrichUpstreamShippingMeta(shippingMeta) : null;

    const { data: currentCart, error: currentCartError } = await supabase
      .from('po_carts')
      .select('id, draft_payload')
      .eq('service_provider_id', req.userId)
      .maybeSingle();
    if (currentCartError) throw currentCartError;
    const currentDraft = normalizeUpstreamCartDraft(
      currentCart?.draft_payload && typeof currentCart.draft_payload === 'object'
        ? currentCart.draft_payload
        : {}
    );

    let nextProjects = Array.isArray(currentDraft.projects) ? [...currentDraft.projects] : [];
    const existingProject = payloadInput.projectId
      ? nextProjects.find((p) => String(p?.projectId || '') === String(payloadInput.projectId))
      : null;
    let nextProject = buildUpstreamProject({
      ...(existingProject || {}),
      projectId: payloadInput.projectId || null,
      cartName: String(payloadInput.cartName || '').trim() || existingProject?.cartName,
      requiredDate: String(payloadInput.requiredDate || '').trim() || existingProject?.requiredDate,
      selectedMine: payloadInput.selectedMine || existingProject?.selectedMine || {},
      selectedUpstreamOffer: payloadInput.selectedUpstreamOffer || existingProject?.selectedUpstreamOffer || {},
      suggestions: Array.isArray(payloadInput.suggestions)
        ? payloadInput.suggestions
        : existingProject?.suggestions || [],
      brandFilter: String(payloadInput.brandFilter || '').trim() || existingProject?.brandFilter || '',
      searchTerm: String(payloadInput.searchTerm || '').trim() || existingProject?.searchTerm || '',
      createdAt: existingProject?.createdAt
    });
    if (enrichedShipping) {
      nextProject = applyShippingToUpstreamProject(nextProject, enrichedShipping);
    }
    if (payloadInput.projectId) {
      if (
        hasDuplicateUpstreamProject(
          nextProjects,
          nextProject.cartName,
          nextProject.requiredDate,
          String(payloadInput.projectId || '')
        )
      ) {
        return res.status(400).json({
          status: 'error',
          message: 'A supplier project with the same name and expected dispatch date already exists'
        });
      }
      const idx = nextProjects.findIndex((p) => String(p?.projectId || '') === String(payloadInput.projectId));
      if (!hasUpstreamProjectLines(nextProject)) {
        if (idx >= 0) nextProjects.splice(idx, 1);
      } else if (idx >= 0) {
        nextProjects[idx] = nextProject;
      } else {
        nextProjects = [nextProject, ...nextProjects];
      }
    } else {
      // No projectId means user intentionally saved a fresh project from upstream flow.
      if (!hasUpstreamProjectLines(nextProject)) {
        return res.status(400).json({
          status: 'error',
          message: 'Add at least one product with quantity before saving a supplier project'
        });
      }
      if (hasDuplicateUpstreamProject(nextProjects, nextProject.cartName, nextProject.requiredDate)) {
        return res.status(400).json({
          status: 'error',
          message: 'A supplier project with the same name and expected dispatch date already exists'
        });
      }
      nextProjects = [nextProject, ...nextProjects];
    }
    const draftPayload = normalizeUpstreamCartDraft({
      ...currentDraft,
      projects: nextProjects
    });

    const { data: saved, error } = await supabase
      .from('po_carts')
      .upsert(
        {
          service_provider_id: req.userId,
          draft_payload: draftPayload
        },
        { onConflict: 'service_provider_id' }
      )
      .select('id, updated_at')
      .single();
    if (error) throw error;

    return res.json({
      status: 'success',
      message: 'Upstream cart saved successfully',
      cart: {
        id: saved.id,
        updatedAt: saved.updated_at
      }
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Save upstream cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to save upstream cart' });
  }
});

router.delete('/upstream/cart', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can clear upstream cart' });
    }
    const { error } = await supabase
      .from('po_carts')
      .delete()
      .eq('service_provider_id', req.userId);
    if (error) throw error;
    return res.json({ status: 'success', message: 'Upstream cart cleared successfully' });
  } catch (error) {
    console.error('Clear upstream cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to clear upstream cart' });
  }
});

/**
 * List upstream orders created by this supplier (as buyer).
 */
router.get('/upstream/orders', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can view upstream orders' });
    }

    const wantsAll =
      String(req.query.all || '')
        .trim()
        .toLowerCase() === 'true';
    const requestedLimit = Number.parseInt(String(req.query.limit || ''), 10);
    const limit = wantsAll
      ? null
      : Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, 500)
        : 50;

    const statusFilter = String(req.query.status || '')
      .trim()
      .toLowerCase();
    const paymentStatusFilter = String(req.query.paymentStatus || req.query.payment_status || '')
      .trim()
      .toLowerCase();

    let query = supabase
      .from('orders')
      .select(`
        id,
        order_number,
        supplier_id,
        total_amount,
        status,
        payment_status,
        payment_method,
        channel,
        created_at,
        updated_at,
        expected_delivery_date,
        actual_delivery_date,
        status_history,
        tracking_number,
        tracking_url,
        shipping_provider,
        order_items (id),
        supplier:users!orders_supplier_id_fkey (id, name, company)
      `)
      .eq('service_provider_id', req.userId)
      .eq('channel', 'b2b_po')
      .order('created_at', { ascending: false });

    if (statusFilter && statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }
    if (paymentStatusFilter && paymentStatusFilter !== 'all') {
      query = query.eq('payment_status', paymentStatusFilter);
    }

    if (limit != null) {
      query = query.limit(limit);
    }

    const { data: orders, error } = await query;

    if (error) throw error;

    const searchQuery = String(req.query.q || req.query.search || '')
      .trim()
      .toLowerCase();
    const filteredOrders = searchQuery
      ? (orders || []).filter((o) => {
          const supplierName = String(o.supplier?.name || o.supplier?.company || '').toLowerCase();
          const haystack = [
            o.order_number,
            supplierName,
            o.status,
            o.payment_status,
            o.payment_method
          ]
            .map((v) => String(v || '').toLowerCase())
            .join(' ');
          return haystack.includes(searchQuery);
        })
      : orders || [];

    return res.json({
      status: 'success',
      orders: filteredOrders.map((o) => ({
        id: o.id,
        orderNumber: o.order_number,
        supplierId: o.supplier_id,
        supplierName: o.supplier?.name || o.supplier?.company || 'Supplier',
        totalAmount: parseFloat(o.total_amount || 0),
        status: o.status,
        paymentStatus: o.payment_status || 'pending',
        paymentMethod: o.payment_method || null,
        channel: o.channel || null,
        createdAt: o.created_at,
        updatedAt: o.updated_at || o.created_at,
        expectedDeliveryDate: o.expected_delivery_date || null,
        actualDeliveryDate: o.actual_delivery_date || null,
        statusHistory: Array.isArray(o.status_history) ? o.status_history : [],
        trackingNumber: o.tracking_number || null,
        trackingUrl: o.tracking_url || null,
        shippingProvider: o.shipping_provider || null,
        itemCount: Array.isArray(o.order_items) ? o.order_items.length : 0
      }))
    });
  } catch (e) {
    console.error('Upstream orders list error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to load upstream orders' });
  }
});

// Inventory movement history and channel breakdown for a specific supplier_product
}
