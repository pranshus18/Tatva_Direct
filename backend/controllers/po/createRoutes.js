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
  mapToDeliveryAddress,
  normalizeAddress,
  parseWithSchema,
  poCreateRequestSchema,
  recordInventoryMovement,
  resolveB2bPaymentFromBody,
  sumGstLines,
  supplierMatchesBrandTerminalRole,
  toLifecycleStateFromStatus
} from './poImports.js';
import {
  maybeNotifySupplierCreditAlert,
  validateCreditForOrder
} from '../../services/creditAccountService.js';

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
    const paymentDetails = payload.paymentDetails && typeof payload.paymentDetails === 'object'
      ? payload.paymentDetails
      : null;
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

      // Map items to order items format — line work runs in parallel per item for faster PO create.
      const supplierState = extractUserState(supplier);
      const billingState = billingAddress?.state || shippingAddress?.state || '';
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
          const quantity = parseFloat(item.quantity) || 0;
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

          const orderItemRow = {
            product_id: supplierProduct.product.id,
            supplier_product_id: supplierProduct.id,
            quantity: quantity,
            unit_price: unitPrice,
            total_price: taxableAmount,
            specifications: JSON.stringify({
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
          };
          return { lineGst, orderItemRow };
        })
      );

      const orderItems = lineBuilt.map((b) => b.orderItemRow);
      const lineTaxBreakdown = lineBuilt.map((b) => b.lineGst);
      const gstSummary = sumGstLines(lineTaxBreakdown);
      const totalAmount = gstSummary.totalAmount;

      if (poPaymentMethod === 'credit') {
        const creditCheck = await validateCreditForOrder({
          supplierId: supplier.id,
          buyerUserId: req.userId,
          orderAmount: totalAmount
        });
        if (!creditCheck.payLaterOffered || !creditCheck.allowed) {
          return res.status(400).json({
            status: 'error',
            message: `Pay later not available for "${group.vendorName}": ${creditCheck.message} Use online, COD, bank transfer, or card to place this order.`,
            credit: creditCheck
          });
        }
      }

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
          createdOrders.push({
            id: recentDuplicate.id,
            orderNumber: recentDuplicate.order_number,
            supplierId: supplier.id,
            supplier: group.vendorName,
            totalAmount: existingAmount,
            requiredDate: expectedDeliveryDate,
            paymentMethod: poPaymentMethod,
            paymentStatus: poPaymentStatus,
            deliveryDestination,
            shippingAddress: mapToDeliveryAddress(shippingAddress),
            billingAddress: mapToDeliveryAddress(billingAddress),
            gstin: hasGstin ? profileGstin : null,
            items: groupItemDetails,
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
              },
              ...(paymentDetails ? { paymentDetails } : {})
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
        const err = new Error(itemsError?.message || 'Failed to create order items');
        err.statusCode = 500;
        throw err;
      }

      // Record inventory movements for each ordered item (stock out) — parallel for latency.
      try {
        const itemsWithIds = insertedItems || [];
        await Promise.all(
          itemsWithIds.map(async (orderItem) => {
            const qty = parseFloat(orderItem.quantity) || 0;
            if (!qty || qty <= 0) return;

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
              return;
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
          })
        );
      } catch (invErr) {
        logger.error('[PO] Inventory movement error for B2B PO:', invErr);
        // Do not fail the order if inventory logging fails; monitor via logs.
      }

      // Create notification for the supplier about the new order
      try {
        const serviceProviderName =
          String(serviceProvider?.name || '').trim() ||
          String(serviceProvider?.company || '').trim() ||
          'Service Provider';

        await insertNotification(
          {
            user_id: supplier.id,
            type: 'order_status',
            title: 'New Order Received',
            message: `You have received a new order ${order.order_number} from ${serviceProviderName} for ₹${totalAmount.toLocaleString('en-IN')}`,
            related_order_id: order.id,
            is_read: false
          },
          supabase
        );
        
        logger.debug(`Notification created for supplier ${supplier.id} about new order ${order.order_number}`);
      } catch (notifError) {
        logger.error('Error creating order notification:', notifError);
        // Don't fail the order creation if notification creation fails
      }

      createdOrders.push({
        id: order.id,
        orderNumber: order.order_number,
        supplierId: supplier.id,
        supplier: group.vendorName,
        totalAmount: totalAmount,
        requiredDate: expectedDeliveryDate,
        paymentMethod: poPaymentMethod,
        paymentStatus: poPaymentStatus,
        deliveryDestination,
        shippingAddress: mapToDeliveryAddress(shippingAddress),
        billingAddress: mapToDeliveryAddress(billingAddress),
        gstin: hasGstin ? profileGstin : null,
        items: groupItemDetails
      });

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
    const detail = error?.message || 'Failed to create purchase orders';
    res.status(statusCode).json({
      status: 'error',
      message: detail,
      error: detail
    });
  }
});

}
