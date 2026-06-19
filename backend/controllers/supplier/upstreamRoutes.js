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
  pickMatchingUpstreamRoleForSeller,
  pickUpstreamSellerRoleForBrand,
  rankUpstreamOffersForProduct,
  sortRolesByChainDepthDesc,
  getMySupplierRoles,
  recordInventoryMovement,
  resolveGeoFromOutletAddress,
  buildAllowedUpstreamRolesSet,
  resolveRequiredUpstreamRoleFromAdminChain,
  sellerMatchesUpstreamForBrand,
  supplierUpstreamCartSaveSchema,
  supplierUpstreamOrdersSchema
} from './supplierImports.js';
import {
  ORDER_INSERT_MAX_RETRIES,
  isOrderNumberConflictError
} from './shared/productHelpers.js';
import { validateCreditForOrder } from '../../services/creditAccountService.js';
import {
  isAddressComplete,
  mapToDeliveryAddress,
  normalizeAddress
} from '../po/shared/poHelpers.js';
import {
  normalizeRequiredDateForUpstream,
  resolvePrimarySupplierShippingAddress,
  resolveUpstreamPaymentSelection
} from '../../services/upstreamOrderInputService.js';
import { parseSupplierStockQuantity } from '../../utils/parseSupplierStockQuantity.js';
import { formatPlatformDate } from '../../utils/dateTime.js';

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

  const isOfferBrandVisibleForSupplierProfile = (profile, attributes, productBrand) => {
    const brandCandidate = resolveUpstreamBrandLabel(attributes, productBrand);
    return supplierCanAccessBrandStrict(profile || {}, brandCandidate).allowed;
  };

  const buildUpstreamProject = (payload = {}) => {
    const projectId = String(payload.projectId || `sup-proj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);
    const cartNameRaw = String(payload.cartName || '').trim();
    const rawRequiredDate = String(payload.requiredDate || '').trim();
    const requiredDate = /^\d{4}-\d{2}-\d{2}$/.test(rawRequiredDate) ? rawRequiredDate : '';
    return {
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
    if (Array.isArray(raw.projects) && raw.projects.length > 0) {
      projects = raw.projects.map((p) => buildUpstreamProject(p));
    } else {
      const legacyHasData =
        (raw.selectedMine && Object.keys(raw.selectedMine || {}).length > 0) ||
        (raw.selectedUpstreamOffer && Object.keys(raw.selectedUpstreamOffer || {}).length > 0) ||
        (Array.isArray(raw.suggestions) && raw.suggestions.length > 0);
      if (legacyHasData) {
        projects = [
          buildUpstreamProject({
            projectId: raw.projectId || null,
            cartName: raw.cartName || 'Supplier Cart',
            selectedMine: raw.selectedMine || {},
            selectedUpstreamOffer: raw.selectedUpstreamOffer || {},
            suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : [],
            brandFilter: String(raw.brandFilter || '').trim(),
            searchTerm: String(raw.searchTerm || '').trim(),
            createdAt: raw.createdAt || new Date().toISOString()
          })
        ];
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
        'id, product_id, variant_key, variant_asin, stock, min_order_quantity, outlet_id, location, attributes, is_active, status, product:products(brand)'
      )
      .eq('supplier_id', req.userId)
      .in('id', supplierProductIds)
      .eq('is_active', true)
      .neq('status', 'rejected');

    if (myErr) throw myErr;

    const myOffers = (myRows || []).filter((r) =>
      isOfferBrandVisibleForSupplierProfile(req.user?.profile || {}, r?.attributes, r?.product?.brand)
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

    // Fetch upstream offers for the same variant only.
    // Priority:
    // 1) Same variant_key
    // 2) Same variant_asin
    // 3) Fallback for legacy rows (no variant identity): same product_id
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

    // Load upstream offers directly (source of truth) and then load supplier profiles for display.
    const upstreamOffersById = new Map();
    const registerUpstreamRows = (rows = []) => {
      for (const row of rows || []) {
        if (row?.id) upstreamOffersById.set(row.id, row);
      }
    };
    if (productIds.length > 0) {
      const { data: rowsByProductId } = await supabase
        .from('supplier_products')
        .select('id, product_id, variant_key, variant_asin, supplier_id, stock, price, outlet_id, location, status, is_active, attributes, min_order_quantity')
        .in('product_id', productIds)
        .eq('is_active', true)
        .neq('status', 'rejected')
        .gt('stock', 0);
      registerUpstreamRows(rowsByProductId || []);
    }
    if (myVariantKeys.length > 0) {
      const { data: rowsByVariantKey } = await supabase
        .from('supplier_products')
        .select('id, product_id, variant_key, variant_asin, supplier_id, stock, price, outlet_id, location, status, is_active, attributes, min_order_quantity')
        .in('variant_key', myVariantKeys)
        .eq('is_active', true)
        .neq('status', 'rejected')
        .gt('stock', 0);
      registerUpstreamRows(rowsByVariantKey || []);
    }
    if (myVariantAsins.length > 0) {
      const { data: rowsByVariantAsin } = await supabase
        .from('supplier_products')
        .select('id, product_id, variant_key, variant_asin, supplier_id, stock, price, outlet_id, location, status, is_active, attributes, min_order_quantity')
        .in('variant_asin', myVariantAsins)
        .eq('is_active', true)
        .neq('status', 'rejected')
        .gt('stock', 0);
      registerUpstreamRows(rowsByVariantAsin || []);
    }
    const upstreamOffers = [...upstreamOffersById.values()];

    const upstreamSupplierIds = [
      ...new Set((upstreamOffers || []).map((o) => o.supplier_id).filter(Boolean))
    ].filter((id) => id !== req.userId);

    if (upstreamSupplierIds.length === 0) {
      const label = parentRolesSorted.map((r) => SUPPLY_CHAIN_ROLE_LABELS[r] || r).join(', ');
      return res.json({
        status: 'success',
        parentRole,
        parentRoles: parentRolesSorted,
        items: myOffers.map((r) => ({
          mineSupplierProductId: r.id,
          productId: r.product_id,
          brandModel: r?.attributes?.brandModel || null,
          upstreamOffers: [],
          message: `No upstream offers found (${label}) for your selected product(s).`
        }))
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

    // All of your outlet coordinates — distance to each upstream offer is the minimum km from ANY of these
    // (so a new dealer opening near any of your locations surfaces as #1 on the next fetch; not fixed to one outlet).
    const buyerOutletGeos = [];
    const buyerGeoDiagnostics = {
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
    const { data: buyerOutletsGeoRows } = await supabase
      .from('outlets')
      .select('id, geo_location, address')
      .eq('supplier_id', req.userId)
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
    // Retailers may not have outlet rows; fall back to profile/address geocode.
    if (buyerOutletGeos.length === 0) {
      const { data: buyerUser } = await supabase
        .from('users')
        .select('address, profile')
        .eq('id', req.userId)
        .maybeSingle();
      buyerGeoDiagnostics.profileAddressTried = true;
      const buyerGeoFallback = await resolveGeoFromOutletAddress(null, buyerUser?.address || null);
      if (isValidGeoLocation(buyerGeoFallback)) {
        buyerOutletGeos.push({ lat: buyerGeoFallback.lat, lng: buyerGeoFallback.lng });
        buyerGeoSource = 'profile_address';
        buyerGeoDiagnostics.profileAddressResolved = true;
      }
      // Backward compatibility: many suppliers still store branch locations in profile.branches.
      if (buyerOutletGeos.length === 0) {
        const legacyBranches = Array.isArray(buyerUser?.profile?.branches) ? buyerUser.profile.branches : [];
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
    // Additional fallback: use selected inventory location text if retailer has no outlet/address geo.
    if (buyerOutletGeos.length === 0) {
      const buyerLocationTexts = [...new Set((myOffers || []).map((r) => String(r?.location || '').trim()).filter(Boolean))];
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
      const brandLabel = resolveUpstreamBrandLabel(mine?.attributes, mine?.product?.brand);
      const desiredBrand = String(brandLabel || '').trim().toLowerCase();
      const brandKey = normalizeBrandKeyFromAttributes(brandLabel);
      const chainRow = adminBrandChainMap.get(brandKey) || null;
      const buyerRole =
        sortRolesByChainDepthDesc(getMySupplierRoles(req.user.profile || {}, ''))[0] || null;
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
        parentRolesUnion
      });

      const sameVariantOnlyPool = (upstreamOffers || []).filter((offer) => {
        if (!offer) return false;
        const offerVariantKey = String(offer?.variant_key || '').trim();
        const offerVariantAsin = String(offer?.variant_asin || '').trim();
        if (mineVariantKey) return Boolean(offerVariantKey) && offerVariantKey === mineVariantKey;
        if (mineVariantAsin) return Boolean(offerVariantAsin) && offerVariantAsin === mineVariantAsin;
        // Legacy fallback when variant identity is missing.
        return Boolean(offer?.product_id) && offer.product_id === mine.product_id;
      });

      const brandMatchedPool = sameVariantOnlyPool.filter((u) => {
        if (!desiredBrand) return true;
        const offerBrand = resolveUpstreamBrandLabel(u?.attributes, null).toLowerCase();
        return offerBrand
          ? offerBrand === desiredBrand || offerBrand.includes(desiredBrand) || desiredBrand.includes(offerBrand)
          : true;
      });

      const brandTokenForMatch = brandLabel || desiredBrand || '';
      const candidates = brandMatchedPool
        .filter((offer) => {
          if (!offer.supplier_id || offer.supplier_id === req.userId) return false;
          const sup = upstreamUserMap[offer.supplier_id];
          if (!sup?.profile) return false;
          return sellerMatchesUpstreamForBrand(
            sup.profile,
            allowedRolesSet,
            brandTokenForMatch,
            chainRouting
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
              )
            : null;
          const roleForMap = matchedRole || parentRole;
          const { averageRating, ratingCount } = getSupplierRatingSummary(u.supplier_id);
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
            stock: parseSupplierStockQuantity(u.stock) ?? 0,
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
        if (sameVariantOnlyPool.length === 0) {
          itemMessage = 'No other suppliers list this exact variant with stock right now.';
        } else if (brandMatchedPool.length === 0) {
          itemMessage = `No upstream listings matched brand "${brandLabel || desiredBrand}".`;
        } else if (candidates.length === 0 && allowedRolesSet.size > 0) {
          const tierLabels = [...allowedRolesSet]
            .sort((a, b) => (ROLE_DEPTH[a] ?? 99) - (ROLE_DEPTH[b] ?? 99))
            .map((r) => SUPPLY_CHAIN_ROLE_LABELS[r] || r)
            .join(', ');
          itemMessage = `Partners exist for this product, but none are registered upstream for brand "${brandLabel || desiredBrand}" at: ${tierLabels}. They need one of those roles and the same brand on Who are you.`;
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
        upstreamRole: chainRouting.requiredUpstreamRole || parentRole,
        upstreamRoles: parentRolesSorted,
        chainRouting: {
          source: chainRouting.source,
          brand: chainRow?.category_name || brandLabel || null,
          buyerRole: chainRouting.buyerRole,
          requiredUpstreamRole: chainRouting.requiredUpstreamRole,
          chainRoles: chainRouting.chainRoles || normalizeChainRolesFromStages(chainRow?.stages)
        },
        upstreamOffers: top,
        message: itemMessage
      };
    });

    return res.json({
      status: 'success',
      parentRole,
      parentRoles: parentRolesSorted,
      rankPriority: UPSTREAM_RANK_PRIORITY,
      limit: limitPerItem,
      distanceAvailable: buyerOutletGeos.length > 0,
      buyerGeoSource,
      buyerGeoDiagnostics,
      chainPolicy:
        'Uses Admin → Supply Chain per brand. Upstream seller = tier directly above you in that chain (walkback skips absent tiers e.g. dealer).',
      distanceRanking:
        buyerOutletGeos.length > 0
          ? 'Each run uses current outlet coordinates. Distance is the minimum km from any of your outlets to the partner’s outlet; the nearest partner ranks first (not a fixed previous choice).'
          : 'Distance ranking is unavailable because your location could not be resolved. Add/update outlet geo or a complete address in profile (city/state/pincode).',
      items
    });
  } catch (e) {
    console.error('Upstream suggestions error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to load upstream suggestions' });
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
    const { lines, requiredDate, paymentMethod, shippingAddress, billingAddress, deliveryDestination } = payloadInput;

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
          'Shipping address is incomplete. Add a complete branch location (shipping address) in your supplier profile.'
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

    // Validate my selected supplier products
    const { data: myRows, error: myErr } = await supabase
      .from('supplier_products')
      .select('id, product_id, variant_key, variant_asin, attributes')
      .eq('supplier_id', req.userId)
      .in('id', mineIds);
    if (myErr) throw myErr;
    const myByMineId = {};
    (myRows || [])
      .filter((r) =>
        isOfferBrandVisibleForSupplierProfile(req.user?.profile || {}, r?.attributes, null)
      )
      .forEach((r) => {
        myByMineId[r.id] = r;
      });

    const { data: upstreamOffers, error: upstreamErr } = await supabase
      .from('supplier_products')
      .select('id, supplier_id, product_id, variant_key, variant_asin, price, stock, min_order_quantity, attributes, outlet_id, location, product:products(id, name, category, unit, description, specifications, brand)')
      .eq('is_active', true)
      .neq('status', 'rejected')
      .in('id', upstreamOfferIds);
    if (upstreamErr) throw upstreamErr;

    const upstreamOfferById = {};
    (upstreamOffers || []).forEach((r) => (upstreamOfferById[r.id] = r));

    // Security guard: seller must match at least one immediate upstream role for any role the buyer declared.
    const parentRolesUnion = getImmediateParentRolesUnion(req.user.profile);
    const selectedBrandNames = [
      ...new Set(
        Object.values(myByMineId)
          .map((r) => String(r?.attributes?.brandModel || '').trim())
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

    const sameVariantMatch = (mineOffer, upstreamOffer) => {
      const mineVariantKey = String(mineOffer?.variant_key || '').trim();
      const mineVariantAsin = String(mineOffer?.variant_asin || '').trim();
      const upstreamVariantKey = String(upstreamOffer?.variant_key || '').trim();
      const upstreamVariantAsin = String(upstreamOffer?.variant_asin || '').trim();

      if (mineVariantKey) return Boolean(upstreamVariantKey) && upstreamVariantKey === mineVariantKey;
      if (mineVariantAsin) return Boolean(upstreamVariantAsin) && upstreamVariantAsin === mineVariantAsin;
      return Boolean(mineOffer?.product_id) && upstreamOffer?.product_id === mineOffer.product_id;
    };

    // Group lines by upstream supplier (order per supplier)
    const groups = new Map(); // supplier_id -> { supplierId, items: [...] }

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
          message: 'Selected upstream offer does not match the same variant as your chosen product.'
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

      const supplierId = upstreamOffer.supplier_id;

      if (supplierId === req.userId) {
        return res.status(400).json({ status: 'error', message: 'You cannot place an upstream order to your own listing.' });
      }

      const upProfile = upstreamProfileById[supplierId];
      const brandKey = normalizeBrandKeyFromAttributes(
        resolveUpstreamBrandLabel(myOffer?.attributes, null)
      );
      const chainRow = adminBrandChainMap.get(brandKey) || null;
      const buyerRole =
        sortRolesByChainDepthDesc(getMySupplierRoles(req.user.profile || {}, ''))[0] || null;
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
        parentRolesUnion
      });

      const cartBrandToken =
        resolveUpstreamBrandLabel(myOffer?.attributes, myOffer?.product?.brand) || brandKey;
      if (!sellerMatchesUpstreamForBrand(upProfile, allowedRolesSet, cartBrandToken, chainRouting)) {
        return res.status(403).json({
          status: 'error',
          message: `Selected upstream supplier is not registered for brand "${cartBrandToken}" at any allowed supply-chain tier above you (per admin chain for that brand).`
        });
      }

      if (!groups.has(supplierId)) groups.set(supplierId, { supplierId, items: [] });
      groups.get(supplierId).items.push({
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

      // Inventory movement: decrease upstream seller stock
      try {
        for (const inserted of insertedItems || []) {
          const matchingLine = group.items.find((li) => li.upstreamSupplierProductId === inserted.supplier_product_id);
          const qty = parseFloat(inserted.quantity || 0) || 0;
          const up = inserted.supplier_product_id ? upstreamOfferById[inserted.supplier_product_id] : null;
          if (!matchingLine || !up) continue;

          await recordInventoryMovement({
            supplierProductId: inserted.supplier_product_id,
            supplierId: supplierId,
            productId: up.product_id,
            quantityChange: -qty,
            movementType: 'sale_online',
            referenceOrderId: order.id,
            referenceOrderItemId: inserted.id,
            notes: 'B2B upstream order created from supplier portal',
            userId: req.userId
          });
        }
      } catch (invErr) {
        // Do not fail the order creation if inventory logging fails; monitor via logs.
        console.error('[Upstream Orders] inventory movement error:', invErr);
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

    const { data: mineRow, error: mineError } = await supabase
      .from('supplier_products')
      .select('id, supplier_id, min_order_quantity, attributes, product:products(brand)')
      .eq('id', mineSupplierProductId)
      .eq('supplier_id', req.userId)
      .maybeSingle();
    if (mineError) throw mineError;
    if (!mineRow) {
      return res.status(404).json({ status: 'error', message: 'Selected product was not found in your inventory' });
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
      updatedProject = {
        ...existing,
        selectedMine: {
          ...(existing.selectedMine || {}),
          [mineSupplierProductId]: quantity
        }
      };
      nextProjects[idx] = updatedProject;
    } else {
      if (hasDuplicateUpstreamProject(currentProjects, requestedCartName, requiredDate)) {
        return res.status(400).json({
          status: 'error',
          message: 'A supplier project with the same name and expected delivery date already exists'
        });
      }
      updatedProject = buildUpstreamProject({
        cartName: requestedCartName || `Quick Add - ${mineSupplierProductId.slice(0, 8)}`,
        requiredDate,
        selectedMine: { [mineSupplierProductId]: quantity },
        selectedUpstreamOffer: {},
        suggestions: [],
        brandFilter: '',
        searchTerm: ''
      });
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

    return res.json({
      status: 'success',
      cart: cart
        ? {
            id: cart.id,
            draft: normalizeUpstreamCartDraft(cart.draft_payload || {}),
            updatedAt: cart.updated_at,
            createdAt: cart.created_at
          }
        : null
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
        message: 'A supplier project with the same name and expected delivery date already exists'
      });
    }
    if (projects.length === 0) {
      projects.push(
        buildUpstreamProject({
          projectId: targetProjectId || null,
          cartName
        })
      );
    } else {
      const idx = targetProjectId
        ? projects.findIndex((p) => String(p?.projectId || '') === targetProjectId)
        : 0;
      const safeIdx = idx >= 0 ? idx : 0;
      projects[safeIdx] = buildUpstreamProject({
        ...projects[safeIdx],
        cartName,
        requiredDate
      });
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

    return res.json({
      status: 'success',
      message: 'Upstream project details updated',
      cart: {
        id: saved.id,
        updatedAt: saved.updated_at,
        projectId: targetProjectId || null,
        cartName,
        requiredDate: requiredDate || null
      }
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

    const nextProject = buildUpstreamProject({
      projectId: payloadInput.projectId || null,
      cartName: String(payloadInput.cartName || '').trim(),
      requiredDate: String(payloadInput.requiredDate || '').trim(),
      selectedMine: payloadInput.selectedMine || {},
      selectedUpstreamOffer: payloadInput.selectedUpstreamOffer || {},
      suggestions: Array.isArray(payloadInput.suggestions) ? payloadInput.suggestions : [],
      brandFilter: String(payloadInput.brandFilter || '').trim(),
      searchTerm: String(payloadInput.searchTerm || '').trim()
    });
    let nextProjects = Array.isArray(currentDraft.projects) ? [...currentDraft.projects] : [];
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
          message: 'A supplier project with the same name and expected delivery date already exists'
        });
      }
      const idx = nextProjects.findIndex((p) => String(p?.projectId || '') === String(payloadInput.projectId));
      if (idx >= 0) {
        nextProjects[idx] = nextProject;
      } else {
        nextProjects = [nextProject, ...nextProjects];
      }
    } else {
      // No projectId means user intentionally saved a fresh project from upstream flow.
      if (hasDuplicateUpstreamProject(nextProjects, nextProject.cartName, nextProject.requiredDate)) {
        return res.status(400).json({
          status: 'error',
          message: 'A supplier project with the same name and expected delivery date already exists'
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
