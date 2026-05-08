import express from 'express';
import {
  requireAuthentication as authenticateToken,
  requireServiceProvider as isServiceProvider
} from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import { recordInventoryMovement } from '../services/inventoryService.js';
import { buildIdentityBundle } from '../services/productIdentityService.js';
import {
  getAllowedSellerRoleForBrand,
  loadAdminBrandTerminalRoleMap,
  supplierMatchesBrandTerminalRole
} from '../utils/adminBrandSupplyChain.js';
import {
  buildBcovResolver,
  buildProductIdentification,
  extractBcovScopeKeys,
  extractBrandForBcov,
  firstNonEmpty,
  parseFiniteNumber
} from '../services/procurementSharedService.js';
import { insertNotification } from '../repositories/notificationsRepository.js';
import {
  assertGstStateInputs,
  assertSupplierProductTaxRates,
  computeLineGst,
  extractUserState,
  isSameIndianState,
  sumGstLines
} from '../services/gstService.js';
import {
  canRateSupplierForOrder,
  canSelfServeCancelOrder,
  canSelfServeEditOrder
} from '../utils/orderSelfServeRules.js';
import { toLifecycleStateFromStatus } from '../utils/orderLifecycle.js';
import logger from '../utils/logger.js';
import {
  poCancelSchema,
  poCartSaveSchema,
  poCreateRequestSchema,
  poGroupRequestSchema,
  poRatingSchema,
  poSelfServePatchSchema
} from '../contracts/poContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import { randomUUID } from 'node:crypto';

const LEGACY_PO_CART_GROUP_PREFIX = 'legacy';

function newPoCartGroupId() {
  try {
    return randomUUID();
  } catch {
    return `g-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }
}

function normalizePoCartDraft(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      selectedVendors: {},
      substitutions: [],
      items: [],
      boqGroups: [],
      boqId: null,
      boqProject: null,
      requiredDate: null,
      paymentMethod: null,
      deliveryDestination: null,
      shippingAddress: null,
      billingAddress: null,
      gstin: null
    };
  }
  const hasGroups = Array.isArray(raw.boqGroups) && raw.boqGroups.length > 0;
  if (hasGroups) {
    const items = raw.boqGroups.flatMap((g) => (Array.isArray(g?.items) ? g.items : []));
    const mergedSelected = { ...(raw.selectedVendors || {}) };
    raw.boqGroups.forEach((g) => {
      if (g?.selectedVendors && typeof g.selectedVendors === 'object') {
        Object.assign(mergedSelected, g.selectedVendors);
      }
    });
    return {
      ...raw,
      boqGroups: raw.boqGroups,
      items,
      selectedVendors: mergedSelected
    };
  }
  const items = Array.isArray(raw.items) ? raw.items : [];
  if (items.length === 0) {
    return { ...raw, boqGroups: [], items: [] };
  }
  const groupId = raw.boqId ? `${LEGACY_PO_CART_GROUP_PREFIX}-${raw.boqId}` : newPoCartGroupId();
  return {
    ...raw,
    boqGroups: [
      {
        groupId,
        boqId: raw.boqId ?? null,
        boqName: null,
        boqProject: raw.boqProject ?? null,
        items: items.map((it) => ({ ...it })),
        selectedVendors: { ...(raw.selectedVendors || {}) },
        substitutions: Array.isArray(raw.substitutions) ? [...raw.substitutions] : []
      }
    ],
    items
  };
}

function buildPoCartDraftFromSavePayload(payload) {
  let boqGroups = Array.isArray(payload.boqGroups) ? payload.boqGroups.map((g) => ({ ...g })) : [];
  if (boqGroups.length === 0) {
    const gid = payload.boqId ? `${LEGACY_PO_CART_GROUP_PREFIX}-${payload.boqId}` : newPoCartGroupId();
    boqGroups = [
      {
        groupId: gid,
        boqId: payload.boqId ?? null,
        boqName: null,
        boqProject: payload.boqProject ?? null,
        items: [...(payload.items || [])],
        selectedVendors: { ...(payload.selectedVendors || {}) },
        substitutions: [...(payload.substitutions || [])]
      }
    ];
  }
  const flatItems = boqGroups.flatMap((g) => (Array.isArray(g.items) ? g.items : []));
  const mergedSelected = { ...(payload.selectedVendors || {}) };
  boqGroups.forEach((g) => {
    if (g?.selectedVendors && typeof g.selectedVendors === 'object') {
      Object.assign(mergedSelected, g.selectedVendors);
    }
  });
  return {
    selectedVendors: mergedSelected,
    substitutions: payload.substitutions || [],
    items: flatItems,
    boqGroups,
    boqId: boqGroups[0]?.boqId ?? null,
    boqProject: boqGroups[0]?.boqProject ?? null,
    requiredDate: payload.requiredDate ?? null,
    paymentMethod: payload.paymentMethod ?? null,
    deliveryDestination: payload.deliveryDestination ?? null,
    shippingAddress: payload.shippingAddress ?? null,
    billingAddress: payload.billingAddress ?? null,
    gstin: payload.gstin ?? null
  };
}

const router = express.Router();
const ORDER_INSERT_MAX_RETRIES = 3;
const ADDRESS_REQUIRED_FIELDS = ['line1', 'city', 'state', 'pincode', 'country'];
const MAX_CART_ITEM_QUANTITY = 1000000000;

const isOrderNumberConflictError = (error) => {
  if (!error) return false;
  if (error.code === '23505') {
    const details = String(error.details || '').toLowerCase();
    const message = String(error.message || '').toLowerCase();
    return details.includes('order_number') || message.includes('order_number');
  }
  return false;
};

const PAYMENT_METHODS_ALLOWED = new Set(['cash', 'bank_transfer', 'cheque', 'online', 'credit', 'upi', 'card']);

async function findServiceProviderOrderByIdentifier(orderIdentifier, serviceProviderId) {
  let { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('order_number', orderIdentifier)
    .eq('service_provider_id', serviceProviderId)
    .maybeSingle();

  if (!order) {
    const { data: orderById, error: orderByIdError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderIdentifier)
      .eq('service_provider_id', serviceProviderId)
      .maybeSingle();
    if (!orderByIdError && orderById) {
      order = orderById;
      orderError = null;
    }
  }
  return { order, orderError };
}

async function restockInventoryForCancelledOrder({ orderId, actorUserId }) {
  if (!orderId) return { ok: false, reason: 'missing_order_id' };

  const { data: existingRestock } = await supabase
    .from('inventory_movements')
    .select('id')
    .eq('reference_order_id', orderId)
    .eq('movement_type', 'adjustment')
    .ilike('notes', '%cancel_restock%')
    .limit(1);
  if (existingRestock && existingRestock.length > 0) {
    return { ok: true, already: true };
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, supplier_id, status')
    .eq('id', orderId)
    .maybeSingle();
  if (!order) return { ok: false, reason: 'order_not_found' };
  if (String(order.status || '').toLowerCase() !== 'cancelled') return { ok: true, skipped: true };

  const { data: items } = await supabase
    .from('order_items')
    .select('id, product_id, supplier_product_id, quantity')
    .eq('order_id', orderId);

  for (const it of items || []) {
    const qty = parseFloat(it.quantity || 0) || 0;
    if (!qty || qty <= 0 || !it.supplier_product_id) continue;
    await recordInventoryMovement({
      supplierProductId: it.supplier_product_id,
      supplierId: order.supplier_id,
      productId: it.product_id,
      quantityChange: Math.round(qty),
      movementType: 'adjustment',
      referenceOrderId: orderId,
      referenceOrderItemId: it.id,
      notes: 'cancel_restock: inventory added back due to order cancellation',
      userId: actorUserId
    });
  }

  return { ok: true, already: false };
}

async function cancelOrderWithAtomicRestock({ orderId, actorUserId, cancelReason }) {
  const { data, error } = await supabase.rpc('cancel_order_with_restock_atomic', {
    p_order_id: orderId,
    p_actor_user_id: actorUserId,
    p_cancel_reason: cancelReason || null
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

router.post('/group', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(poGroupRequestSchema, req.body || {});
    const { selectedVendors, substitutions, items } = payload;
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
      const vendorId =
        selectedVendors[itemId] ||
        (productSelectionKey ? selectedVendors[productSelectionKey] : null);
      
      if (!vendorId) {
        continue; // Skip items without selected vendor
      }

      // Check if there's a substitution for this item
      const itemName = substitutionMap[item.normalizedName] || item.normalizedName || item.rawName;
      
      // Find the supplier-specific offer from supplier_products + products
      let supplierProduct = null;
      const itemSpecs = item.specifications || {};
      const requestedVariantIdentity = buildIdentityBundle({
        unit: item.unit,
        brandModel: item.brandModel || item.modelBrand,
        sku: item.sku || item.skuNo || item.gsku || itemSpecs.sku || itemSpecs.skuNo || itemSpecs.gsku,
        packSize: item.packSize || item.pack_size || itemSpecs.packSize || itemSpecs.pack_size,
        specifications: itemSpecs
      });
      const hasVariantSignals =
        requestedVariantIdentity.matchSignals.hasSku ||
        Boolean(requestedVariantIdentity.variant.brandModel) ||
        Boolean(requestedVariantIdentity.variant.packSize);
      
      // First try to find by productId if available (preferred: explicit catalog link)
      if (item.productId) {
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
          spByIdApprovedQuery = spByIdApprovedQuery.eq('variant_key', requestedVariantIdentity.variantKey);
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
            spByIdAnyQuery = spByIdAnyQuery.eq('variant_key', requestedVariantIdentity.variantKey);
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
          spByNameApprovedQuery = spByNameApprovedQuery.eq('variant_key', requestedVariantIdentity.variantKey);
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
            spByNameAnyQuery = spByNameAnyQuery.eq('variant_key', requestedVariantIdentity.variantKey);
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
      let sellerProfile = supplier?.profile;
      if ((sellerProfile === undefined || sellerProfile === null) && vendorId) {
        const { data: sellerRow } = await supabase
          .from('users')
          .select('profile')
          .eq('id', vendorId)
          .eq('user_type', 'supplier')
          .maybeSingle();
        sellerProfile = sellerRow?.profile ?? null;
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
      
      if (!vendorGroups[vendorId]) {
        vendorGroups[vendorId] = {
          vendorId: vendorId,
          vendorName: supplierName,
          items: [],
          total: 0
        };
      }

      const quantity = parseFloat(item.quantity) || 0;
      // Use supplier-specific price from supplier_products as the authoritative price
      const basePrice = parseFloat(supplierProduct.price) || 0;
      const bcovBrandKey = extractBrandForBcov({ supplierProduct, item });
      const bcovScopeKeys = extractBcovScopeKeys({ supplierProduct, item });
      const bcovResolved = await resolveBcov({
        buyerId: req.userId,
        supplierId: vendorId,
        brandKey: bcovBrandKey,
        scopeKeys: bcovScopeKeys
      });
      const price = bcovResolved?.price ?? basePrice;
      const itemTotal = quantity * price;
      const attrs = supplierProduct?.attributes || {};
      const specs = supplierProduct?.product?.specifications || {};
      const productImages = Array.isArray(attrs.images) && attrs.images.length > 0
        ? attrs.images.filter(Boolean)
        : (Array.isArray(supplierProduct?.product?.images) ? supplierProduct.product.images.filter(Boolean) : []);
      const productIdentification = buildProductIdentification({
        skuNo: firstNonEmpty(specs.skuNo, specs.sku, specs.SKU, specs.gsku, specs.GSKU),
        modelBrand: firstNonEmpty(attrs.brandModel, specs.modelBrand, specs.brandModel, specs.brand)
      });

      vendorGroups[vendorId].items.push({
        name: itemName,
        quantity: quantity,
        price: price,
        unit: product.unit || 'nos',
        productId: product.id,
        // Used to show supplier-specific tracking info (brandModel)
        // and to set order_items.supplier_product_id for later enrichment in dashboard.js.
        supplierProductId: supplierProduct.id,
        bcovApplied: !!bcovResolved,
        bcovLevelId: bcovResolved?.levelId || null,
        basePrice,
        productIdentification: productIdentification || null,
        images: productImages,
        productImage: productImages[0] || null,
        originalItem: item.normalizedName || item.rawName
      });

      vendorGroups[vendorId].total += itemTotal;
    }

    // Convert to array format
    const groups = Object.values(vendorGroups).map(group => ({
      vendorId: group.vendorId,
      vendorName: group.vendorName,
      total: Math.round(group.total * 100) / 100,
      items: group.items
    }));

    // If no groups were created, return empty array
    if (groups.length === 0) {
      return res.json({ 
        groups: [],
        message: 'No items with selected vendors found'
      });
    }

    res.json({ groups });
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

/** Map service-provider PO checkout choice to DB columns (aligns with POS / invoices). */
function resolveB2bPaymentFromBody(body) {
  const raw = String(body?.paymentMethod || body?.payment_method || 'online')
    .toLowerCase()
    .trim();
  const allowed = new Set(['cod', 'online', 'bank_transfer', 'credit']);
  const choice = allowed.has(raw) ? raw : 'online';
  if (choice === 'cod') {
    return { payment_method: 'cash', payment_status: 'pending' };
  }
  if (choice === 'bank_transfer') {
    return { payment_method: 'bank_transfer', payment_status: 'pending' };
  }
  if (choice === 'credit') {
    return { payment_method: 'credit', payment_status: 'pending' };
  }
  return { payment_method: 'online', payment_status: 'pending' };
}

function normalizeAddress(address = {}) {
  return {
    line1: String(address?.line1 || address?.street || '').trim(),
    city: String(address?.city || '').trim(),
    state: String(address?.state || '').trim(),
    pincode: String(address?.pincode || address?.zipCode || '').trim(),
    country: String(address?.country || '').trim()
  };
}

function isAddressComplete(address = {}) {
  return ADDRESS_REQUIRED_FIELDS.every((field) => String(address?.[field] || '').trim());
}

function mapToDeliveryAddress(address = {}) {
  return {
    street: address.line1,
    city: address.city,
    state: address.state,
    zipCode: address.pincode,
    country: address.country
  };
}

router.post('/create', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(poCreateRequestSchema, req.body || {});
    const { poGroups, boqId, requiredDate } = payload;
    const itemBrandCandidates = (poGroups || [])
      .flatMap((group) => (Array.isArray(group?.items) ? group.items : []))
      .flatMap((item) => [
        item?.brand,
        item?.brandName,
        item?.brandModel,
        item?.specifications?.brand,
        item?.specifications?.brandModel
      ])
      .filter(Boolean);
    const terminalRoleByBrandMap = await loadAdminBrandTerminalRoleMap(supabase, itemBrandCandidates);
    const { payment_method: poPaymentMethod, payment_status: poPaymentStatus } =
      resolveB2bPaymentFromBody(payload);
    const requestedShippingAddress = normalizeAddress(payload.shippingAddress || {});
    const requestedBillingAddress = normalizeAddress(payload.billingAddress || {});
    const rawDeliveryDestination = String(payload.deliveryDestination || 'shipping').toLowerCase().trim();
    
    // Validate poGroups
    if (!poGroups) {
      return res.status(400).json({
        status: 'error',
        message: 'PO groups are required. Please ensure you have selected suppliers for your items and try again.'
      });
    }

    if (!Array.isArray(poGroups)) {
      return res.status(400).json({
        status: 'error',
        message: 'PO groups must be an array. Please refresh the page and try again.'
      });
    }

    if (poGroups.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No purchase order groups found. This might happen if:\n- No suppliers were selected for the items\n- The selected suppliers don\'t have matching products in the database\n- Items could not be matched to supplier products\n\nPlease go back and ensure all items have selected suppliers with matching products.'
      });
    }

    // Verify BOQ exists and belongs to the service provider
    let boq = null;
    if (boqId) {
      const { data: boqData, error: boqError } = await supabase
        .from('boqs')
        .select('*')
        .eq('id', boqId)
        .eq('service_provider_id', req.userId)
        .single();
      
      if (boqError || !boqData) {
        return res.status(404).json({
          status: 'error',
          message: 'BOQ not found or access denied'
        });
      }
      boq = boqData;
    }

    const { data: serviceProvider, error: serviceProviderError } = await supabase
      .from('users')
      .select('id, address, profile')
      .eq('id', req.userId)
      .eq('user_type', 'service_provider')
      .maybeSingle();
    if (serviceProviderError || !serviceProvider) {
      return res.status(404).json({
        status: 'error',
        message: 'Service provider profile not found'
      });
    }

    const profileAddress = normalizeAddress(serviceProvider.address || {});
    const profileGstin = String(
      serviceProvider?.profile?.gstin ||
      serviceProvider?.profile?.mainGstin ||
      ''
    ).trim();
    const hasGstin = Boolean(profileGstin);
    const shippingAddress = isAddressComplete(requestedShippingAddress)
      ? requestedShippingAddress
      : profileAddress;
    const billingAddress = hasGstin
      ? (isAddressComplete(requestedBillingAddress) ? requestedBillingAddress : shippingAddress)
      : shippingAddress;
    const deliveryDestination = hasGstin && rawDeliveryDestination === 'billing'
      ? 'billing'
      : 'shipping';
    const selectedDeliveryAddress = deliveryDestination === 'billing'
      ? billingAddress
      : shippingAddress;

    if (!isAddressComplete(shippingAddress)) {
      return res.status(400).json({
        status: 'error',
        message: 'Shipping address is incomplete. Please update your profile address or provide shipping address in PO.'
      });
    }
    if (hasGstin && !isAddressComplete(billingAddress)) {
      return res.status(400).json({
        status: 'error',
        message: 'Billing address is required when GSTIN is present.'
      });
    }

    const createdOrders = [];
    const resolveBcov = buildBcovResolver(supabase);

    // Parse required date (if provided) into ISO string for expected_delivery_date
    let expectedDeliveryDate = null;
    if (requiredDate) {
      const parsed = new Date(requiredDate);
      if (!isNaN(parsed.getTime())) {
        expectedDeliveryDate = parsed.toISOString();
      } else {
        logger.warn('Invalid requiredDate provided to /api/po/create:', requiredDate);
      }
    }

    // Create an Order document for each PO group
    for (const group of poGroups) {
      // Find supplier by vendorId
      if (!group.vendorId) {
        logger.warn('Missing vendorId in PO group:', group);
        return res.status(400).json({
          status: 'error',
          message: `Missing supplier ID for vendor "${group.vendorName}". Cannot create order.`
        });
      }

      // Validate and find supplier by ID
      const { data: supplier, error: supplierError } = await supabase
        .from('users')
        .select('*')
        .eq('id', group.vendorId)
        .eq('user_type', 'supplier')
        .single();

      if (supplierError || !supplier) {
        logger.warn(`Supplier not found with ID: ${group.vendorId}`);
        return res.status(404).json({
          status: 'error',
          message: `Supplier not found for vendor "${group.vendorName}". Please ensure the supplier exists in the system.`
        });
      }

      const firstGroupItem = Array.isArray(group.items) ? group.items[0] : null;
      const groupBrandName =
        firstGroupItem?.brand ||
        firstGroupItem?.brandModel ||
        firstGroupItem?.brandName ||
        firstGroupItem?.specifications?.brand ||
        firstGroupItem?.specifications?.brandModel ||
        null;
      const requiredRoleForGroup = getAllowedSellerRoleForBrand(groupBrandName, terminalRoleByBrandMap);
      if (requiredRoleForGroup && !supplierMatchesBrandTerminalRole(supplier.profile, groupBrandName, terminalRoleByBrandMap)) {
        const requiredRole = requiredRoleForGroup;
        const requiredRoleText = requiredRole || 'not configured (admin must define brand chain)';
        return res.status(403).json({
          status: 'error',
          message: `Vendor "${group.vendorName}" does not match the terminal role for this brand. Required seller role: ${requiredRoleText}.`
        });
      }

      // Map items to order items format - ONLY use real products from suppliers
      const orderItems = [];
      const lineTaxBreakdown = [];
      const supplierState = extractUserState(supplier);
      const billingState = billingAddress?.state || shippingAddress?.state || '';
      assertGstStateInputs({
        supplierState,
        billingState,
        context: 'Order GST calculation'
      });
      const intraStateTax = isSameIndianState(supplierState, billingState);
      
      for (const item of group.items) {
        // First try to find supplier-specific product by productId if available
        let supplierProduct = null;
        if (item.supplierProductId) {
          const { data: spById } = await supabase
            .from('supplier_products')
            .select(`
              *,
              product:products(*)
            `)
            .eq('id', item.supplierProductId)
            .eq('supplier_id', supplier.id)
            .eq('is_active', true)
            .eq('status', 'approved')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (spById) {
            supplierProduct = spById;
          }
        } else if (item.productId) {
          const { data: spById } = await supabase
            .from('supplier_products')
            .select(`
              *,
              product:products(*)
            `)
            .eq('product_id', item.productId)
            .eq('supplier_id', supplier.id)
            .eq('is_active', true)
            .eq('status', 'approved')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          
          if (spById) {
            supplierProduct = spById;
          }
        }
        
        // If not found by ID, try to find supplier-specific product by name
        if (!supplierProduct) {
          const { data: spByName } = await supabase
            .from('supplier_products')
            .select(`
              *,
              product:products(*)
            `)
            .ilike('product.name', `%${item.name}%`)
            .eq('supplier_id', supplier.id)
            .eq('status', 'approved')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1);
          
          if (spByName && spByName.length > 0) {
            supplierProduct = spByName[0];
          }
        }
        
        // If supplier-specific product still not found, throw error
        if (!supplierProduct || !supplierProduct.product) {
          throw new Error(`Supplier product "${item.name}" not found for supplier "${group.vendorName}". Please ensure the supplier has added this product in their manage your product section.`);
        }
        const itemBrandName =
          supplierProduct?.attributes?.brand ||
          supplierProduct?.attributes?.brandModel ||
          supplierProduct?.product?.brand ||
          supplierProduct?.product?.specifications?.brand ||
          supplierProduct?.product?.specifications?.brandModel ||
          item?.brandModel ||
          item?.brandName ||
          item?.brand ||
          null;
        const requiredRoleForItem = getAllowedSellerRoleForBrand(itemBrandName, terminalRoleByBrandMap);
        if (requiredRoleForItem && !supplierMatchesBrandTerminalRole(supplier.profile, itemBrandName, terminalRoleByBrandMap)) {
          const requiredRole = requiredRoleForItem;
          const requiredRoleText = requiredRole || 'not configured (admin must define brand chain)';
          return res.status(403).json({
            status: 'error',
            message: `Vendor "${group.vendorName}" cannot be selected for "${item.name}". Required seller role for this brand: ${requiredRoleText}.`
          });
        }

        // Use the actual supplier-specific price from database
        const baseUnitPrice = parseFloat(supplierProduct.price) || 0;
        const quantity = parseFloat(item.quantity) || 0;
        const bcovBrandKey = extractBrandForBcov({ supplierProduct, item });
        const bcovScopeKeys = extractBcovScopeKeys({ supplierProduct, item });
        const bcovResolved = await resolveBcov({
          buyerId: req.userId,
          supplierId: supplier.id,
          brandKey: bcovBrandKey,
          scopeKeys: bcovScopeKeys
        });
        const unitPrice = bcovResolved?.price ?? baseUnitPrice;
        const taxableAmount = unitPrice * quantity;
        assertSupplierProductTaxRates({
          supplierProduct,
          context: 'Order GST calculation',
          productRef: `supplier_product_id ${supplierProduct.id}`
        });
        const lineGst = computeLineGst({
          taxableAmount,
          igstRate: supplierProduct.igst_rate,
          cgstRate: supplierProduct.cgst_rate,
          sgstRate: supplierProduct.sgst_rate,
          intraState: intraStateTax
        });
        lineTaxBreakdown.push(lineGst);

        orderItems.push({
          product_id: supplierProduct.product.id,
          supplier_product_id: supplierProduct.id,
          quantity: quantity,
          unit_price: unitPrice,
          total_price: taxableAmount,
          // Immutable per-order identity snapshot for return/replacement tracking.
          specifications: JSON.stringify({
            productIdentification: item.productIdentification || null,
            parentAsin: supplierProduct?.product?.asin || null,
            variantAsin: supplierProduct?.variant_asin || null,
            variantKey: supplierProduct?.variant_key || null,
            brandModel: supplierProduct?.attributes?.brandModel || null,
            variantAttributes: supplierProduct?.attributes?.variantAttributes || {},
            bcov: bcovResolved
              ? {
                  applied: true,
                  levelId: bcovResolved.levelId,
                  baseUnitPrice
                }
              : { applied: false },
            gst: {
              supplierState,
              billingState,
              intraStateTax,
              taxType: lineGst.taxType,
              taxableAmount: lineGst.taxableAmount,
              taxAmount: lineGst.taxAmount,
              totalAmount: lineGst.totalAmount,
              igstRate: lineGst.igstRate,
              cgstRate: lineGst.cgstRate,
              sgstRate: lineGst.sgstRate
            },
            snapshotAt: new Date().toISOString()
          })
        });
      }

      // Calculate total amount (tax-inclusive) and keep detailed GST split.
      const gstSummary = sumGstLines(lineTaxBreakdown);
      const totalAmount = gstSummary.totalAmount;

      // Duplicate guard: if an equivalent order was just created very recently,
      // return the existing order instead of creating a second one.
      const recentWindowStart = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: recentDuplicate } = await supabase
        .from('orders')
        .select('id, order_number, total_amount, created_at')
        .eq('service_provider_id', req.userId)
        .eq('supplier_id', supplier.id)
        .eq('boq_id', boq ? boq.id : null)
        .eq('status', 'confirmed')
        .eq('payment_status', 'pending')
        .gte('created_at', recentWindowStart)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentDuplicate) {
        const existingAmount = parseFloat(recentDuplicate.total_amount || 0);
        if (Math.abs(existingAmount - totalAmount) < 0.01) {
          createdOrders.push({
            id: recentDuplicate.id,
            orderNumber: recentDuplicate.order_number,
            supplier: group.vendorName,
            totalAmount: existingAmount,
            deduplicated: true
          });
          continue;
        }
      }

      // Create order using DB-side order_number generation (trigger/sequence).
      // Retry on unique order_number collisions in case of transient sequence conflicts.
      let order = null;
      let orderError = null;
      for (let attempt = 0; attempt <= ORDER_INSERT_MAX_RETRIES; attempt++) {
        const orderInsertResult = await supabase
          .from('orders')
          .insert({
            service_provider_id: req.userId,
            supplier_id: supplier.id,
            boq_id: boq ? boq.id : null,
            total_amount: totalAmount,
            expected_delivery_date: expectedDeliveryDate,
            status: 'confirmed',
            lifecycle_state: toLifecycleStateFromStatus('confirmed'),
            payment_status: poPaymentStatus,
            payment_method: poPaymentMethod,
            delivery_address: {
              ...mapToDeliveryAddress(selectedDeliveryAddress),
              shippingAddress: mapToDeliveryAddress(shippingAddress),
              billingAddress: mapToDeliveryAddress(billingAddress),
              deliveryDestination,
              gstin: hasGstin ? profileGstin : null,
              gstTaxApplicableOnBillingAddressOnly: hasGstin,
              gstSummary: {
                taxType: intraStateTax ? 'CGST_SGST' : 'IGST',
                supplierState,
                billingState,
                subtotalAmount: gstSummary.subtotalAmount,
                taxAmount: gstSummary.taxAmount,
                igstAmount: gstSummary.igstAmount,
                cgstAmount: gstSummary.cgstAmount,
                sgstAmount: gstSummary.sgstAmount,
                totalAmount: gstSummary.totalAmount
              }
            },
            channel: 'b2b_po',
            outlet_id: null,
            status_history: [{
              status: 'confirmed',
              updatedBy: req.userId,
              notes: 'Purchase order created and confirmed by service provider',
              timestamp: new Date().toISOString()
            }]
          })
          .select()
          .single();

        order = orderInsertResult.data || null;
        orderError = orderInsertResult.error || null;
        if (!orderError && order) {
          break;
        }
        if (!isOrderNumberConflictError(orderError) || attempt === ORDER_INSERT_MAX_RETRIES) {
          break;
        }
      }

      if (orderError || !order) {
        logger.error('Order creation error:', orderError);
        throw new Error(orderError?.message || 'Failed to create order');
      }

      // Create order items
      const orderItemsWithOrderId = orderItems.map(item => ({
        ...item,
        order_id: order.id
      }));

      const { data: insertedItems, error: itemsError } = await supabase
        .from('order_items')
        .insert(orderItemsWithOrderId)
        .select();

      if (itemsError) {
        logger.error('Order items creation error:', itemsError);
        // Delete the order if items creation fails
        await supabase.from('orders').delete().eq('id', order.id);
        throw new Error('Failed to create order items');
      }

      // Record inventory movements for each ordered item (stock out)
      try {
        const itemsWithIds = insertedItems || [];
        for (let i = 0; i < itemsWithIds.length; i++) {
          const orderItem = itemsWithIds[i];
          const qty = parseFloat(orderItem.quantity) || 0;
          if (!qty || qty <= 0) continue;

          // Stock must decrease on the exact supplier_products row (seller offer) tied to this line item.
          let supplierProduct = null;
          if (orderItem.supplier_product_id) {
            const { data: spById, error: spErrorById } = await supabase
              .from('supplier_products')
              .select('id, supplier_id, product_id')
              .eq('id', orderItem.supplier_product_id)
              .maybeSingle();
            if (spErrorById) {
              logger.warn('[PO] Inventory movement supplier_product_id lookup error:', spErrorById);
            }
            if (spById && spById.supplier_id === supplier.id) {
              supplierProduct = spById;
            } else if (spById && spById.supplier_id !== supplier.id) {
              logger.error('[PO] order_items.supplier_product_id does not belong to this order supplier — skipping wrong inventory row', {
                orderSupplierId: supplier.id,
                offerOwnerId: spById.supplier_id,
                supplierProductId: spById.id
              });
            }
          }

          if (!supplierProduct) {
            const { data: spByFallback, error: spError } = await supabase
              .from('supplier_products')
              .select('id, supplier_id, product_id')
              .eq('product_id', orderItem.product_id)
              .eq('supplier_id', supplier.id)
              .eq('is_active', true)
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();

            if (spError) {
              logger.warn('[PO] Inventory movement supplier fallback lookup error:', spError);
            }
            supplierProduct = spByFallback;
          }

          if (!supplierProduct) {
            logger.warn('[PO] No supplier_products entry found for inventory movement', {
              product_id: orderItem.product_id,
              supplier_id: supplier.id
            });
            continue;
          }

          await recordInventoryMovement({
            supplierProductId: supplierProduct.id,
            supplierId: supplier.id,
            productId: supplierProduct.product_id || orderItem.product_id,
            quantityChange: -qty,
            movementType: 'sale_online',
            referenceOrderId: order.id,
            referenceOrderItemId: orderItem.id,
            notes: 'B2B PO order created from BOQ',
            userId: req.userId
          });
        }
      } catch (invErr) {
        logger.error('[PO] Inventory movement error for B2B PO:', invErr);
        // Do not fail the order if inventory logging fails; monitor via logs.
      }

      // Create notification for the supplier about the new order
      try {
        // Get service provider info for the notification message
        const { data: serviceProvider } = await supabase
          .from('users')
          .select('name, company')
          .eq('id', req.userId)
          .single();
        
        const serviceProviderName = serviceProvider?.name || serviceProvider?.company || 'Service Provider';
        
        await insertNotification({
          user_id: supplier.id,
          type: 'order_status',
          title: 'New Order Received',
          message: `You have received a new order ${order.order_number} from ${serviceProviderName} for ₹${totalAmount.toLocaleString('en-IN')}`,
          related_order_id: order.id,
          is_read: false
        }, supabase);
        
        logger.debug(`Notification created for supplier ${supplier.id} about new order ${order.order_number}`);
      } catch (notifError) {
        logger.error('Error creating order notification:', notifError);
        // Don't fail the order creation if notification creation fails
      }

      createdOrders.push({
        id: order.id,
        orderNumber: order.order_number,
        supplier: group.vendorName,
        totalAmount: totalAmount
      });
    }

    // Update BOQ status if it exists
    if (boq) {
      const processingLog = boq.processing_log || [];
      processingLog.push({
        action: 'completed',
        details: 'Purchase orders created',
        user: req.userId,
        timestamp: new Date().toISOString()
      });

      await supabase
        .from('boqs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          processing_log: processingLog
        })
        .eq('id', boq.id);
    }

    res.json({ 
      success: true, 
      orders: createdOrders,
      message: `Successfully created ${createdOrders.length} purchase order(s)`
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.error('PO creation error:', error);
    const statusCode = Number(error?.statusCode) || 500;
    res.status(statusCode).json({ 
      status: 'error',
      message: statusCode === 400 ? error.message : 'Failed to create purchase orders',
      error: error.message 
    });
  }
});

router.get('/cart', authenticateToken, isServiceProvider, async (req, res) => {
  try {
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
            draft: normalizePoCartDraft(cart.draft_payload || {}),
            updatedAt: cart.updated_at,
            createdAt: cart.created_at
          }
        : null
    });
  } catch (error) {
    console.error('Get PO cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to load cart' });
  }
});

router.put('/cart', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(poCartSaveSchema, req.body || {});
    const draftPayload = buildPoCartDraftFromSavePayload(payload);

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
      message: 'Cart saved successfully',
      cart: {
        id: saved.id,
        updatedAt: saved.updated_at
      }
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Save PO cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to save cart' });
  }
});

router.post('/cart/discovery-item', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const productId = String(req.body?.productId || '').trim();
    const rawQty = Number(req.body?.quantity);
    const quantity = Number.isFinite(rawQty) ? Math.max(1, Math.floor(rawQty)) : 1;

    if (!productId) {
      return res.status(400).json({ status: 'error', message: 'productId is required' });
    }

    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, unit, brand, specifications, status')
      .eq('id', productId)
      .maybeSingle();
    if (productError) throw productError;
    if (!product || String(product.status || '').toLowerCase() !== 'approved') {
      return res.status(404).json({ status: 'error', message: 'Product not found' });
    }
    // Keep cart add behavior aligned with Product Discovery:
    // allow only products that are actively listed by at least one approved supplier listing.
    const { data: activeListing, error: listingError } = await supabase
      .from('supplier_products')
      .select('id')
      .eq('product_id', productId)
      .eq('status', 'approved')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    if (listingError) throw listingError;
    if (!activeListing) {
      return res.status(400).json({
        status: 'error',
        message: 'This product is not currently listed on the platform.'
      });
    }

    const { data: cartRow, error: cartError } = await supabase
      .from('po_carts')
      .select('id, draft_payload')
      .eq('service_provider_id', req.userId)
      .maybeSingle();
    if (cartError) throw cartError;

    const currentDraft = normalizePoCartDraft(
      cartRow?.draft_payload && typeof cartRow.draft_payload === 'object' ? cartRow.draft_payload : {}
    );

    const discoveryItem = {
      id: `pd-item-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      normalizedName: product.name || 'Unnamed Product',
      rawName: product.name || 'Unnamed Product',
      name: product.name || 'Unnamed Product',
      quantity,
      unit: product.unit || 'nos',
      productId: product.id,
      brand: product.brand || undefined,
      specifications: product.specifications || undefined
    };

    const groupId = `pd-group-${newPoCartGroupId()}`;
    const existingGroups = Array.isArray(currentDraft.boqGroups) ? currentDraft.boqGroups : [];
    const nextGroups = [
      ...existingGroups,
      {
        groupId,
        boqId: null,
        boqName: `Discovery - ${product.name || 'Product'}`,
        boqProject: { source: 'product_discovery' },
        selectedVendors: {},
        substitutions: [],
        items: [discoveryItem]
      }
    ];

    const nextDraftPayload = normalizePoCartDraft({
      ...currentDraft,
      boqGroups: nextGroups
    });

    const { error: saveError } = await supabase
      .from('po_carts')
      .upsert(
        {
          service_provider_id: req.userId,
          draft_payload: nextDraftPayload
        },
        { onConflict: 'service_provider_id' }
      );
    if (saveError) throw saveError;

    return res.json({
      status: 'success',
      message: 'Product added to cart',
      groupId
    });
  } catch (error) {
    console.error('Add discovery product to cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to add product to cart' });
  }
});

router.patch('/cart/items/:itemId/quantity', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const rawQuantity = Number(req.body?.quantity);
    const quantity = Number.isFinite(rawQuantity) ? Math.floor(rawQuantity) : NaN;
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_CART_ITEM_QUANTITY) {
      return res.status(400).json({
        status: 'error',
        message: `Quantity must be an integer between 1 and ${MAX_CART_ITEM_QUANTITY}`
      });
    }

    const itemId = String(req.params?.itemId || '').trim();
    if (!itemId) {
      return res.status(400).json({
        status: 'error',
        message: 'Cart item id is required'
      });
    }

    const { data: cart, error: cartError } = await supabase
      .from('po_carts')
      .select('id, draft_payload, updated_at')
      .eq('service_provider_id', req.userId)
      .maybeSingle();

    if (cartError) throw cartError;
    if (!cart) {
      return res.status(404).json({ status: 'error', message: 'Saved cart not found' });
    }

    const currentDraft = normalizePoCartDraft(
      cart.draft_payload && typeof cart.draft_payload === 'object' ? cart.draft_payload : {}
    );
    const groups = Array.isArray(currentDraft.boqGroups) ? [...currentDraft.boqGroups] : [];
    let found = false;
    const nextGroups = groups.map((group) => {
      const arr = Array.isArray(group.items) ? [...group.items] : [];
      const idx = arr.findIndex((item) => item?.id !== undefined && item?.id !== null && String(item.id) === itemId);
      if (idx < 0) return group;
      found = true;
      const nextArr = [...arr];
      nextArr[idx] = { ...nextArr[idx], quantity };
      return { ...group, items: nextArr };
    });

    if (!found) {
      return res.status(404).json({ status: 'error', message: 'Cart item not found' });
    }

    const nextDraftPayload = normalizePoCartDraft({
      ...currentDraft,
      boqGroups: nextGroups
    });

    const { error: updateError } = await supabase
      .from('po_carts')
      .update({ draft_payload: nextDraftPayload })
      .eq('id', cart.id)
      .eq('service_provider_id', req.userId);
    if (updateError) throw updateError;

    const updatedItem = nextDraftPayload.items.find((it) => String(it?.id) === itemId);

    return res.json({
      status: 'success',
      message: 'Cart item quantity updated',
      item: updatedItem
    });
  } catch (error) {
    console.error('Update PO cart item quantity error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to update cart quantity' });
  }
});

router.delete('/cart', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const { error } = await supabase
      .from('po_carts')
      .delete()
      .eq('service_provider_id', req.userId);
    if (error) throw error;
    return res.json({ status: 'success', message: 'Cart cleared successfully' });
  } catch (error) {
    console.error('Clear PO cart error:', error);
    return res.status(500).json({ status: 'error', message: 'Failed to clear cart' });
  }
});

// Service provider rating + feedback for a supplier on an order
router.post('/:id/rating', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(poRatingSchema, req.body || {});
    const { id } = req.params;
    const decodedId = decodeURIComponent(id);
    const { rating, feedback } = payload;

    // Basic validation
    const numericRating = parseInt(rating, 10);
    if (!numericRating || numericRating < 1 || numericRating > 5) {
      return res.status(400).json({
        status: 'error',
        message: 'Rating must be a number between 1 and 5'
      });
    }

    // Find order by order_number first, then by id
    let { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*')
      .eq('order_number', decodedId)
      .eq('service_provider_id', req.userId)
      .single();

    if (orderError || !order) {
      const { data: orderById, error: orderByIdError } = await supabase
        .from('orders')
        .select('*')
        .eq('id', decodedId)
        .eq('service_provider_id', req.userId)
        .single();

      if (!orderByIdError && orderById) {
        order = orderById;
        orderError = null;
      }
    }

    if (orderError || !order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to rate this order'
      });
    }

    // Only allow rating after payment is completed and order delivered
    if (!canRateSupplierForOrder({ status: order.status, paymentStatus: order.payment_status })) {
      return res.status(400).json({
        status: 'error',
        message: 'You can only rate a supplier after the order is delivered and payment is marked as paid'
      });
    }

    const supplierId = order.supplier_id;
    if (!supplierId) {
      return res.status(400).json({
        status: 'error',
        message: 'This order does not have a linked supplier'
      });
    }

    // Check if a rating already exists for this order + service provider
    const { data: existingRating } = await supabase
      .from('supplier_ratings')
      .select('*')
      .eq('order_id', order.id)
      .eq('service_provider_id', req.userId)
      .single();

    let savedRating;
    if (existingRating) {
      const { data, error } = await supabase
        .from('supplier_ratings')
        .update({
          rating: numericRating,
          feedback: feedback || existingRating.feedback || null
        })
        .eq('id', existingRating.id)
        .select()
        .single();

      if (error) {
        throw error;
      }
      savedRating = data;
    } else {
      const { data, error } = await supabase
        .from('supplier_ratings')
        .insert({
          order_id: order.id,
          supplier_id: supplierId,
          service_provider_id: req.userId,
          rating: numericRating,
          feedback: feedback || null
        })
        .select()
        .single();

      if (error) {
        throw error;
      }
      savedRating = data;
    }

    return res.json({
      status: 'success',
      message: 'Thank you for your feedback! Your rating has been recorded.',
      rating: savedRating
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.error('Supplier rating error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to submit rating. Please try again later.',
      error: error.message
    });
  }
});

router.get('/:id/rating', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const decodedId = decodeURIComponent(req.params.id);
    const { order, orderError } = await findServiceProviderOrderByIdentifier(decodedId, req.userId);
    if (orderError || !order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to view this rating'
      });
    }

    const { data: ratingRow } = await supabase
      .from('supplier_ratings')
      .select('*')
      .eq('order_id', order.id)
      .eq('service_provider_id', req.userId)
      .maybeSingle();

    return res.json({
      status: 'success',
      rating: ratingRow || null
    });
  } catch (error) {
    logger.error('Get supplier rating error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to load rating',
      error: error.message
    });
  }
});

router.patch('/:id/self-serve', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const decodedId = decodeURIComponent(req.params.id);
    const { order, orderError } = await findServiceProviderOrderByIdentifier(decodedId, req.userId);
    if (orderError || !order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to edit this order'
      });
    }

    if (!canSelfServeEditOrder({ status: order.status, paymentStatus: order.payment_status })) {
      return res.status(400).json({
        status: 'error',
        message: 'This order can only be edited while it is pending/confirmed and unpaid'
      });
    }

    const payload = parseWithSchema(poSelfServePatchSchema, req.body || {});
    const { expectedDeliveryDate, paymentMethod, notes, deliveryAddress } = payload;
    const updateData = {};

    if (typeof expectedDeliveryDate !== 'undefined') {
      if (!expectedDeliveryDate) {
        updateData.expected_delivery_date = null;
      } else {
        const parsed = new Date(expectedDeliveryDate);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ status: 'error', message: 'Invalid expectedDeliveryDate' });
        }
        updateData.expected_delivery_date = parsed.toISOString();
      }
    }

    if (typeof paymentMethod !== 'undefined') {
      const normalized = String(paymentMethod || '').trim().toLowerCase();
      if (!PAYMENT_METHODS_ALLOWED.has(normalized)) {
        return res.status(400).json({
          status: 'error',
          message: `Invalid paymentMethod. Allowed values: ${Array.from(PAYMENT_METHODS_ALLOWED).join(', ')}`
        });
      }
      updateData.payment_method = normalized;
    }

    if (typeof notes !== 'undefined') {
      updateData.notes = String(notes || '').trim() || null;
    }

    if (deliveryAddress && typeof deliveryAddress === 'object') {
      const nextAddress = {
        ...(order.delivery_address || {}),
        ...deliveryAddress
      };
      updateData.delivery_address = nextAddress;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No editable fields provided'
      });
    }

    const currentStatusHistory = Array.isArray(order.status_history) ? order.status_history : [];
    currentStatusHistory.push({
      status: order.status || 'pending',
      timestamp: new Date().toISOString(),
      updatedBy: req.userId,
      notes: 'Self-serve order edit by service provider'
    });
    updateData.status_history = currentStatusHistory;

    const { data: updatedOrder, error: updateError } = await supabase
      .from('orders')
      .update(updateData)
      .eq('id', order.id)
      .select('*')
      .single();

    if (updateError || !updatedOrder) {
      throw updateError || new Error('Failed to update order');
    }

    return res.json({
      status: 'success',
      message: 'Order updated successfully',
      order: updatedOrder
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.error('Self-serve order edit error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to update order',
      error: error.message
    });
  }
});

router.post('/:id/cancel', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const decodedId = decodeURIComponent(req.params.id);
    const payload = parseWithSchema(poCancelSchema, req.body || {});
    const reason = String(payload.reason || '').trim();
    const { order, orderError } = await findServiceProviderOrderByIdentifier(decodedId, req.userId);
    if (orderError || !order) {
      return res.status(404).json({
        status: 'error',
        message: 'Order not found or you do not have permission to cancel this order'
      });
    }

    if (!canSelfServeCancelOrder({ status: order.status, paymentStatus: order.payment_status })) {
      return res.status(400).json({
        status: 'error',
        message: 'This order cannot be cancelled after processing/shipping/delivery or once paid'
      });
    }

    let updatedOrder = null;
    try {
      const atomicResult = await cancelOrderWithAtomicRestock({
        orderId: order.id,
        actorUserId: req.userId,
        cancelReason: reason || null
      });
      if (atomicResult?.id) {
        const { data: refreshedOrder } = await supabase
          .from('orders')
          .select('*')
          .eq('id', atomicResult.id)
          .single();
        updatedOrder = refreshedOrder || null;
      }
    } catch (atomicError) {
      logger.warn('Atomic cancel RPC unavailable, using fallback cancellation path:', atomicError.message);
      const nextStatusHistory = Array.isArray(order.status_history) ? order.status_history : [];
      nextStatusHistory.push({
        status: 'cancelled',
        timestamp: new Date().toISOString(),
        updatedBy: req.userId,
        notes: reason || 'Cancelled by service provider'
      });

      const { data: fallbackUpdatedOrder, error: updateError } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          lifecycle_state: toLifecycleStateFromStatus('cancelled'),
          notes: reason ? `${order.notes ? `${order.notes}\n` : ''}Cancellation reason: ${reason}` : order.notes,
          status_history: nextStatusHistory
        })
        .eq('id', order.id)
        .select('*')
        .single();
      if (updateError || !fallbackUpdatedOrder) {
        throw updateError || new Error('Failed to cancel order');
      }
      updatedOrder = fallbackUpdatedOrder;

      try {
        await restockInventoryForCancelledOrder({
          orderId: updatedOrder.id,
          actorUserId: req.userId
        });
      } catch (restockError) {
        logger.error('Cancel restock error:', restockError);
      }
    }

    if (!updatedOrder) {
      throw new Error('Failed to cancel order');
    }

    return res.json({
      status: 'success',
      message: 'Order cancelled successfully',
      order: updatedOrder
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.error('Cancel order error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to cancel order',
      error: error.message
    });
  }
});

export { router as poRouter };
