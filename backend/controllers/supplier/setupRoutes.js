/** Supplier routes: setup */
import {
  PARENT_ROLE_BY_MY_ROLE,
  SUPPLY_CHAIN_ROLE_LABELS,
  fetchPendingChainRequest,
  getContractErrorMessage,
  getMySupplierRoles,
  getViewerBrandTokensForRole,
  loadAdminBrandChainsByName,
  mapSupplyChainPartner,
  normalizeBcovBrand,
  normalizeChainNameKey,
  normalizeChainRolesFromStages,
  parseBcovNotes,
  parseCovThresholdNumber,
  parseWithSchema,
  pickDisplayRoleFromAllowedSet,
  pickMatchingUpstreamRoleForSeller,
  resolveBcovPriceForBuyerMetrics,
  sortRolesByChainDepthDesc,
  supplierBcovLevelsUpsertSchema,
  supplierBcovResolvePriceSchema,
  toFiniteNumber,
  validateAndNormalizeBcovLevels
} from './supplierImports.js';

export function registerSupplierSetupRoutes(ctx) {
  const {
    router,
    authenticateToken,
    supabase
  } = ctx;

router.get('/setup-status', authenticateToken, async (req, res) => {
  try {
    // Prefer supplier_products (new multi-supplier model)
    const { count, error } = await supabase
      .from('supplier_products')
      .select('*', { count: 'exact', head: true })
      .eq('supplier_id', req.userId);
    
    if (error) {
      // Fallback: count legacy products owned by this supplier
      const { count: legacyCount, error: legacyError } = await supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('supplier_id', req.userId);

      if (legacyError) {
        throw legacyError;
      }

      return res.json({
        status: 'success',
        hasProducts: (legacyCount || 0) > 0,
        productCount: legacyCount || 0
      });
    }
    
    res.json({ 
      status: 'success',
      hasProducts: (count || 0) > 0,
      productCount: count || 0
    });
  } catch (error) {
    console.error('Get setup status error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Internal server error' 
    });
  }
});

router.get('/supply-chain-partners', authenticateToken, async (req, res) => {
  try {
    if (req.user.user_type !== 'supplier') {
      return res.status(403).json({
        status: 'error',
        message: 'Only suppliers can view supply chain partners'
      });
    }

    const pendingChainRequest = await fetchPendingChainRequest(req.userId);
    const pendingPayload = pendingChainRequest?.payload || null;
    const effectiveViewerProfile = pendingPayload
      ? {
          ...(req.user.profile || {}),
          supplierRole: String(pendingPayload?.supplierRole || '').trim(),
          brands: typeof pendingPayload?.brands === 'string' ? pendingPayload.brands : '',
          companyInfoEntries: Array.isArray(pendingPayload?.companyInfoEntries)
            ? pendingPayload.companyInfoEntries
            : []
        }
      : req.user.profile;

    const previewRole = (req.query.previewRole || '').trim();
    const myRoles = getMySupplierRoles(effectiveViewerProfile, previewRole);

    if (myRoles.length === 0) {
      return res.json({
        status: 'success',
        yourRole: null,
        yourRoleLabel: null,
        parentRole: null,
        parentRoleLabel: null,
        partners: [],
        partnerGroups: [],
        message:
          'Select your business type (MGF, Stockist, …) in Profile to see partners one step above you in the chain.'
      });
    }

    const sortedMyRoles = sortRolesByChainDepthDesc(myRoles);
    const onlyManufacturers = sortedMyRoles.length === 1 && sortedMyRoles[0] === 'manufacturer';
    if (onlyManufacturers) {
      const mr = sortedMyRoles[0];
      return res.json({
        status: 'success',
        yourRole: mr,
        yourRoleLabel: SUPPLY_CHAIN_ROLE_LABELS[mr] || mr,
        parentRole: null,
        parentRoleLabel: null,
        partners: [],
        partnerGroups: [],
        message:
          'As a manufacturer (MGF) you are at the top of the supply chain — there are no upstream partners to list here.'
      });
    }

    const { data: rows, error } = await supabase
      .from('users')
      .select('id, name, company, phone, email, address, profile')
      .eq('user_type', 'supplier')
      .eq('is_active', true)
      .neq('id', req.userId);

    if (error) {
      throw error;
    }

    const allRows = rows || [];
    const partnerGroups = [];
    const seenParentRole = new Set();

    const viewerRoles = getMySupplierRoles(effectiveViewerProfile, '');
    const viewerBrandTokensByRole = new Map();
    const allViewerBrandTokens = new Set();
    for (const role of viewerRoles) {
      const tokens = getViewerBrandTokensForRole(effectiveViewerProfile, role);
      viewerBrandTokensByRole.set(role, tokens);
      for (const t of tokens) allViewerBrandTokens.add(t);
    }
    const adminBrandChainMap = await loadAdminBrandChainsByName({
      supabase,
      brandNames: [...allViewerBrandTokens]
    });

    for (const myRole of sortedMyRoles) {
      const viewerBrandTokens = viewerBrandTokensByRole.get(myRole) || new Set();
      const allowedParentRolesSet = new Set();
      for (const token of viewerBrandTokens) {
        const chainRow = adminBrandChainMap.get(normalizeChainNameKey(token));
        const chainRoles = normalizeChainRolesFromStages(chainRow?.stages);
        const idx = chainRoles.indexOf(myRole);
        if (idx > 0) {
          allowedParentRolesSet.add(chainRoles[idx - 1]);
        }
      }
      if (allowedParentRolesSet.size === 0) {
        const fallbackParentRole = PARENT_ROLE_BY_MY_ROLE[myRole];
        if (fallbackParentRole) allowedParentRolesSet.add(fallbackParentRole);
      }
      const parentRole = pickDisplayRoleFromAllowedSet(allowedParentRolesSet);
      if (!parentRole || seenParentRole.has(parentRole)) continue;
      seenParentRole.add(parentRole);

      const partners = allRows
        .map((u) => {
          if (!u.profile) return null;
          const matchedRole = pickMatchingUpstreamRoleForSeller(u.profile, allowedParentRolesSet);
          if (!matchedRole) return null;
          return mapSupplyChainPartner(u, matchedRole, viewerBrandTokens);
        })
        .filter(Boolean);

      const label = SUPPLY_CHAIN_ROLE_LABELS[parentRole] || parentRole;
      partnerGroups.push({
        yourRole: myRole,
        yourRoleLabel: SUPPLY_CHAIN_ROLE_LABELS[myRole] || myRole,
        parentRole,
        parentRoleLabel: label,
        partners,
        message:
          partners.length === 0
            ? viewerBrandTokens.size > 0
              ? `No ${label} match the brands you listed for your ${SUPPLY_CHAIN_ROLE_LABELS[myRole] || myRole} profile yet. Use the same brand names as in your registration, or clear brands on that role to see all ${label}.`
              : `No registered ${label} yet. They will appear here once they sign up and set their role.`
            : null
      });
    }

    const first = partnerGroups[0];
    return res.json({
      status: 'success',
      yourRole: first?.yourRole ?? null,
      yourRoleLabel: first?.yourRoleLabel ?? null,
      parentRole: first?.parentRole ?? null,
      parentRoleLabel: first?.parentRoleLabel ?? null,
      partners: first?.partners ?? [],
      partnerGroups,
      message: partnerGroups.every((g) => g.partners.length === 0)
        ? partnerGroups.map((g) => g.message).filter(Boolean)[0] || null
        : null
    });
  } catch (err) {
    console.error('supply-chain-partners error:', err);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to load supply chain partners'
    });
  }
});

// BCOV levels (brand-wise quantity slabs -> unit price)
router.get('/bcov-levels', authenticateToken, async (req, res) => {
  try {
    const scopeKey = String(req.query.scopeKey || '').trim();
    const normalizedScopeKey = normalizeBcovBrand(scopeKey);

    let query = supabase
      .from('supplier_bcov_levels')
      .select('id, brand_name, min_purchase_qty, max_purchase_qty, unit_price, notes')
      .eq('supplier_id', req.userId)
      .order('normalized_brand', { ascending: true })
      .order('min_purchase_qty', { ascending: true });

    if (normalizedScopeKey) {
      query = query.eq('normalized_brand', normalizedScopeKey);
    }

    const { data, error } = await query;

    if (error) throw error;

    return res.json({
      status: 'success',
      levels: (data || []).map((r) => {
        const parsedNotes = parseBcovNotes(r.notes);
        return {
          id: r.id,
          brand: r.brand_name,
          levelName: parsedNotes.levelName,
          buyerBcov: parsedNotes.buyerBcov,
          buyerCov: Number(r.min_purchase_qty),
          buyerPcov: r.max_purchase_qty == null ? null : Number(r.max_purchase_qty),
          minPurchaseQty: Number(r.min_purchase_qty),
          maxPurchaseQty: r.max_purchase_qty == null ? null : Number(r.max_purchase_qty),
          price: Number(r.unit_price),
          notes: parsedNotes.rawNotes
        };
      })
    });
  } catch (error) {
    console.error('Get BCOV levels error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load BCOV levels' });
  }
});

router.put('/bcov-levels', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierBcovLevelsUpsertSchema, req.body || {});
    const scopeKey = String(payloadInput.scopeKey || '').trim();
    const normalizedScopeKey = normalizeBcovBrand(scopeKey);
    const parsed = validateAndNormalizeBcovLevels(payloadInput.levels || []);
    if (!parsed.ok) {
      return res.status(400).json({ status: 'error', message: parsed.message });
    }

    if (normalizedScopeKey) {
      const hasOutOfScopeBrand = parsed.levels.some((row) => row.normalizedBrand !== normalizedScopeKey);
      if (hasOutOfScopeBrand) {
        return res.status(400).json({
          status: 'error',
          message: 'All Product_COV rows must belong to the selected product/brand scope.'
        });
      }
    }

    const payload = parsed.levels.map((row) => ({
      supplier_id: req.userId,
      brand_name: row.brand,
      normalized_brand: row.normalizedBrand,
      min_purchase_qty: row.minPurchaseQty,
      max_purchase_qty: row.maxPurchaseQty,
      unit_price: row.price,
      notes: row.notes
    }));

    let deleteQuery = supabase
      .from('supplier_bcov_levels')
      .delete()
      .eq('supplier_id', req.userId);
    if (normalizedScopeKey) {
      deleteQuery = deleteQuery.eq('normalized_brand', normalizedScopeKey);
    }
    const { error: deleteError } = await deleteQuery;
    if (deleteError) throw deleteError;

    if (payload.length > 0) {
      const { error: insertError } = await supabase
        .from('supplier_bcov_levels')
        .insert(payload);
      if (insertError) throw insertError;
    }

    return res.json({
      status: 'success',
      message: 'BCOV levels saved successfully',
      count: payload.length
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Save BCOV levels error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to save BCOV levels' });
  }
});

router.post('/bcov-levels/resolve-price', authenticateToken, async (req, res) => {
  try {
    const payloadInput = parseWithSchema(supplierBcovResolvePriceSchema, req.body || {});
    const brand = String(payloadInput.brand || '').trim();
    const normalizedBrand = normalizeBcovBrand(brand);
    const legacyPurchaseQty = toFiniteNumber(payloadInput.purchaseQty);
    const supplierCov = toFiniteNumber(payloadInput.supplierCov);
    const platformCov = toFiniteNumber(payloadInput.platformCov);
    const brandCov = toFiniteNumber(payloadInput.brandCov);
    const effectiveSupplierCov = supplierCov ?? legacyPurchaseQty;
    const effectivePlatformCov = platformCov ?? legacyPurchaseQty;
    const effectiveBrandCov = brandCov ?? legacyPurchaseQty;

    if (!normalizedBrand) {
      return res.status(400).json({ status: 'error', message: 'brand is required' });
    }
    if (effectiveSupplierCov === null || effectiveSupplierCov < 0) {
      return res.status(400).json({ status: 'error', message: 'supplierCov must be 0 or more' });
    }
    if (effectivePlatformCov === null || effectivePlatformCov < 0) {
      return res.status(400).json({ status: 'error', message: 'platformCov must be 0 or more' });
    }
    if (effectiveBrandCov === null || effectiveBrandCov < 0) {
      return res.status(400).json({ status: 'error', message: 'brandCov must be 0 or more' });
    }

    const { data, error } = await supabase
      .from('supplier_bcov_levels')
      .select('id, brand_name, min_purchase_qty, max_purchase_qty, unit_price, notes')
      .eq('supplier_id', req.userId)
      .eq('normalized_brand', normalizedBrand)
      .order('min_purchase_qty', { ascending: false });

    if (error) throw error;

    const levels = data || [];
    const matched = resolveBcovPriceForBuyerMetrics({
      levels,
      supplierCov: effectiveSupplierCov,
      platformCov: effectivePlatformCov,
      brandCov: effectiveBrandCov
    });

    if (!matched) {
      return res.json({
        status: 'success',
        result: {
          matched: false,
          brand,
          supplierCov: effectiveSupplierCov,
          platformCov: effectivePlatformCov,
          brandCov: effectiveBrandCov
        }
      });
    }

    const matchedLevel = levels.find((row) => row.id === matched.levelId) || null;
    const parsedNotes = parseBcovNotes(matchedLevel?.notes);
    const supplierCovThreshold = parseCovThresholdNumber(parsedNotes.buyerBcov);
    const brandCovThreshold = toFiniteNumber(matchedLevel?.min_purchase_qty);
    const platformCovThreshold = toFiniteNumber(matchedLevel?.max_purchase_qty);
    return res.json({
      status: 'success',
      result: {
        matched: true,
        levelId: matched.levelId,
        brand: matchedLevel?.brand_name || brand,
        supplierCov: effectiveSupplierCov,
        platformCov: effectivePlatformCov,
        brandCov: effectiveBrandCov,
        levelName: parsedNotes.levelName,
        buyerBcov: parsedNotes.buyerBcov,
        buyerCov: brandCovThreshold,
        buyerPcov: platformCovThreshold,
        minPurchaseQty: brandCovThreshold,
        maxPurchaseQty: platformCovThreshold,
        supplierCovThreshold,
        platformCovThreshold,
        brandCovThreshold,
        appliedBy:
          supplierCovThreshold !== null && effectiveSupplierCov >= supplierCovThreshold
            ? 'supplier'
            : brandCovThreshold !== null && effectiveBrandCov >= brandCovThreshold
            ? 'brand'
            : 'platform',
        price: matched.price,
        notes: parsedNotes.rawNotes || null
      }
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Resolve BCOV price error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to resolve BCOV price' });
  }
});

// Get all products for a supplier (including pending, approved, and rejected)
}
