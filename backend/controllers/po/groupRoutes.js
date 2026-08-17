/** PO routes: group */
import {
  ADDRESS_REQUIRED_FIELDS,
  buildBcovResolver,
  buildProductIdentification,
  buildSupplierVariantIdentityFromPoItem,
  hasSupplierVariantSignals,
  resolveSupplierVariantKeyForItem,
  computeGroupWeightKg,
  extractBcovScopeKeys,
  extractBrandForBcov,
  firstNonEmpty,
  getAllowedSellerRoleForBrand,
  getContractErrorMessage,
  getOutletPickupMeta,
  isPoVendorSupplierUser,
  isSameUserId,
  getSupplierPickupMeta,
  isAddressComplete,
  loadAdminBrandTerminalRoleMap,
  mapToDeliveryAddress,
  normalizeAddress,
  parseWithSchema,
  pickEffectiveOfferPrice,
  lineMoneyTotal,
  parseMoney,
  poGroupRequestSchema,
  buildShippingAddressKey,
  buildTransportGroupId,
  consolidatePoTransportGroups,
  formatShippingAddressLabel,
  loadServiceProviderPoCartDraft,
  resolveB2bPaymentFromBody,
  resolveCheckoutShippingAddress,
  supplierMatchesBrandTerminalRole,
  assertGstStateInputs,
  assertSupplierProductTaxRates,
  buildOrderGstSummary,
  buildPoGroupsCheckoutSummary,
  computeLineGst,
  extractUserState,
  isSameIndianState,
  resolveCheckoutBillingAddress,
  resolveGstPlaceOfSupplyState,
  resolveSupplierStateForGst,
  roundMoney,
  sumGstLines
} from './poImports.js';
import { resolveSupplierOfferDisplayImages } from '../../services/productImageService.js';
import { BUYER_OWN_LISTING_PURCHASE_MESSAGE } from '../../services/catalogOfferSnapshotService.js';

export function registerPoGroupRoutes(ctx) {
  const {
    router,
    authenticateToken,
    isServiceProvider,
    supabase
  } = ctx;

router.post('/group', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(poGroupRequestSchema, req.body || {});
    const { selectedVendors, substitutions, items, defaultShippingAddress } = payload;
    const cartDraft = await loadServiceProviderPoCartDraft(supabase, req.userId);
    const fallbackShipping =
      resolveCheckoutShippingAddress({
        cartDraft,
        workflowItems: items,
        requestedAddress: defaultShippingAddress
      }) || null;
    const itemBrandCandidates = (items || [])
      .flatMap((item) => [
        item?.brand,
        item?.brandName,
        item?.brandModel,
        item?.specifications?.brand,
        item?.specifications?.brandModel
      ])
      .filter(Boolean);
    const terminalRoleByBrandMap = await loadAdminBrandTerminalRoleMap(supabase, itemBrandCandidates);

    const { data: serviceProvider } = await supabase
      .from('users')
      .select('id, address, profile')
      .eq('id', req.userId)
      .eq('user_type', 'service_provider')
      .maybeSingle();
    const profileAddress = normalizeAddress(serviceProvider?.address || {});
    const profileGstin = String(
      serviceProvider?.profile?.gstin || serviceProvider?.profile?.mainGstin || ''
    ).trim();
    const hasGstin = Boolean(profileGstin);
    const billingAddress = resolveCheckoutBillingAddress({
      serviceProvider,
      requestedBillingAddress: defaultShippingAddress,
      shippingAddress: fallbackShipping,
      hasGstin
    });
    const placeOfSupplyState = resolveGstPlaceOfSupplyState({
      hasGstin,
      deliveryDestination: 'shipping',
      billingAddress,
      shippingAddress: fallbackShipping || profileAddress
    });
    const supplierStateCache = new Map();
    const outletCache = new Map();
    const loadSupplierState = async (supplierId, supplierProduct = null) => {
      const key = String(supplierId || '').trim();
      if (!key) return '';
      if (supplierStateCache.has(key) && !supplierProduct?.outlet_id) {
        return supplierStateCache.get(key);
      }
      const { data: supplierRow } = await supabase
        .from('users')
        .select('address, profile')
        .eq('id', key)
        .maybeSingle();
      let outletRow = null;
      const outletId = String(supplierProduct?.outlet_id || '').trim();
      if (outletId) {
        if (outletCache.has(outletId)) {
          outletRow = outletCache.get(outletId);
        } else {
          const { data: outletData } = await supabase
            .from('outlets')
            .select('id, supplier_id, address')
            .eq('id', outletId)
            .eq('is_active', true)
            .maybeSingle();
          outletRow = outletData || null;
          outletCache.set(outletId, outletRow);
        }
      }
      const pickup = getSupplierPickupMeta(supplierRow || {});
      const state = resolveSupplierStateForGst({
        supplierUser: supplierRow || {},
        supplierProduct,
        outlet: outletRow,
        pickupAddress: pickup?.pickupAddress || null
      });
      supplierStateCache.set(key, state);
      return state;
    };
    
    if (!selectedVendors || typeof selectedVendors !== 'object') {
      return res.status(400).json({
        status: 'error',
        message: 'Selected vendors are required'
      });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Items are required'
      });
    }

    // Create a map of substitutions for quick lookup
    const substitutionMap = {};
    if (substitutions && Array.isArray(substitutions)) {
      substitutions.forEach(sub => {
        if (sub.originalItem && sub.suggestedItem) {
          substitutionMap[sub.originalItem] = sub.suggestedItem;
        }
      });
    }

    // Group items by selected vendor
    const vendorGroups = {};
    const resolveBcov = buildBcovResolver(supabase);
    
    for (const item of items) {
      const itemId = item.id?.toString();
      const productSelectionKey = item.productId ? String(item.productId) : null;
      const selectedTokenRaw =
        selectedVendors[itemId] ||
        (productSelectionKey ? selectedVendors[productSelectionKey] : null);
      const selectedToken = String(selectedTokenRaw || '').trim();
      
      if (!selectedToken) {
        continue; // Skip items without selected vendor
      }

      // Check if there's a substitution for this item
      const itemName = substitutionMap[item.normalizedName] || item.normalizedName || item.rawName;
      
      // Find the supplier-specific offer from supplier_products + products
      let supplierProduct = null;
      let vendorId = selectedToken;
      if (isSameUserId(req.userId, vendorId)) {
        return res.status(400).json({
          status: 'error',
          message: BUYER_OWN_LISTING_PURCHASE_MESSAGE
        });
      }
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selectedToken)) {
        const { data: spBySelectionId } = await supabase
          .from('supplier_products')
          .select(`
            *,
            product:products(*),
            supplier:users!supplier_products_supplier_id_fkey (id, name, company, profile)
          `)
          .eq('id', selectedToken)
          .maybeSingle();
        if (spBySelectionId?.supplier_id) {
          vendorId = spBySelectionId.supplier_id;
          if (isSameUserId(req.userId, vendorId)) {
            return res.status(400).json({
              status: 'error',
              message: BUYER_OWN_LISTING_PURCHASE_MESSAGE
            });
          }
          const offerStatus = String(spBySelectionId.status || '').toLowerCase();
          if (offerStatus === 'approved' || offerStatus === 'pending') {
            supplierProduct = spBySelectionId;
          }
        }
      }
      const itemSpecs = item.specifications || {};
      let parentProductForVariant = null;
      if (!supplierProduct && item.productId) {
        const { data: parentRow } = await supabase
          .from('products')
          .select('specifications')
          .eq('id', item.productId)
          .maybeSingle();
        parentProductForVariant = parentRow;
      }
      const requestedVariantIdentity = buildSupplierVariantIdentityFromPoItem(
        item,
        parentProductForVariant
      );
      const requestedVariantKey = resolveSupplierVariantKeyForItem(item, parentProductForVariant);
      const hasVariantSignals = hasSupplierVariantSignals(item, requestedVariantIdentity);

      // First try to find by productId if available (preferred: explicit catalog link)
      if (!supplierProduct && item.productId) {
        // 1) Prefer approved + active offers (current behaviour)
        let spByIdApprovedQuery = supabase
          .from('supplier_products')
          .select(`
            *,
            product:products(*),
            supplier:users!supplier_products_supplier_id_fkey (id, name, company, profile)
          `)
          .eq('product_id', item.productId)
          .eq('supplier_id', vendorId)
          .eq('is_active', true)
          .eq('status', 'approved')
          .order('created_at', { ascending: false })
          .limit(1);
        if (hasVariantSignals) {
          spByIdApprovedQuery = spByIdApprovedQuery.eq('variant_key', requestedVariantKey);
        }
        const { data: spByIdApproved } = await spByIdApprovedQuery.maybeSingle();
        
        if (spByIdApproved) {
          supplierProduct = spByIdApproved;
        } else {
          // 2) Fallback: allow pending offers so PO creation can work
          // even if admin approval hasn't happened yet.
          let spByIdAnyQuery = supabase
            .from('supplier_products')
            .select(`
              *,
              product:products(*),
              supplier:users!supplier_products_supplier_id_fkey (id, name, company, profile)
            `)
            .eq('product_id', item.productId)
            .eq('supplier_id', vendorId)
            .in('status', ['approved', 'pending'])
            // Prefer active offers, even if pending.
            .order('is_active', { ascending: false })
            .order('approved_at', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1);
          if (hasVariantSignals) {
            spByIdAnyQuery = spByIdAnyQuery.eq('variant_key', requestedVariantKey);
          }
          const { data: spByIdAny } = await spByIdAnyQuery.maybeSingle();

          if (spByIdAny) {
            supplierProduct = spByIdAny;
          }
        }
      }
      
      // If not found by productId, try by fuzzy product name for this supplier
      if (!supplierProduct) {
        // 1) Prefer approved + active
        let spByNameApprovedQuery = supabase
          .from('supplier_products')
          .select(`
            *,
            product:products(*),
            supplier:users!supplier_products_supplier_id_fkey (id, name, company, profile)
          `)
          .ilike('product.name', `%${itemName}%`)
          .eq('supplier_id', vendorId)
          .eq('is_active', true)
          .eq('status', 'approved')
          .order('created_at', { ascending: false })
          .limit(1);
        if (hasVariantSignals) {
          spByNameApprovedQuery = spByNameApprovedQuery.eq('variant_key', requestedVariantKey);
        }
        const { data: spByNameApproved } = await spByNameApprovedQuery;
        
        if (spByNameApproved && spByNameApproved.length > 0) {
          supplierProduct = spByNameApproved[0];
        } else {
          // 2) Fallback to pending offers
          let spByNameAnyQuery = supabase
            .from('supplier_products')
            .select(`
              *,
              product:products(*),
              supplier:users!supplier_products_supplier_id_fkey (id, name, company, profile)
            `)
            .ilike('product.name', `%${itemName}%`)
            .eq('supplier_id', vendorId)
            .in('status', ['approved', 'pending'])
            .order('is_active', { ascending: false })
            .order('approved_at', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(1);
          if (hasVariantSignals) {
            spByNameAnyQuery = spByNameAnyQuery.eq('variant_key', requestedVariantKey);
          }
          const { data: spByNameAny } = await spByNameAnyQuery;

          if (spByNameAny && spByNameAny.length > 0) {
            supplierProduct = spByNameAny[0];
          }
        }
      }
      
      // If still not found, log and skip this item
      if (!supplierProduct) {
        console.warn(`Supplier product for "${itemName}" not found for supplier ${vendorId}. Skipping item.`);
        continue;
      }

      const product = supplierProduct.product;
      const supplier = supplierProduct.supplier;
      if (
        isSameUserId(req.userId, vendorId) ||
        isSameUserId(req.userId, supplierProduct?.supplier_id) ||
        isSameUserId(req.userId, supplier?.id)
      ) {
        return res.status(400).json({
          status: 'error',
          message: BUYER_OWN_LISTING_PURCHASE_MESSAGE
        });
      }
      let sellerProfile = supplier?.profile;
      if ((sellerProfile === undefined || sellerProfile === null) && vendorId) {
        const { data: sellerRow } = await supabase
          .from('users')
          .select('profile, user_type')
          .eq('id', vendorId)
          .maybeSingle();
        sellerProfile = isPoVendorSupplierUser(sellerRow) ? sellerRow?.profile ?? null : null;
      }
      const selectedBrandName =
        supplierProduct?.attributes?.brand ||
        supplierProduct?.attributes?.brandModel ||
        product?.brand ||
        product?.specifications?.brand ||
        product?.specifications?.brandModel ||
        item?.brandModel ||
        item?.brandName ||
        item?.brand ||
        null;
      const requiredRoleForSelection = getAllowedSellerRoleForBrand(selectedBrandName, terminalRoleByBrandMap);
      if (requiredRoleForSelection && !supplierMatchesBrandTerminalRole(sellerProfile, selectedBrandName, terminalRoleByBrandMap)) {
        const requiredRoleText = requiredRoleForSelection || 'not configured (admin must define brand chain)';
        return res.status(403).json({
          status: 'error',
          message:
            `Purchase is only allowed from the terminal role in this brand's supply chain. Required seller role: ${requiredRoleText}.`
        });
      }

      const supplierName = supplier?.name || supplier?.company || 'Unknown Supplier';

      const itemShipping =
        item.shippingAddress && typeof item.shippingAddress === 'object'
          ? normalizeAddress(item.shippingAddress)
          : fallbackShipping;
      const shippingAddressKey = buildShippingAddressKey(itemShipping || {});
      const transportGroupId = buildTransportGroupId(vendorId, itemShipping || {});

      if (!vendorGroups[transportGroupId]) {
        vendorGroups[transportGroupId] = {
          vendorId,
          transportGroupId,
          shippingAddressKey,
          shippingAddress: itemShipping || null,
          shippingAddressLabel: itemShipping ? formatShippingAddressLabel(itemShipping) : '',
          vendorName: supplierName,
          items: [],
          total: 0,
          lineTaxBreakdown: [],
          outletIds: new Set()
        };
      }
      if (supplierProduct.outlet_id) {
        vendorGroups[transportGroupId].outletIds.add(supplierProduct.outlet_id);
      }

      const quantity = parseFloat(item.quantity) || 0;
      const basePrice = parseMoney(supplierProduct.price);
      const bcovVariantKey = supplierProduct?.variant_key || item?.variantKey || '';
      const bcovBrandKey = extractBrandForBcov({ supplierProduct, item });
      const bcovScopeKeys = extractBcovScopeKeys({ supplierProduct, item });
      const bcovResolved = await resolveBcov({
        buyerId: req.userId,
        supplierId: vendorId,
        variantKey: bcovVariantKey,
        brandKey: bcovBrandKey,
        scopeKeys: bcovScopeKeys
      });
      const picked = pickEffectiveOfferPrice(basePrice, bcovResolved);
      const price = picked.price;
      const itemTotal = lineMoneyTotal(price, quantity);
      const attrs = supplierProduct?.attributes || {};
      const specs = supplierProduct?.product?.specifications || {};
      const productImages = resolveSupplierOfferDisplayImages(attrs.images, []);
      const productIdentification = buildProductIdentification({
        skuNo: firstNonEmpty(specs.skuNo, specs.sku, specs.SKU, specs.gsku, specs.GSKU),
        modelBrand: firstNonEmpty(attrs.brandModel, specs.modelBrand, specs.brandModel, specs.brand)
      });
      const supplierSpecs =
        attrs?.specifications && typeof attrs.specifications === 'object' && !Array.isArray(attrs.specifications)
          ? attrs.specifications
          : {};
      const productSpecs = specs && typeof specs === 'object' && !Array.isArray(specs) ? specs : {};
      // Catalog/admin product specs win over stale offer attribute copies.
      const mergedSpecifications = {
        ...supplierSpecs,
        ...productSpecs
      };

      vendorGroups[transportGroupId].total = roundMoney(
        vendorGroups[transportGroupId].total + itemTotal
      );

      let lineGst = null;
      if (placeOfSupplyState) {
        try {
          const supplierState = await loadSupplierState(vendorId, supplierProduct);
          assertGstStateInputs({
            supplierState,
            billingState: placeOfSupplyState,
            context: 'PO group GST preview'
          });
          assertSupplierProductTaxRates({
            supplierProduct,
            context: 'PO group GST preview',
            productRef: supplierProduct?.product?.name || itemName
          });
          const intraStateTax = isSameIndianState(supplierState, placeOfSupplyState);
          lineGst = computeLineGst({
            taxableAmount: itemTotal,
            intraState: intraStateTax,
            supplierProduct
          });
          vendorGroups[transportGroupId].lineTaxBreakdown.push(lineGst);
          if (!vendorGroups[transportGroupId].supplierState) {
            vendorGroups[transportGroupId].supplierState = supplierState;
          }
        } catch (gstPreviewError) {
          // Grouping still succeeds; create route will enforce tax before order insert.
          console.warn('[PO group] GST preview skipped for line:', gstPreviewError?.message || gstPreviewError);
        }
      }

      vendorGroups[transportGroupId].items.push({
        name: itemName,
        quantity: quantity,
        price: price,
        unit: product.unit || 'nos',
        productId: product.id,
        supplierProductId: supplierProduct.id,
        asin: product.asin || null,
        variantKey: supplierProduct.variant_key || null,
        variantAsin: supplierProduct.variant_asin || null,
        bcovApplied: picked.bcovApplied,
        bcovLevelId: picked.bcovLevelId,
        basePrice: picked.basePrice,
        productIdentification: productIdentification || null,
        specifications: mergedSpecifications,
        images: productImages,
        productImage: productImages[0] || null,
        originalItem: item.normalizedName || item.rawName,
        lineSubtotal: roundMoney(itemTotal),
        lineGst,
        lineTotalInclGst: lineGst ? roundMoney(lineGst.totalAmount) : roundMoney(itemTotal)
      });
    }

    const supplierIdsForPins = [
      ...new Set(Object.values(vendorGroups).map((group) => group.vendorId).filter(Boolean))
    ];
    const pickupMetaBySupplierId = {};
    if (supplierIdsForPins.length > 0) {
      const { data: pinRows } = await supabase
        .from('users')
        .select('id, address, profile')
        .in('id', supplierIdsForPins)
        .eq('user_type', 'supplier');
      for (const row of pinRows || []) {
        pickupMetaBySupplierId[row.id] = getSupplierPickupMeta(row);
      }

      const singleOutletIdByVendor = {};
      for (const group of Object.values(vendorGroups)) {
        const vid = group.vendorId;
        const ids = [...(group.outletIds || new Set())].filter(Boolean);
        if (ids.length === 1) singleOutletIdByVendor[vid] = ids[0];
      }
      const outletIdsToLoad = [...new Set(Object.values(singleOutletIdByVendor))];
      const outletById = {};
      if (outletIdsToLoad.length > 0) {
        const { data: outletRows } = await supabase
          .from('outlets')
          .select('id, supplier_id, name, address')
          .in('id', outletIdsToLoad)
          .eq('is_active', true);
        for (const o of outletRows || []) {
          outletById[o.id] = o;
        }
      }
      for (const vid of supplierIdsForPins) {
        const oid = singleOutletIdByVendor[vid];
        if (!oid) continue;
        const outlet = outletById[oid];
        if (!outlet || String(outlet.supplier_id) !== String(vid)) continue;
        const om = getOutletPickupMeta(outlet);
        if (om.pincode) pickupMetaBySupplierId[vid] = om;
      }
    }

    // Convert to array format
    const groups = Object.values(vendorGroups).map((group) => {
      const pickup = pickupMetaBySupplierId[group.vendorId] || {
        pincode: '',
        summary: '',
        pickupAddress: { line1: '', city: '', state: '', country: '', pincode: '' },
        outletId: null,
        outletName: null
      };
      const mrpTotal = roundMoney(group.total);
      const gstSummary = buildOrderGstSummary({
        lineTaxBreakdown: group.lineTaxBreakdown || [],
        supplierState: group.supplierState || '',
        billingState: billingAddress?.state || placeOfSupplyState,
        placeOfSupplyState,
        intraStateTax: isSameIndianState(group.supplierState, placeOfSupplyState)
      });
      const gstAmount = roundMoney(gstSummary.taxAmount || 0);
      const totalInclGst =
        gstSummary.totalAmount > 0 ? roundMoney(gstSummary.totalAmount) : mrpTotal;
      const taxableSubtotal =
        gstSummary.subtotalAmount > 0 ? roundMoney(gstSummary.subtotalAmount) : mrpTotal;
      return {
        vendorId: group.vendorId,
        transportGroupId: group.transportGroupId,
        shippingAddressKey: group.shippingAddressKey,
        shippingAddress: group.shippingAddress || null,
        shippingAddressLabel: group.shippingAddressLabel || '',
        vendorName: group.vendorName,
        subtotal: mrpTotal,
        taxableSubtotal,
        gstAmount,
        totalInclGst,
        total: mrpTotal,
        gstSummary:
          gstSummary.totalAmount > 0
            ? { ...gstSummary, priceIncludesGst: true }
            : null,
        pickupPincode: pickup.pincode || '',
        pickupAddressSummary: pickup.summary || '',
        pickupAddress: pickup.pickupAddress || null,
        pickupOutletId: pickup.outletId || null,
        pickupOutletName: pickup.outletName || null,
        items: group.items
      };
    });

    const consolidatedGroups = consolidatePoTransportGroups(groups);

    // If no groups were created, return empty array
    if (consolidatedGroups.length === 0) {
      return res.json({ 
        groups: [],
        checkoutSummary: buildPoGroupsCheckoutSummary([]),
        message: 'No items with selected vendors found'
      });
    }

    res.json({
      groups: consolidatedGroups,
      checkoutSummary: buildPoGroupsCheckoutSummary(consolidatedGroups)
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('PO grouping error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to group purchase orders',
      error: error.message
    });
  }
});
}

/** Avoid user-supplied % / _ widening ILIKE matches unintentionally. */
function sanitizeIlikeFragment(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  return s.replace(/%/g, '').replace(/_/g, ' ').trim();
}

/**
 * Resolve supplier_products for PO insert — mirrors /api/po/group so a line that grouped
 * successfully will not fail at create (e.g. pending offers, same variant/product lookups).
 */
export async function loadSupplierProductForPoCreate(supabase, supplierId, item) {
  const select = `
    *,
    product:products(*)
  `;

  if (item?.supplierProductId) {
    const { data: byOfferId } = await supabase
      .from('supplier_products')
      .select(select)
      .eq('id', item.supplierProductId)
      .eq('supplier_id', supplierId)
      .in('status', ['approved', 'pending'])
      .maybeSingle();
    if (byOfferId?.product) return byOfferId;
  }

  const itemSpecs = item?.specifications || {};
  const specsObj =
    itemSpecs && typeof itemSpecs === 'object' && !Array.isArray(itemSpecs) ? itemSpecs : {};
  let parentProductForVariant = null;
  if (item?.productId) {
    const { data: parentRow } = await supabase
      .from('products')
      .select('specifications')
      .eq('id', item.productId)
      .maybeSingle();
    parentProductForVariant = parentRow;
  }
  const requestedVariantIdentity = buildSupplierVariantIdentityFromPoItem(item, parentProductForVariant);
  const requestedVariantKey = resolveSupplierVariantKeyForItem(item, parentProductForVariant);
  const hasVariantSignals = hasSupplierVariantSignals(item, requestedVariantIdentity);

  if (item?.productId) {
    let qApproved = supabase
      .from('supplier_products')
      .select(select)
      .eq('product_id', item.productId)
      .eq('supplier_id', supplierId)
      .eq('is_active', true)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(1);
    if (hasVariantSignals) {
      qApproved = qApproved.eq('variant_key', requestedVariantKey);
    }
    const { data: spApproved } = await qApproved.maybeSingle();
    if (spApproved?.product) return spApproved;

    let qAny = supabase
      .from('supplier_products')
      .select(select)
      .eq('product_id', item.productId)
      .eq('supplier_id', supplierId)
      .in('status', ['approved', 'pending'])
      .order('is_active', { ascending: false })
      .order('approved_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    if (hasVariantSignals) {
      qAny = qAny.eq('variant_key', requestedVariantKey);
    }
    const { data: spAny } = await qAny.maybeSingle();
    if (spAny?.product) return spAny;
  }

  const nameCandidates = [];
  const pushName = (v) => {
    const s = sanitizeIlikeFragment(v);
    if (s && !nameCandidates.includes(s)) nameCandidates.push(s);
  };
  pushName(item?.name);
  pushName(item?.originalItem);
  pushName(specsObj.brandModel);
  pushName(item?.brandModel);
  pushName(item?.modelBrand);

  for (const token of nameCandidates) {
    let qNameApproved = supabase
      .from('supplier_products')
      .select(select)
      .ilike('product.name', `%${token}%`)
      .eq('supplier_id', supplierId)
      .eq('is_active', true)
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(1);
    if (hasVariantSignals) {
      qNameApproved = qNameApproved.eq('variant_key', requestedVariantKey);
    }
    const { data: rowsApproved } = await qNameApproved;
    if (rowsApproved?.[0]?.product) return rowsApproved[0];

    let qNameAny = supabase
      .from('supplier_products')
      .select(select)
      .ilike('product.name', `%${token}%`)
      .eq('supplier_id', supplierId)
      .in('status', ['approved', 'pending'])
      .order('is_active', { ascending: false })
      .order('approved_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1);
    if (hasVariantSignals) {
      qNameAny = qNameAny.eq('variant_key', requestedVariantKey);
    }
    const { data: rowsAny } = await qNameAny;
    if (rowsAny?.[0]?.product) return rowsAny[0];
  }

  return null;
}
