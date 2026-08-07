/** PO routes: create */
import {
  ORDER_INSERT_MAX_RETRIES,
  assertGstStateInputs,
  assertSupplierProductTaxRates,
  buildBcovResolver,
  computeLineGst,
  extractBcovScopeKeys,
  extractBrandForBcov,
  extractUserState,
  getAllowedSellerRoleForBrand,
  getContractErrorMessage,
  insertNotification,
  isAddressComplete,
  isOrderNumberConflictError,
  isSameIndianState,
  loadAdminBrandTerminalRoleMap,
  logger,
  loadServiceProviderPoCartDraft,
  mapToDeliveryAddress,
  normalizeAddress,
  parseWithSchema,
  poCreateRequestSchema,
  recordInventoryMovement,
  resolveB2bPaymentFromBody,
  resolveCheckoutShippingAddress,
  buildOrderGstSummary,
  resolveCheckoutBillingAddress,
  resolveGstPlaceOfSupplyState,
  resolveSupplierStateForGst,
  supplierMatchesBrandTerminalRole,
  toLifecycleStateFromStatus
} from './poImports.js';
import {
  assertPmVaultBalanceSufficient,
  readPmCredentialsFromRequest,
  usesPlatformVault
} from '../../services/pmVaultService.js';
import {
  maybeNotifySupplierCreditAlert,
  validateCreditForOrder
} from '../../services/creditAccountService.js';
import { isVaultPaymentMethod, toApiVaultPaymentMethod } from '../../utils/vaultPaymentMethod.js';
import { loadSupplierProductForPoCreate } from './groupRoutes.js';
import {
  CHECKOUT_SOURCES,
  consumeCheckoutReservationsForOrder,
  validateCheckoutReservationsForLines
} from '../../services/checkoutInventoryReservationService.js';
import {
  sumPoGroupsProductsInclGst
} from '../../utils/orderChargeBreakdown.js';

export function registerPoCreateRoutes(ctx) {
  const {
    router,
    authenticateToken,
    isServiceProvider,
    supabase
  } = ctx;

router.post('/create', authenticateToken, isServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(poCreateRequestSchema, req.body || {});
    const { poGroups, boqId, requiredDate, checkoutSessionId } = payload;
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
    const requestedPaymentMethod = String(payload?.paymentMethod || payload?.payment_method || 'vault')
      .toLowerCase()
      .trim();
    const payLaterRequested =
      requestedPaymentMethod === 'credit' ||
      requestedPaymentMethod === 'pay_later' ||
      requestedPaymentMethod === 'pay-later';
    const { payment_method: resolvedPaymentMethod, payment_status: poPaymentStatus } =
      resolveB2bPaymentFromBody(payload);
    const poPaymentMethod = payLaterRequested ? 'credit' : resolvedPaymentMethod;
    const isVaultCheckout = !payLaterRequested && isVaultPaymentMethod(poPaymentMethod);
    const paymentDetails = payload.paymentDetails && typeof payload.paymentDetails === 'object'
      ? payload.paymentDetails
      : null;
    const requestedShippingAddress = normalizeAddress(payload.shippingAddress || {});
    
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

    // BOQ is optional metadata. Cart checkout can carry a stale boqId
    // from previous BOQ flows, so do not block PO creation if not found.
    let boq = null;
    if (boqId) {
      const { data: boqData, error: boqError } = await supabase
        .from('boqs')
        .select('*')
        .eq('id', boqId)
        .eq('service_provider_id', req.userId)
        .maybeSingle();

      if (boqError) {
        logger.warn('[PO] BOQ lookup failed; proceeding without BOQ link', {
          boqId,
          userId: req.userId,
          code: boqError.code,
          message: boqError.message
        });
      } else if (!boqData) {
        logger.warn('[PO] BOQ not accessible or not found; proceeding as cart checkout', {
          boqId,
          userId: req.userId
        });
      } else {
        boq = boqData;
      }
    }

    const { data: serviceProvider, error: serviceProviderError } = await supabase
      .from('users')
      .select('id, address, profile, name, company')
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
    const cartDraft = await loadServiceProviderPoCartDraft(supabase, req.userId);
    const workflowItems = (Array.isArray(poGroups) ? poGroups : []).flatMap((group) =>
      Array.isArray(group?.items) ? group.items : []
    );
    const groupShippingFallback = (Array.isArray(poGroups) ? poGroups : [])
      .map((group) => normalizeAddress(group?.shippingAddress || {}))
      .find((entry) => isAddressComplete(entry));
    const shippingAddress =
      resolveCheckoutShippingAddress({
        cartDraft,
        workflowItems,
        requestedAddress: requestedShippingAddress
      }) ||
      groupShippingFallback ||
      profileAddress;
    const deliveryDestination = payload.deliveryDestination === 'billing' ? 'billing' : 'shipping';
    const billingAddress = resolveCheckoutBillingAddress({
      serviceProvider,
      requestedBillingAddress: payload.billingAddress,
      shippingAddress,
      hasGstin
    });
    const placeOfSupplyState = resolveGstPlaceOfSupplyState({
      hasGstin,
      deliveryDestination,
      billingAddress,
      shippingAddress
    });
    const selectedDeliveryAddress =
      deliveryDestination === 'billing' && hasGstin ? billingAddress : shippingAddress;

    if (!isAddressComplete(shippingAddress)) {
      return res.status(400).json({
        status: 'error',
        message: 'Shipping address is incomplete. Set a delivery address in your cart before creating purchase orders.'
      });
    }

    const createdOrders = [];
    const toMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

    const reservationLines = (Array.isArray(poGroups) ? poGroups : []).flatMap((group) =>
      (Array.isArray(group?.items) ? group.items : [])
        .map((item) => ({
          supplierProductId: String(item?.supplierProductId || '').trim(),
          quantity: Number(item?.quantity) || 0
        }))
        .filter((line) => line.supplierProductId && line.quantity > 0)
    );

    try {
      await validateCheckoutReservationsForLines({
        buyerUserId: req.userId,
        source: CHECKOUT_SOURCES.SP_PO,
        checkoutSessionId,
        lines: reservationLines
      });
    } catch (reservationError) {
      return res.status(409).json({
        status: 'error',
        code: 'inventory_hold_expired',
        message: reservationError?.message || 'Inventory hold has expired. Return to your cart and proceed again.',
      });
    }

    let walletRemainingBalance = null;
    if (isVaultCheckout) {
      const productsTotal = toMoney(sumPoGroupsProductsInclGst(poGroups));
      const quotedTransportTotal = toMoney(payload?.quotedTransportTotal || 0);
      const groupedTotal = toMoney(productsTotal + quotedTransportTotal);

      let currentVaultBalance = 0;
      try {
        if (!usesPlatformVault(req.user)) {
          return res.status(400).json({
            status: 'error',
            code: 'PM_VAULT_REQUIRED',
            message:
              'Vault payment uses the PM platform vault only. Sign in with phone OTP so vault balance can be checked on PM.'
          });
        }
        const pmCredentials = readPmCredentialsFromRequest(req);
        const pmWallet = await assertPmVaultBalanceSufficient(
          req.user,
          groupedTotal,
          pmCredentials
        );
        currentVaultBalance = toMoney(pmWallet?.balance || 0);
      } catch (vaultError) {
        if (vaultError?.code === 'PM_AUTH_REQUIRED') {
          return res.status(401).json({
            status: 'error',
            code: vaultError.code,
            message: vaultError.message || 'Sign in with phone OTP to use vault balance.'
          });
        }
        if (vaultError?.code === 'INSUFFICIENT_WALLET_BALANCE' || vaultError?.code === 'INSUFFICIENT_VAULT_BALANCE') {
          const availableMatch = String(vaultError.message || '').match(/Available INR\s+([0-9.]+)/i);
          const available = toMoney(availableMatch?.[1] || 0);
          const shortage = toMoney(Math.max(0, groupedTotal - available));
          return res.status(400).json({
            status: 'error',
            code: 'INSUFFICIENT_VAULT_BALANCE',
            message: `Insufficient vault balance. Available ₹${available.toLocaleString(
              'en-IN'
            )}, required ₹${groupedTotal.toLocaleString(
              'en-IN'
            )} (products incl. GST + transport). Please credit vault before placing this order.`,
            vault: {
              balance: available,
              required: groupedTotal,
              productsTotal,
              gstIncluded: true,
              transportTotal: quotedTransportTotal,
              shortage
            }
          });
        }
        throw vaultError;
      }

      // Track remaining PM vault headroom across sequential PO creates.
      walletRemainingBalance = currentVaultBalance;
    }
    const resolveBcov = buildBcovResolver(supabase);
    const GROUP_CREATE_CONCURRENCY = isVaultCheckout ? 1 : 3;
    const createHttpError = (statusCode, message) => {
      const err = new Error(message);
      err.statusCode = statusCode;
      return err;
    };
    const runWithConcurrency = async (items, limit, worker) => {
      const values = Array.isArray(items) ? items : [];
      const safeLimit = Math.max(1, Number(limit) || 1);
      const out = new Array(values.length);
      let cursor = 0;

      const lane = async () => {
        while (cursor < values.length) {
          const i = cursor;
          cursor += 1;
          out[i] = await worker(values[i], i);
        }
      };

      const active = Array.from({ length: Math.min(safeLimit, values.length) }, () => lane());
      await Promise.all(active);
      return out;
    };

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

    const processPoGroup = async (group) => {
      // Find supplier by vendorId
      if (!group.vendorId) {
        logger.warn('Missing vendorId in PO group:', group);
        throw createHttpError(
          400,
          `Missing supplier ID for vendor "${group.vendorName}". Cannot create order.`
        );
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
        throw createHttpError(
          404,
          `Supplier not found for vendor "${group.vendorName}". Please ensure the supplier exists in the system.`
        );
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
        throw createHttpError(
          403,
          `Vendor "${group.vendorName}" does not match the terminal role for this brand. Required seller role: ${requiredRoleText}.`
        );
      }

      let outletRow = null;
      if (firstGroupItem?.supplierProductId) {
        const { data: offerRow } = await supabase
          .from('supplier_products')
          .select('outlet_id')
          .eq('id', firstGroupItem.supplierProductId)
          .maybeSingle();
        const outletId = String(offerRow?.outlet_id || '').trim();
        if (outletId) {
          const { data: outletData } = await supabase
            .from('outlets')
            .select('id, supplier_id, address')
            .eq('id', outletId)
            .eq('is_active', true)
            .maybeSingle();
          outletRow = outletData || null;
        }
      }
      const supplierState = resolveSupplierStateForGst({
        supplierUser: supplier,
        supplierProduct: firstGroupItem,
        outlet: outletRow
      });
      const billingState = placeOfSupplyState || billingAddress?.state || shippingAddress?.state || '';
      assertGstStateInputs({
        supplierState,
        billingState,
        context: 'Order GST calculation'
      });
      const intraStateTax = isSameIndianState(supplierState, billingState);

      const itemsArray = Array.isArray(group.items) ? group.items : [];
      const lineBuilt = await Promise.all(
        itemsArray.map(async (item) => {
          const supplierProduct = await loadSupplierProductForPoCreate(supabase, supplier.id, item);

          if (!supplierProduct || !supplierProduct.product) {
            const err = new Error(
              `Supplier product "${item.name}" not found for supplier "${group.vendorName}". ` +
                'If the listing exists, it may be pending approval, inactive, or the catalog name may not match. ' +
                'Use Manage your product to ensure an active offer (approved or pending per your workflow) is linked for this item.'
            );
            err.statusCode = 400;
            throw err;
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
            const err = new Error(
              `Vendor "${group.vendorName}" cannot be selected for "${item.name}". Required seller role for this brand: ${requiredRoleText}.`
            );
            err.statusCode = 403;
            throw err;
          }

          const baseUnitPrice = parseFloat(supplierProduct.price) || 0;
          const rawQuantity = parseFloat(item?.quantity);
          // order_items.quantity is integer in DB. Validate early and fail
          // with a clear client error instead of a generic DB insert failure.
          const quantity = Number.isFinite(rawQuantity) ? rawQuantity : null;
          if (!Number.isInteger(quantity) || quantity < 1) {
            const err = new Error(
              `Invalid quantity for "${item?.name || 'item'}". Quantity must be a whole number (1 or more).`
            );
            err.statusCode = 400;
            throw err;
          }
          const bcovVariantKey = supplierProduct?.variant_key || item?.variantKey || '';
          const bcovBrandKey = extractBrandForBcov({ supplierProduct, item });
          const bcovScopeKeys = extractBcovScopeKeys({ supplierProduct, item });
          const bcovResolved = await resolveBcov({
            buyerId: req.userId,
            supplierId: supplier.id,
            variantKey: bcovVariantKey,
            brandKey: bcovBrandKey,
            scopeKeys: bcovScopeKeys
          });
          const unitPrice = bcovResolved?.price ?? baseUnitPrice;
          const taxableAmount = unitPrice * quantity;
          const itemSpecifications =
            item?.specifications && typeof item.specifications === 'object' && !Array.isArray(item.specifications)
              ? item.specifications
              : {};
          assertSupplierProductTaxRates({
            supplierProduct,
            context: 'Order GST calculation',
            productRef: `supplier_product_id ${supplierProduct.id}`
          });
          const lineGst = computeLineGst({
            taxableAmount,
            intraState: intraStateTax,
            supplierProduct
          });

          const orderItemRow = {
            product_id: supplierProduct.product.id,
            supplier_product_id: supplierProduct.id,
            quantity: quantity,
            unit_price: unitPrice,
            total_price: taxableAmount,
            specifications: JSON.stringify({
              ...itemSpecifications,
              productIdentification: item.productIdentification || null,
              parentAsin: supplierProduct?.product?.asin || null,
              variantAsin: supplierProduct?.variant_asin || null,
              variantKey: supplierProduct?.variant_key || null,
              brandModel: supplierProduct?.attributes?.brandModel || null,
              variantAttributes:
                supplierProduct?.attributes?.variantAttributes &&
                typeof supplierProduct.attributes.variantAttributes === 'object'
                  ? supplierProduct.attributes.variantAttributes
                  : {},
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
                placeOfSupplyState: billingState,
                intraStateTax,
                taxType: lineGst.taxType,
                taxableAmount: lineGst.taxableAmount,
                taxAmount: lineGst.taxAmount,
                igstAmount: lineGst.igstAmount,
                cgstAmount: lineGst.cgstAmount,
                sgstAmount: lineGst.sgstAmount,
                totalAmount: lineGst.totalAmount,
                igstRate: lineGst.igstRate,
                cgstRate: lineGst.cgstRate,
                sgstRate: lineGst.sgstRate
              },
              snapshotAt: new Date().toISOString()
            })
          };
          return { lineGst, orderItemRow };
        })
      );

      const orderItems = lineBuilt.map((b) => b.orderItemRow);
      const lineTaxBreakdown = lineBuilt.map((b) => b.lineGst);
      const gstSummary = buildOrderGstSummary({
        lineTaxBreakdown,
        supplierState,
        billingState: billingAddress?.state || billingState,
        placeOfSupplyState: billingState,
        intraStateTax
      });
      const totalAmount = gstSummary.totalAmount;
      const roundedOrderAmount = toMoney(totalAmount);

      let creditCheck = null;
      if (poPaymentMethod === 'credit') {
        creditCheck = await validateCreditForOrder({
          supplierId: supplier.id,
          buyerUserId: req.userId,
          orderAmount: totalAmount
        });
        if (!creditCheck.payLaterOffered || !creditCheck.allowed) {
          throw createHttpError(
            400,
            `Pay later not available for "${group.vendorName}": ${creditCheck.message} Use online, COD, bank transfer, or card to place this order.`
          );
        }
      }
      const selectedCreditPeriodDays = Math.max(
        1,
        Math.floor(Number(creditCheck?.creditPeriodDays || 30) || 30)
      );
      const settlementDueAt =
        poPaymentMethod === 'credit'
          ? new Date(Date.now() + selectedCreditPeriodDays * 86400000).toISOString()
          : null;

      const groupItemDetails = (Array.isArray(group.items) ? group.items : []).map((line) => ({
        name: line.name || 'Item',
        quantity: Number(line.quantity) || 0,
        unit: line.unit || 'nos',
        price: Number(line.price) || 0,
        basePrice: Number(line.basePrice) || Number(line.price) || 0,
        productId: line.productId || null,
        supplierProductId: line.supplierProductId || null,
        asin: line.asin || null,
        variantAsin: line.variantAsin || null,
        variantKey: line.variantKey || null,
        productIdentification: line.productIdentification || null,
        specifications:
          line.specifications && typeof line.specifications === 'object' && !Array.isArray(line.specifications)
            ? line.specifications
            : {},
        images: Array.isArray(line.images) ? line.images.filter(Boolean) : [],
        productImage: line.productImage || null,
        lineTotal: (Number(line.quantity) || 0) * (Number(line.price) || 0)
      }));

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
          return {
            id: recentDuplicate.id,
            orderNumber: recentDuplicate.order_number,
            supplierId: supplier.id,
            supplier: group.vendorName,
            totalAmount: existingAmount,
            requiredDate: expectedDeliveryDate,
            paymentMethod: toApiVaultPaymentMethod(poPaymentMethod),
            paymentStatus: poPaymentStatus,
            deliveryDestination,
            shippingAddress: mapToDeliveryAddress(shippingAddress),
            billingAddress: mapToDeliveryAddress(billingAddress),
            gstin: hasGstin ? profileGstin : null,
            items: groupItemDetails,
            deduplicated: true
          };
        }
      }
      if (isVaultCheckout && walletRemainingBalance !== null) {
        if (roundedOrderAmount > walletRemainingBalance) {
          const shortage = toMoney(roundedOrderAmount - walletRemainingBalance);
          throw createHttpError(
            400,
            `Insufficient vault balance for "${group.vendorName || 'selected supplier'}". Available ₹${walletRemainingBalance.toLocaleString(
              'en-IN'
            )}, required ₹${roundedOrderAmount.toLocaleString('en-IN')}, shortage ₹${shortage.toLocaleString(
              'en-IN'
            )}.`
          );
        }
        walletRemainingBalance = toMoney(walletRemainingBalance - roundedOrderAmount);
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
                taxType: gstSummary.taxType,
                supplierState: gstSummary.supplierState,
                billingState: gstSummary.billingState,
                placeOfSupplyState: gstSummary.placeOfSupplyState,
                intraStateTax: gstSummary.intraStateTax,
                subtotalAmount: gstSummary.subtotalAmount,
                taxAmount: gstSummary.taxAmount,
                igstAmount: gstSummary.igstAmount,
                cgstAmount: gstSummary.cgstAmount,
                sgstAmount: gstSummary.sgstAmount,
                totalAmount: gstSummary.totalAmount
              },
              ...(poPaymentMethod === 'credit'
                ? {
                    payLater: {
                      settlementPeriodDays: selectedCreditPeriodDays,
                      settlementDueAt,
                      outstandingAtOrderTime: Number(creditCheck?.outstanding || 0),
                      availableCreditAtOrderTime: Number(creditCheck?.available || 0)
                    }
                  }
                : paymentDetails
                  ? { paymentDetails }
                  : {}),
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
        const constraintMsg = String(orderError?.message || '');
        if (/orders_payment_method_check|payment_method/i.test(constraintMsg)) {
          const err = new Error(
            'Database is missing vault payment_method support. Run backend/sql/migration_payment_method_wallet_to_vault.sql in Supabase SQL Editor, then retry.'
          );
          err.statusCode = 500;
          throw err;
        }
        const err = new Error(orderError?.message || 'Failed to create order');
        err.statusCode = 500;
        throw err;
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
        const dbCode = String(itemsError?.code || '');
        const details = String(itemsError?.details || '');
        const message = String(itemsError?.message || '');
        const quantityConstraintIssue =
          dbCode === '22P02' ||
          (dbCode === '23514' && /quantity/i.test(details + message)) ||
          /quantity/i.test(message) ||
          /quantity/i.test(details);
        const err = new Error(
          quantityConstraintIssue
            ? 'One or more line quantities are invalid. Please set a quantity of at least 1 and try again.'
            : (itemsError?.message || 'Failed to create order items')
        );
        err.statusCode = quantityConstraintIssue ? 400 : 500;
        throw err;
      }

      // Inventory: consume checkout hold (deducts seller stock once).
      try {
        const orderItemBySupplierProductId = {};
        for (const inserted of insertedItems || []) {
          if (!inserted?.supplier_product_id) continue;
          orderItemBySupplierProductId[inserted.supplier_product_id] = {
            orderId: order.id,
            orderItemId: inserted.id
          };
        }

        const groupLines = (Array.isArray(group.items) ? group.items : [])
          .map((item) => ({
            supplierProductId: String(item?.supplierProductId || '').trim(),
            quantity: Number(item?.quantity) || 0
          }))
          .filter((line) => line.supplierProductId && line.quantity > 0);

        await consumeCheckoutReservationsForOrder({
          buyerUserId: req.userId,
          source: CHECKOUT_SOURCES.SP_PO,
          checkoutSessionId,
          lines: groupLines,
          orderItemBySupplierProductId
        });
      } catch (invErr) {
        logger.error('[PO] reservation consume error:', invErr);
        await supabase.from('order_items').delete().eq('order_id', order.id);
        await supabase.from('orders').delete().eq('id', order.id);
        throw createHttpError(400, invErr?.message || 'Failed to finalize inventory for purchase order');
      }

      // Create notifications for supplier and the service provider about the new order
      try {
        const serviceProviderName =
          String(serviceProvider?.name || '').trim() ||
          String(serviceProvider?.company || '').trim() ||
          'Service Provider';
        const supplierName =
          String(group?.vendorName || supplier?.name || supplier?.company || '').trim() ||
          'Supplier';

        await insertNotification(
          {
            user_id: supplier.id,
            type: 'order_status',
            title: 'New Order Received',
            message: `You have received a new order ${order.order_number} from ${serviceProviderName} for ₹${totalAmount.toLocaleString('en-IN')}`,
            related_order_id: order.id,
            is_read: false,
            metadata: {
              orderNumber: order.order_number,
              newStatus: order.status || 'pending',
              event: 'order_created'
            }
          },
          supabase
        );

        await insertNotification(
          {
            user_id: req.userId,
            type: 'order_status',
            title: `Order placed: ${order.order_number}`,
            message: `Your order ${order.order_number} was placed with ${supplierName} for ₹${totalAmount.toLocaleString('en-IN')}.`,
            related_order_id: order.id,
            is_read: false,
            metadata: {
              orderNumber: order.order_number,
              newStatus: order.status || 'pending',
              supplierId: supplier.id,
              event: 'order_created'
            }
          },
          supabase
        );

        logger.debug(
          `Notifications created for supplier ${supplier.id} and service provider ${req.userId} about new order ${order.order_number}`
        );
      } catch (notifError) {
        logger.error('Error creating order notification:', notifError);
        // Don't fail the order creation if notification creation fails
      }

      const createdOrder = {
        id: order.id,
        orderNumber: order.order_number,
        supplierId: supplier.id,
        transportGroupId: group.transportGroupId || group.vendorId,
        supplier: group.vendorName,
        totalAmount: totalAmount,
        requiredDate: expectedDeliveryDate,
        paymentMethod: toApiVaultPaymentMethod(poPaymentMethod),
        paymentStatus: poPaymentStatus,
        deliveryDestination,
        shippingAddress: mapToDeliveryAddress(shippingAddress),
        billingAddress: mapToDeliveryAddress(billingAddress),
        gstin: hasGstin ? profileGstin : null,
        items: groupItemDetails
      };

      if (poPaymentMethod === 'credit') {
        try {
          await maybeNotifySupplierCreditAlert({
            supplierId: supplier.id,
            buyerUserId: req.userId,
            partyName:
              serviceProvider?.name ||
              serviceProvider?.company ||
              'Service provider buyer'
          });
        } catch (creditNotifyErr) {
          logger.error('[PO] credit limit notification error (non-fatal):', creditNotifyErr);
        }
      }
      return createdOrder;
    };

    const groupOrders = await runWithConcurrency(poGroups, GROUP_CREATE_CONCURRENCY, processPoGroup);
    createdOrders.push(...groupOrders.filter(Boolean));

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
    const isProduction = process.env.NODE_ENV === 'production';
    const detail =
      isProduction && statusCode >= 500
        ? 'Failed to create purchase orders'
        : (error?.message || 'Failed to create purchase orders');
    res.status(statusCode).json({
      status: 'error',
      message: detail,
      ...(isProduction && statusCode >= 500 ? {} : { error: detail })
    });
  }
});

}
