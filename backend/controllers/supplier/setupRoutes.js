/** Supplier routes: setup */
import {
  SUPPLY_CHAIN_ROLE_LABELS,
  baselineChainFromProfile,
  fetchPendingChainRequest,
  getContractErrorMessage,
  getMySupplierRoles,
  normalizeChainNameKey,
  normalizeChainRolesFromStages,
  parseBcovNotes,
  parseCovThresholdNumber,
  parseWithSchema,
  resolveBcovPriceForBuyerMetrics,
  sortRolesByChainDepthDesc,
  supplierBcovLevelsUpsertSchema,
  supplierBcovResolvePriceSchema,
  toFiniteNumber,
  fetchVariantCatalogMrp,
  validateAndNormalizeBcovLevels
} from './supplierImports.js';
import { buildSupplyChainPartnerGroups } from '../../services/supplyChainPartnerGroupsService.js';

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
    const approvedChain = baselineChainFromProfile(req.user.profile);
    const effectiveViewerProfile = pendingPayload
      ? {
          ...(req.user.profile || {}),
          supplierRole: String(pendingPayload?.supplierRole || '').trim(),
          brands: typeof pendingPayload?.brands === 'string' ? pendingPayload.brands : '',
          companyInfoEntries: Array.isArray(pendingPayload?.companyInfoEntries)
            ? pendingPayload.companyInfoEntries
            : []
        }
      : { ...(req.user.profile || {}), ...approvedChain };

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

    const partnerGroups = await buildSupplyChainPartnerGroups({
      effectiveViewerProfile,
      allSupplierRows: rows || [],
      supabase
    });

    const first = partnerGroups[0];
    return res.json({
      status: 'success',
      yourRole: first?.yourRole ?? null,
      yourRoleLabel: first?.yourRoleLabel ?? null,
      parentRole: first?.parentRole ?? null,
      parentRoleLabel: first?.parentRoleLabel ?? null,
      partners: first?.partners ?? [],
      partnerGroups,
      message:
        partnerGroups.length === 0
          ? 'No upstream partners yet. The supplier one step above you on the admin chain for your brand(s) must register on Who are you with the same brand.'
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

// BCOV levels (variant-based quantity slabs -> unit price)
router.get('/bcov-levels', authenticateToken, async (req, res) => {
  try {
    const variantKey = String(req.query.variantKey || '').trim();

    let query = supabase
      .from('supplier_bcov_levels')
      .select('id, variant_key, variant_asin, variant_name, brand_name, min_purchase_qty, max_purchase_qty, unit_price, notes')
      .eq('supplier_id', req.userId)
      .order('variant_key', { ascending: true })
      .order('min_purchase_qty', { ascending: true });

    if (variantKey) {
      query = query.eq('variant_key', variantKey);
    }

    const { data, error } = await query;

    if (error) throw error;

    const catalogMrp = variantKey ? await fetchVariantCatalogMrp(supabase, req.userId, variantKey) : null;

    return res.json({
      status: 'success',
      catalogMrp,
      levels: (data || []).map((r) => {
        const parsedNotes = parseBcovNotes(r.notes);
        return {
          id: r.id,
          variantKey: r.variant_key,
          variantAsin: r.variant_asin || null,
          variantName: r.variant_name || r.brand_name || '',
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
    const variantKey = String(payloadInput.variantKey || '').trim();
    const variantAsin = String(payloadInput.variantAsin || '').trim() || null;
    const variantName = String(payloadInput.variantName || '').trim() || null;

    if (!variantKey) {
      return res.status(400).json({ status: 'error', message: 'variantKey is required' });
    }

    const catalogMrp = await fetchVariantCatalogMrp(supabase, req.userId, variantKey);
    const parsed = validateAndNormalizeBcovLevels(payloadInput.levels || [], {
      catalogMrp,
      requireCatalogMrp: true
    });
    if (!parsed.ok) {
      return res.status(400).json({ status: 'error', message: parsed.message });
    }

    const hasOutOfScopeVariant = parsed.levels.some((row) => row.variantKey !== variantKey);
    if (hasOutOfScopeVariant) {
      return res.status(400).json({
        status: 'error',
        message: 'All Product_COV rows must belong to the selected variant.'
      });
    }

    const payload = parsed.levels.map((row) => ({
      supplier_id: req.userId,
      variant_key: variantKey,
      variant_asin: variantAsin,
      variant_name: variantName,
      brand_name: variantName || variantKey,
      normalized_brand: variantKey,
      min_purchase_qty: row.minPurchaseQty,
      max_purchase_qty: row.maxPurchaseQty,
      unit_price: row.price,
      notes: row.notes
    }));

    const { error: deleteError } = await supabase
      .from('supplier_bcov_levels')
      .delete()
      .eq('supplier_id', req.userId)
      .eq('variant_key', variantKey);
    if (deleteError) throw deleteError;

    if (payload.length > 0) {
      const { error: insertError } = await supabase
        .from('supplier_bcov_levels')
        .insert(payload);
      if (insertError) throw insertError;
    }

    return res.json({
      status: 'success',
      message: 'Product_COV levels saved successfully',
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
    const variantKey = String(payloadInput.variantKey || '').trim();
    const supplierCov = toFiniteNumber(payloadInput.supplierCov);
    const platformCov = toFiniteNumber(payloadInput.platformCov);
    const brandCov = toFiniteNumber(payloadInput.brandCov);

    if (!variantKey) {
      return res.status(400).json({ status: 'error', message: 'variantKey is required' });
    }
    if (supplierCov === null || supplierCov < 0) {
      return res.status(400).json({ status: 'error', message: 'supplierCov must be 0 or more' });
    }
    if (platformCov === null || platformCov < 0) {
      return res.status(400).json({ status: 'error', message: 'platformCov must be 0 or more' });
    }
    if (brandCov === null || brandCov < 0) {
      return res.status(400).json({ status: 'error', message: 'brandCov must be 0 or more' });
    }

    const { data, error } = await supabase
      .from('supplier_bcov_levels')
      .select('id, variant_key, variant_name, min_purchase_qty, max_purchase_qty, unit_price, notes')
      .eq('supplier_id', req.userId)
      .eq('variant_key', variantKey)
      .order('min_purchase_qty', { ascending: false });

    if (error) throw error;

    const levels = data || [];
    const matched = resolveBcovPriceForBuyerMetrics({
      levels,
      supplierCov,
      platformCov,
      brandCov
    });

    if (!matched) {
      return res.json({
        status: 'success',
        result: {
          matched: false,
          variantKey,
          supplierCov,
          platformCov,
          brandCov
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
        variantKey,
        variantName: matchedLevel?.variant_name || null,
        supplierCov,
        platformCov,
        brandCov,
        levelName: parsedNotes.levelName,
        buyerBcov: parsedNotes.buyerBcov,
        buyerCov: brandCovThreshold,
        buyerPcov: platformCovThreshold,
        supplierCovThreshold,
        platformCovThreshold,
        brandCovThreshold,
        appliedBy:
          supplierCovThreshold !== null && supplierCov >= supplierCovThreshold
            ? 'supplier'
            : brandCovThreshold !== null && brandCov >= brandCovThreshold
            ? 'brand'
            : 'platform',
        price: matched.price
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
