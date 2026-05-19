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
  mapSupplyChainPartner,
  minHaversineKmBuyerOutletsToSeller,
  normalizeBrandKeyFromAttributes,
  normalizeText,
  parseBrandTokens,
  parseWithSchema,
  pickMatchingUpstreamRoleForSeller,
  rankUpstreamOffersForProduct,
  recordInventoryMovement,
  resolveGeoFromOutletAddress,
  resolveRequiredUpstreamRoleFromAdminChain,
  sellerMatchesUpstreamRoles,
  supplierUpstreamCartSaveSchema,
  supplierUpstreamOrdersSchema
} from './supplierImports.js';
import {
  ORDER_INSERT_MAX_RETRIES,
  isOrderNumberConflictError
} from './shared/productHelpers.js';

export function registerSupplierUpstreamRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase,
    resolveTaxRatesForProductCreate
  } = ctx;

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
      .select('id, product_id, stock, min_order_quantity, outlet_id, location, attributes, is_active, status')
      .eq('supplier_id', req.userId)
      .in('id', supplierProductIds)
      .eq('is_active', true)
      .neq('status', 'rejected');

    if (myErr) throw myErr;

    const myOffers = myRows || [];
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
          .map((r) => String(r?.attributes?.brandModel || '').trim())
          .filter(Boolean)
      )
    ];
    const adminBrandChainMap = await loadAdminBrandChainsByName({
      supabase,
      brandNames: selectedBrandNames
    });

    // Fetch upstream offers for selected product_ids (plus same-name products).
    // We match by product name (and category) because identity fields can differ across suppliers.
    const productIds = [...new Set(myOffers.map((r) => r.product_id).filter(Boolean))];

    const { data: myProductRows } = await supabase
      .from('products')
      .select('id, name, category')
      .in('id', productIds);

    // Build "equivalent" product ids by name similarity within the same category.
    // Keep it bounded: for each selected product, search a small set and then verify by normalized text in JS.
    const equivalentProductIdsSet = new Set(productIds);
    const matchProductIdsByMineProductId = {};

    const normalizeNameForMatch = (value) =>
      normalizeText(String(value || ''))
        .replace(/\b(the|a|an|new|model|edition)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const tokenSet = (value) =>
      new Set(
        normalizeNameForMatch(value)
          .split(' ')
          .map((t) => t.trim())
          .filter((t) => t && t.length >= 2)
      );

    const jaccard = (a, b) => {
      if (!a || !b || a.size === 0 || b.size === 0) return 0;
      let inter = 0;
      for (const t of a) if (b.has(t)) inter += 1;
      const union = a.size + b.size - inter;
      return union > 0 ? inter / union : 0;
    };

    for (const p of myProductRows || []) {
      const rawName = String(p?.name || '').trim();
      const category = String(p?.category || '').trim();
      if (!rawName || !category) {
        matchProductIdsByMineProductId[p?.id] = [p?.id].filter(Boolean);
        continue;
      }

      // Search by ILIKE name in the same category.
      const { data: nameMatches } = await supabase
        .from('products')
        .select('id, name')
        .eq('category', category)
        .ilike('name', `%${rawName}%`)
        .limit(25);

      const normalizedInput = normalizeNameForMatch(rawName);
      const inputTokens = tokenSet(rawName);
      const verified = (nameMatches || [])
        .filter((row) => {
          const n = normalizeNameForMatch(row?.name || '');
          if (!n) return false;
          if (n === normalizedInput) return true;
          // Allow containment when names differ by minor suffix/prefix (e.g. "Mac Air M1 8GB" vs "Mac Air M1")
          if (normalizedInput.length >= 4 && (n.includes(normalizedInput) || normalizedInput.includes(n))) return true;
          // Token overlap fallback
          const score = jaccard(inputTokens, tokenSet(row?.name || ''));
          return score >= 0.65;
        })
        .map((row) => row.id)
        .filter(Boolean);

      // Always include itself.
      const merged = [...new Set([p.id, ...verified].filter(Boolean))];
      matchProductIdsByMineProductId[p.id] = merged;
      merged.forEach((id) => equivalentProductIdsSet.add(id));
    }

    const equivalentProductIds = [...equivalentProductIdsSet].filter(Boolean);
    if (equivalentProductIds.length === 0) {
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
    const { data: upstreamOffers } = await supabase
      .from('supplier_products')
      .select('id, product_id, supplier_id, stock, price, outlet_id, location, status, is_active, attributes, min_order_quantity')
      .in('product_id', equivalentProductIds)
      .eq('is_active', true)
      .neq('status', 'rejected')
      .gt('stock', 0);

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

    const upstreamByProduct = new Map();
    for (const row of upstreamOffers || []) {
      if (!row?.product_id) continue;
      // Never suggest the buyer's own listing as "upstream" (missing profile row used to pass the old !hasAnyRole bypass).
      if (row.supplier_id === req.userId) continue;
      if (!upstreamByProduct.has(row.product_id)) upstreamByProduct.set(row.product_id, []);
      upstreamByProduct.get(row.product_id).push(row);
    }

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
      const desiredBrand = String(mine?.attributes?.brandModel || '').trim().toLowerCase();
      const brandKey = normalizeBrandKeyFromAttributes(mine?.attributes?.brandModel);
      const chainRow = adminBrandChainMap.get(brandKey) || null;
      const chainRouting = resolveRequiredUpstreamRoleFromAdminChain({
        profile: req.user.profile || {},
        brandKey,
        chainRow
      });
      const allowedRolesSet =
        chainRouting.requiredUpstreamRole && SUPPLIER_ROLE_SET.has(chainRouting.requiredUpstreamRole)
          ? new Set([chainRouting.requiredUpstreamRole])
          : parentRolesUnion;

      // Collect offers for this exact product_id AND any same-name equivalents in the same category.
      const equivalentIdsForMine =
        matchProductIdsByMineProductId[mine.product_id] && Array.isArray(matchProductIdsByMineProductId[mine.product_id])
          ? matchProductIdsByMineProductId[mine.product_id]
          : [mine.product_id].filter(Boolean);

      const upstreamOfferPool = [];
      for (const pid of equivalentIdsForMine) {
        const rows = upstreamByProduct.get(pid) || [];
        upstreamOfferPool.push(...rows);
      }

      const candidates = upstreamOfferPool
        .filter((u) => {
          if (!desiredBrand) return true;
          const b = String(u?.attributes?.brandModel || '').trim().toLowerCase();
          return b ? b === desiredBrand || b.includes(desiredBrand) || desiredBrand.includes(b) : true;
        })
        .filter((offer) => {
          if (!offer.supplier_id || offer.supplier_id === req.userId) return false;
          const sup = upstreamUserMap[offer.supplier_id];
          if (!sup?.profile) return false;
          return sellerMatchesUpstreamRoles(sup.profile, allowedRolesSet);
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
          const matchedRole = sup ? pickMatchingUpstreamRoleForSeller(sup.profile, allowedRolesSet) : null;
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
            offerStatus: u.status,
            isActive: u.is_active,
            stock: u.stock,
            price: u.price,
            minOrderQuantity: u.min_order_quantity,
            location: locationDisplay,
            locationSource,
            offerOutletAddress: outletAddressText || null,
            offerGeoLocation: geo || null,
            distanceSource: geoInfo?.source || null,
            brandModel: u?.attributes?.brandModel || null,
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

      return {
        mineSupplierProductId: mine.id,
        productId: mine.product_id,
        brandModel: mine?.attributes?.brandModel || null,
        upstreamRole: parentRole,
        upstreamRoles: parentRolesSorted,
        chainRouting: {
          source: chainRouting.source,
          brand: chainRow?.category_name || mine?.attributes?.brandModel || null,
          buyerRole: chainRouting.buyerRole,
          requiredUpstreamRole: chainRouting.requiredUpstreamRole,
          chainRoles: chainRouting.chainRoles
        },
        upstreamOffers: top
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
      chainPolicy: 'brand_admin_chain_with_profile_fallback',
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
    const { lines } = payloadInput;

    const mineIds = [...new Set(lines.map((l) => l?.mineSupplierProductId).filter(Boolean))];
    const upstreamOfferIds = [...new Set(lines.map((l) => l?.upstreamSupplierProductId).filter(Boolean))];

    // Validate my selected supplier products
    const { data: myRows, error: myErr } = await supabase
      .from('supplier_products')
      .select('id, product_id, attributes')
      .eq('supplier_id', req.userId)
      .in('id', mineIds);
    if (myErr) throw myErr;
    const myByMineId = {};
    (myRows || []).forEach((r) => (myByMineId[r.id] = r));

    const { data: upstreamOffers, error: upstreamErr } = await supabase
      .from('supplier_products')
      .select('id, supplier_id, product_id, price, stock, min_order_quantity, attributes, outlet_id, location, product:products(id, name, category, unit, description, specifications, brand)')
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
        (myRows || [])
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

    // Group lines by upstream supplier (order per supplier)
    const groups = new Map(); // supplier_id -> { supplierId, items: [...] }

    for (const line of lines) {
      const mineSupplierProductId = line?.mineSupplierProductId;
      const upstreamSupplierProductId = line?.upstreamSupplierProductId;
      const rawQty = line?.quantity;
      const quantity = parseInt(rawQty, 10);

      if (!mineSupplierProductId || !upstreamSupplierProductId) {
        return res.status(400).json({ status: 'error', message: 'mineSupplierProductId and upstreamSupplierProductId are required for each line' });
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ status: 'error', message: 'quantity must be a positive integer for each line' });
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

      if (upstreamOffer.product_id !== myProductId) {
        return res.status(400).json({ status: 'error', message: 'Selected upstream offer does not match the chosen product' });
      }

      const minQty = parseInt(upstreamOffer.min_order_quantity || 1, 10) || 1;
      if (quantity < minQty) {
        return res.status(400).json({ status: 'error', message: `Quantity for ${upstreamOffer.product_id} must be >= ${minQty}` });
      }

      const supplierId = upstreamOffer.supplier_id;

      if (supplierId === req.userId) {
        return res.status(400).json({ status: 'error', message: 'You cannot place an upstream order to your own listing.' });
      }

      const upProfile = upstreamProfileById[supplierId];
      const brandKey = normalizeBrandKeyFromAttributes(myOffer?.attributes?.brandModel);
      const chainRow = adminBrandChainMap.get(brandKey) || null;
      const chainRouting = resolveRequiredUpstreamRoleFromAdminChain({
        profile: req.user.profile || {},
        brandKey,
        chainRow
      });
      const allowedRolesSet =
        chainRouting.requiredUpstreamRole && SUPPLIER_ROLE_SET.has(chainRouting.requiredUpstreamRole)
          ? new Set([chainRouting.requiredUpstreamRole])
          : parentRolesUnion;

      if (!sellerMatchesUpstreamRoles(upProfile, allowedRolesSet)) {
        return res.status(403).json({
          status: 'error',
          message:
            chainRouting.source === 'admin_chain' && chainRouting.requiredUpstreamRole
              ? `Selected upstream offer is not in the admin-defined next role for this brand. Required role: ${SUPPLY_CHAIN_ROLE_LABELS[chainRouting.requiredUpstreamRole] || chainRouting.requiredUpstreamRole}.`
              : 'Selected upstream offer is not allowed for your supply-chain role(s).'
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
      const matchedRole = pickMatchingUpstreamRoleForSeller(upProfile, allowedRolesForMov);
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
      for (let attempt = 0; attempt <= ORDER_INSERT_MAX_RETRIES; attempt++) {
        const orderInsertResult = await supabase
          .from('orders')
          .insert({
            service_provider_id: req.userId, // buyer = current supplier
            supplier_id: supplierId, // seller = upstream supplier
            total_amount: totalAmount,
            expected_delivery_date: null,
            status: 'confirmed',
            payment_status: 'pending',
            payment_method: 'online',
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
        paymentStatus: order.payment_status
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
            draft: cart.draft_payload || {},
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

router.put('/upstream/cart', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can save upstream cart' });
    }

    const payloadInput = parseWithSchema(supplierUpstreamCartSaveSchema, req.body || {});
    const draftPayload = {
      mode: 'supplier_upstream',
      selectedMine: payloadInput.selectedMine || {},
      selectedUpstreamOffer: payloadInput.selectedUpstreamOffer || {},
      suggestions: Array.isArray(payloadInput.suggestions) ? payloadInput.suggestions : [],
      brandFilter: String(payloadInput.brandFilter || '').trim(),
      searchTerm: String(payloadInput.searchTerm || '').trim()
    };

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

    if (limit != null) {
      query = query.limit(limit);
    }

    const { data: orders, error } = await query;

    if (error) throw error;

    return res.json({
      status: 'success',
      orders: (orders || []).map((o) => ({
        id: o.id,
        orderNumber: o.order_number,
        supplierId: o.supplier_id,
        supplierName: o.supplier?.name || o.supplier?.company || 'Supplier',
        totalAmount: parseFloat(o.total_amount || 0),
        status: o.status,
        paymentStatus: o.payment_status || 'pending',
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
