/** Supplier routes: inventory */
import {
  ROLE_DEPTH,
  SUPPLY_CHAIN_ROLE_LABELS,
  brandIsAllowedForSupplier,
  entryOverlapsViewerBrands,
  getContractErrorMessage,
  getImmediateParentRolesUnion,
  getViewerBrandTokensUnionForAllRoles,
  haversineKm,
  loadEffectiveSupplierChainProfile,
  parseBrandTokens,
  parseWithSchema,
  recordInventoryMovement,
  sellerMatchesUpstreamRoles,
  supplierInventoryAdjustSchema
} from './supplierImports.js';
import { expireStaleReservations } from '../../services/checkoutInventoryReservationService.js';

export function registerSupplierInventoryRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase
  } = ctx;

router.get('/inventory/summary', authenticateToken, async (req, res) => {
  try {
    // Scoped to this supplier's own holds — no need to sweep the whole platform on every page load.
    await expireStaleReservations({ supplierId: req.userId });

    const { data: rows, error } = await supabase
      .from('supplier_products')
      .select(`
        id,
        price,
        stock,
        status,
        is_active,
        outlet_id,
        product:products (id, name, category, unit),
        outlet:outlets (id, name, code)
      `)
      .eq('supplier_id', req.userId)
      // Hide rejected items from supplier inventory summary.
      .neq('status', 'rejected');

    if (error) {
      throw error;
    }

    const items = rows || [];

    // Overall totals
    let totalStockQty = 0;
    let totalStockValue = 0;

    // Group by outlet
    const outletsMap = {};

    for (const row of items) {
      const qty = parseInt(row.stock) || 0;
      const price = parseFloat(row.price) || 0;
      const value = qty * price;

      totalStockQty += qty;
      totalStockValue += value;

      const outletId = row.outlet_id || 'unassigned';
      if (!outletsMap[outletId]) {
        const outlet = row.outlet || {};
        outletsMap[outletId] = {
          outletId: outlet.id || null,
          outletCode: outlet.code || null,
          outletName: outlet.name || (outletId === 'unassigned' ? 'Unassigned' : 'Outlet'),
          totalStockQty: 0,
          totalStockValue: 0,
          productCount: 0
        };
      }

      outletsMap[outletId].totalStockQty += qty;
      outletsMap[outletId].totalStockValue += value;
      outletsMap[outletId].productCount += 1;
    }

    const outlets = Object.values(outletsMap);

    res.json({
      status: 'success',
      summary: {
        totalStockQty,
        totalStockValue,
        outletCount: outlets.length
      },
      outlets
    });
  } catch (error) {
    console.error('Supplier inventory summary error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Restock suggestions: for low-stock items, suggest nearest upstream suppliers for same product+brand.
router.get('/inventory/restock-suggestions', authenticateToken, async (req, res) => {
  try {
    if (req.user?.user_type !== 'supplier') {
      return res.status(403).json({ status: 'error', message: 'Only suppliers can view restock suggestions' });
    }

    const threshold = Math.max(0, parseInt(req.query.threshold, 10) || 10);
    const limitPerItem = Math.min(5, Math.max(1, parseInt(req.query.limit, 10) || 3));

    // Load my low-stock offers
    const { data: myRows, error: myErr } = await supabase
      .from('supplier_products')
      .select('id, product_id, stock, outlet_id, location, attributes, product:products(id, name, brand)')
      .eq('supplier_id', req.userId)
      .eq('is_active', true)
      .neq('status', 'rejected')
      .lte('stock', threshold);

    if (myErr) throw myErr;

    const myOffers = myRows || [];
    if (myOffers.length === 0) {
      return res.json({ status: 'success', threshold, items: [] });
    }

    // Determine my outlet geo per offer (if available)
    const outletIds = [...new Set(myOffers.map((r) => r.outlet_id).filter(Boolean))];
    const outletGeoById = {};
    if (outletIds.length > 0) {
      const { data: outs } = await supabase
        .from('outlets')
        .select('id, geo_location')
        .in('id', outletIds)
        .eq('is_active', true);
      for (const o of outs || []) {
        outletGeoById[o.id] = o.geo_location;
      }
    }

    // Union of immediate upstream partner types for every role the viewer declared (multi-role safe).
    const parentRolesUnion = getImmediateParentRolesUnion(req.user.profile);
    const parentRolesSorted = [...parentRolesUnion].sort((a, b) => (ROLE_DEPTH[a] ?? 99) - (ROLE_DEPTH[b] ?? 99));
    const parentRole = parentRolesSorted[0] || null;
    const parentRolesLabel = parentRolesSorted
      .map((r) => SUPPLY_CHAIN_ROLE_LABELS[r] || r)
      .join(', ');

    if (parentRolesUnion.size === 0) {
      return res.json({
        status: 'success',
        threshold,
        items: myOffers.map((r) => ({
          supplierProductId: r.id,
          productId: r.product_id,
          stock: r.stock,
          suggestions: [],
          message: 'No upstream role available for your current supply-chain role (e.g. manufacturer has no upstream).'
        }))
      });
    }

    const viewerBrandTokens = getViewerBrandTokensUnionForAllRoles(req.user.profile);
    const productIds = [...new Set(myOffers.map((r) => r.product_id).filter(Boolean))];

    let upstreamOffers = [];
    if (productIds.length > 0) {
      const { data: offerRows, error: offerErr } = await supabase
        .from('supplier_products')
        .select(
          'id, product_id, supplier_id, stock, price, outlet_id, location, status, is_active, attributes, product:products(id, name, brand)'
        )
        .in('product_id', productIds)
        .neq('supplier_id', req.userId)
        .neq('status', 'rejected')
        .gt('stock', 0);
      if (offerErr) throw offerErr;
      upstreamOffers = (offerRows || []).filter((row) => row?.is_active !== false);
    }

    const upstreamSupplierIds = [...new Set(upstreamOffers.map((row) => row.supplier_id).filter(Boolean))];
    const upstreamUserMap = {};
    if (upstreamSupplierIds.length > 0) {
      const { data: upstreamUsers } = await supabase
        .from('users')
        .select('id, name, company, address, profile')
        .eq('user_type', 'supplier')
        .eq('is_active', true)
        .in('id', upstreamSupplierIds);
      (upstreamUsers || []).forEach((u) => {
        upstreamUserMap[u.id] = u;
      });
    }

    const allowedSupplierIds = new Set();
    for (const supplierId of upstreamSupplierIds) {
      const sup = upstreamUserMap[supplierId];
      if (!sup?.profile || !sellerMatchesUpstreamRoles(sup.profile, parentRolesUnion)) continue;
      if (viewerBrandTokens.size === 0) {
        allowedSupplierIds.add(supplierId);
        continue;
      }
      const partnerEntries = (
        Array.isArray(sup.profile?.companyInfoEntries)
          ? sup.profile.companyInfoEntries
          : sup.profile?.companyInfoEntries && typeof sup.profile.companyInfoEntries === 'object'
            ? [sup.profile.companyInfoEntries]
            : []
      ).filter((e) => e && parentRolesUnion.has(e.role));
      const brandOk =
        partnerEntries.length > 0
          ? partnerEntries.some((e) => entryOverlapsViewerBrands(e, viewerBrandTokens))
          : sup.profile?.supplierRole && parentRolesUnion.has(sup.profile.supplierRole)
            ? entryOverlapsViewerBrands({ brands: sup.profile?.brands || '' }, viewerBrandTokens)
            : false;
      if (brandOk) allowedSupplierIds.add(supplierId);
    }

    const filteredOffers = upstreamOffers.filter((row) => allowedSupplierIds.has(row.supplier_id));
    const upstreamByProduct = new Map();
    for (const row of filteredOffers) {
      if (!row?.product_id) continue;
      if (!upstreamByProduct.has(row.product_id)) upstreamByProduct.set(row.product_id, []);
      upstreamByProduct.get(row.product_id).push(row);
    }

    // Load upstream outlets geo for distance calculation
    const upstreamOutletIds = [...new Set(filteredOffers.map((r) => r.outlet_id).filter(Boolean))];
    const upstreamOutletGeoById = {};
    if (upstreamOutletIds.length > 0) {
      const { data: outs } = await supabase
        .from('outlets')
        .select('id, supplier_id, geo_location')
        .in('id', upstreamOutletIds)
        .eq('is_active', true);
      for (const o of outs || []) upstreamOutletGeoById[o.id] = o.geo_location;
    }

    const items = myOffers.map((mine) => {
      if (!mine.product_id) {
        return {
          supplierProductId: mine.id,
          productId: null,
          productName: null,
          stock: mine.stock,
          brandModel: mine?.attributes?.brandModel || null,
          upstreamRole: parentRole,
          suggestions: [],
          message:
            'This item is not linked to a catalog product yet. Map it to a product to see upstream restock options.'
        };
      }

      const myGeo = mine.outlet_id ? outletGeoById[mine.outlet_id] : null;
      const desiredBrand = String(mine?.attributes?.brandModel || mine?.product?.brand || '').trim().toLowerCase();
      const candidates = (upstreamByProduct.get(mine.product_id) || [])
        .filter((u) => {
          if (!desiredBrand) return true;
          const offerBrand = String(u?.attributes?.brandModel || u?.product?.brand || '').trim().toLowerCase();
          if (!offerBrand) return true;
          return (
            offerBrand === desiredBrand ||
            offerBrand.includes(desiredBrand) ||
            desiredBrand.includes(offerBrand) ||
            parseBrandTokens(offerBrand).some((token) =>
              parseBrandTokens(desiredBrand).some(
                (mineToken) => mineToken === token || mineToken.includes(token) || token.includes(mineToken)
              )
            )
          );
        })
        .map((u) => {
          const geo = u.outlet_id ? upstreamOutletGeoById[u.outlet_id] : null;
          const dist =
            myGeo &&
            geo &&
            typeof myGeo.lat === 'number' &&
            typeof myGeo.lng === 'number' &&
            typeof geo.lat === 'number' &&
            typeof geo.lng === 'number'
              ? haversineKm(myGeo.lat, myGeo.lng, geo.lat, geo.lng)
              : null;
          const sup = upstreamUserMap[u.supplier_id];
          return {
            supplierProductId: u.id,
            supplierId: u.supplier_id,
            supplierName: sup?.name || sup?.company || 'Supplier',
            supplierCompany: sup?.company || '',
            role: parentRole,
            stock: u.stock,
            price: u.price,
            location: u.location,
            distanceKm: dist != null ? Math.round(dist * 10) / 10 : null
          };
        })
        .sort((a, b) => {
          if (a.distanceKm != null && b.distanceKm == null) return -1;
          if (a.distanceKm == null && b.distanceKm != null) return 1;
          if (a.distanceKm != null && b.distanceKm != null) return a.distanceKm - b.distanceKm;
          return (b.stock || 0) - (a.stock || 0);
        })
        .slice(0, limitPerItem);

      let message = null;
      if (candidates.length === 0) {
        if (filteredOffers.length === 0) {
          message =
            upstreamOffers.length === 0
              ? `No in-stock upstream offers found for this product (${parentRolesLabel || 'matching roles'}).`
              : `No upstream suppliers matched your supply-chain role and brands (${parentRolesLabel || 'matching roles'}).`;
        } else {
          message = 'No upstream offers matched this product and brand combination.';
        }
      }

      return {
        supplierProductId: mine.id,
        productId: mine.product_id,
        productName: mine?.product?.name || null,
        stock: mine.stock,
        brandModel: mine?.attributes?.brandModel || mine?.product?.brand || null,
        upstreamRole: parentRole,
        suggestions: candidates,
        ...(message ? { message } : {})
      };
    });

    return res.json({
      status: 'success',
      threshold,
      parentRole,
      parentRoles: parentRolesSorted,
      items
    });
  } catch (e) {
    console.error('Restock suggestions error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to load restock suggestions' });
  }
});

/**
 * Upstream suggestions for supplier ordering:
 * - Input: supplier's selected supplier_products (by junction IDs)
 * - Output: matching upstream supplier offers per product (role-based + brand overlap),
 *   ordered by: nearest distance → highest stock → lowest price → highest rating (top `limit` per line, default 5).
 */

router.get('/inventory/:id/history', authenticateToken, async (req, res) => {
  try {
    const supplierProductId = req.params.id;

    // Ensure the supplier_product belongs to this supplier
    const { data: supplierProduct, error: spError } = await supabase
      .from('supplier_products')
      .select('id, supplier_id, product_id, stock')
      .eq('id', supplierProductId)
      .single();

    if (spError || !supplierProduct || supplierProduct.supplier_id !== req.userId) {
      return res.status(404).json({
        status: 'error',
        message: 'Inventory entry not found for this supplier'
      });
    }

    const { data: movements, error: movError } = await supabase
      .from('inventory_movements')
      .select('*')
      .eq('supplier_product_id', supplierProductId)
      .order('created_at', { ascending: true });

    if (movError) {
      throw movError;
    }

    let onlineSold = 0;
    let offlineSold = 0;

    (movements || []).forEach(m => {
      if (m.movement_type === 'sale_online') {
        onlineSold += -(parseInt(m.quantity_change) || 0);
      } else if (m.movement_type === 'sale_offline') {
        offlineSold += -(parseInt(m.quantity_change) || 0);
      }
    });

    res.json({
      status: 'success',
      supplierProductId,
      productId: supplierProduct.product_id,
      currentStock: supplierProduct.stock,
      onlineSoldQty: onlineSold,
      offlineSoldQty: offlineSold,
      movements: movements || []
    });
  } catch (error) {
    console.error('Supplier inventory history error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Manual inventory adjustment for a specific supplier_product
router.post('/inventory/adjust', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierInventoryAdjustSchema, req.body || {});
    const { supplier_product_id, product_id, quantity_change, reason } = payloadInput;

    // Ensure the supplier_product belongs to this supplier
    const { data: supplierProduct, error: spError } = await supabase
      .from('supplier_products')
      .select('id, supplier_id, attributes, product:products (id, brand)')
      .eq('id', supplier_product_id)
      .single();

    if (spError || !supplierProduct || supplierProduct.supplier_id !== req.userId) {
      return res.status(404).json({
        status: 'error',
        message: 'Inventory entry not found for this supplier'
      });
    }

    // Brand lock: inventory changes should only apply to declared brands (when set)
    const brandCandidate =
      supplierProduct?.attributes?.brandModel ||
      supplierProduct?.product?.brand ||
      '';
    const effectiveProfile = await loadEffectiveSupplierChainProfile(req.userId, req.user?.profile || {});
    const brandGuard = brandIsAllowedForSupplier(effectiveProfile, brandCandidate);
    if (!brandGuard.allowed) {
      return res.status(403).json({
        status: 'error',
        message: 'You can only adjust inventory for brands you selected in your profile.',
        allowedBrands: brandGuard.declared || []
      });
    }

    const qtyChange = parseInt(quantity_change);
    if (!qtyChange || qtyChange === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'quantity_change must be a non-zero integer'
      });
    }

    await recordInventoryMovement({
      supplierProductId: supplier_product_id,
      supplierId: req.userId,
      productId: product_id,
      quantityChange: qtyChange,
      movementType: 'adjustment',
      referenceOrderId: null,
      referenceOrderItemId: null,
      notes: reason || 'Manual adjustment',
      userId: req.userId
    });

    res.json({
      status: 'success',
      message: 'Inventory adjustment recorded successfully'
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Supplier inventory adjust error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
});

// Sales by channel analytics for the logged-in supplier
}
