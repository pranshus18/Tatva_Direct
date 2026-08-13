import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import { recordInventoryMovement } from '../services/inventoryService.js';
import { createInvoiceForOrder } from '../services/invoiceService.js';
import { generateAndUploadInvoicePdf, saveInvoicePdfUrlToInvoice } from '../services/invoicePdfService.js';
import { createReceiptIfMissing } from '../services/paymentReceiptService.js';
import { computeLineGst, sumGstLines } from '../services/gstService.js';
import { lineMoneyTotal, parseMoney } from '../utils/money.js';
import { offlineOrderSchema, offlineReturnSchema } from '../contracts/posContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import {
  buildCreditStatus,
  linkCustomerToPhoneCreditAccount,
  maybeNotifySupplierCreditAlert,
  normalizeCustomerPhone
} from '../services/creditAccountService.js';

const router = express.Router();
const ORDER_INSERT_MAX_RETRIES = 3;

const isOrderNumberConflictError = (error) => {
  if (!error) return false;
  if (error.code === '23505') {
    const details = String(error.details || '').toLowerCase();
    const message = String(error.message || '').toLowerCase();
    return details.includes('order_number') || message.includes('order_number');
  }
  return false;
};

function normalizePosScanCode(code) {
  return String(code || '').replace(/\s+/g, '').trim();
}

function scanCodeVariants(raw) {
  const norm = normalizePosScanCode(raw);
  if (!norm) return [];
  const out = new Set([norm]);
  if (/^\d+$/.test(norm)) {
    if (norm.length === 12) out.add(`0${norm}`);
    if (norm.length === 13 && norm.startsWith('0')) out.add(norm.slice(1));
  }
  return [...out];
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function productMatchesScanVariants(p, variants) {
  if (!p) return false;
  for (const nv of variants) {
    if (!nv) continue;
    if (normalizePosScanCode(p.barcode) === nv) return true;
    if (normalizePosScanCode(p.gtin) === nv) return true;
    if (normalizePosScanCode(p.specifications?.gsku) === nv) return true;
  }
  return false;
}

function supplierOfferMatchesScanVariants(sp, variants) {
  const attrs = sp?.attributes && typeof sp.attributes === 'object' ? sp.attributes : {};
  const attrSpecs = attrs.specifications && typeof attrs.specifications === 'object' ? attrs.specifications : {};
  for (const nv of variants) {
    if (!nv) continue;
    if (normalizePosScanCode(attrs.gtin) === nv) return true;
    if (normalizePosScanCode(attrSpecs.gsku) === nv) return true;
    if (normalizePosScanCode(attrs.sku) === nv) return true;
    if (normalizePosScanCode(attrSpecs.sku) === nv) return true;
  }
  return false;
}

async function pickSupplierProductOffer(client, productId, supplierId, opts) {
  const { outletUuid = null, outletMustBeNull = false, ignoreOutlet = false, isActive, status } = opts;
  let q = client
    .from('supplier_products')
    .select('*')
    .eq('product_id', productId)
    .eq('supplier_id', supplierId)
    .eq('is_active', isActive)
    .eq('status', status);
  if (outletMustBeNull) q = q.is('outlet_id', null);
  else if (!ignoreOutlet && outletUuid) q = q.eq('outlet_id', outletUuid);
  const { data } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
  return data || null;
}

async function selectSupplierProductForPos(supabaseClient, productId, supplierId, outletIdRaw) {
  const outletUuid = isUuid(outletIdRaw) ? outletIdRaw : null;

  if (outletUuid) {
    let row = await pickSupplierProductOffer(supabaseClient, productId, supplierId, {
      outletUuid,
      isActive: true,
      status: 'approved'
    });
    if (row) return row;
    row = await pickSupplierProductOffer(supabaseClient, productId, supplierId, {
      outletMustBeNull: true,
      isActive: true,
      status: 'approved'
    });
    if (row) return row;
    row = await pickSupplierProductOffer(supabaseClient, productId, supplierId, {
      outletUuid,
      isActive: false,
      status: 'pending'
    });
    if (row) return row;
    row = await pickSupplierProductOffer(supabaseClient, productId, supplierId, {
      outletMustBeNull: true,
      isActive: false,
      status: 'pending'
    });
    if (row) return row;
  }

  let row = await pickSupplierProductOffer(supabaseClient, productId, supplierId, {
    outletMustBeNull: true,
    isActive: true,
    status: 'approved'
  });
  if (row) return row;
  row = await pickSupplierProductOffer(supabaseClient, productId, supplierId, {
    ignoreOutlet: true,
    isActive: true,
    status: 'approved'
  });
  if (row) return row;
  row = await pickSupplierProductOffer(supabaseClient, productId, supplierId, {
    outletMustBeNull: true,
    isActive: false,
    status: 'pending'
  });
  if (row) return row;
  row = await pickSupplierProductOffer(supabaseClient, productId, supplierId, {
    ignoreOutlet: true,
    isActive: false,
    status: 'pending'
  });
  return row || null;
}

async function resolvePosProductByCode(supabaseClient, code, scanTypeRaw, supplierId) {
  const variants = scanCodeVariants(code);
  if (!variants.length) return null;

  for (const nv of variants) {
    const { data: byBarcode } = await supabaseClient
      .from('products')
      .select('*')
      .eq('barcode', nv)
      .eq('is_active', true)
      .eq('status', 'approved')
      .maybeSingle();
    if (byBarcode) return { product: byBarcode, matchedSupplierProductId: null };

    const { data: byGtin } = await supabaseClient
      .from('products')
      .select('*')
      .eq('gtin', nv)
      .eq('is_active', true)
      .eq('status', 'approved')
      .maybeSingle();
    if (byGtin) return { product: byGtin, matchedSupplierProductId: null };
  }

  const { data: rowsApproved } = await supabaseClient.from('products').select('*').eq('is_active', true).eq('status', 'approved');
  const byGsku = (rowsApproved || []).find((p) => productMatchesScanVariants(p, variants));
  if (byGsku) return { product: byGsku, matchedSupplierProductId: null };

  const { data: sps } = await supabaseClient
    .from('supplier_products')
    .select('*, product:products(*)')
    .eq('supplier_id', supplierId)
    .order('created_at', { ascending: false });

  for (const sp of sps || []) {
    const p = sp.product;
    if (!p || p.is_active !== true) continue;
    if (p.status !== 'approved' && p.status !== 'pending') continue;

    const offerHit = supplierOfferMatchesScanVariants(sp, variants);
    const productHit = productMatchesScanVariants(p, variants);
    if (offerHit || productHit) {
      return { product: p, matchedSupplierProductId: offerHit ? sp.id : null };
    }
  }

  return null;
}

router.get('/product/barcode/:code', authenticateToken, async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    const outletId = (req.query.outletId || '').trim() || null;
    const scanType = req.query.scanType || 'gsku';

    if (!code) {
      return res.status(400).json({ status: 'error', message: 'Barcode is required' });
    }

    const resolved = await resolvePosProductByCode(supabase, code, scanType, req.userId);
    const product = resolved?.product || null;

    if (!product) {
      return res.status(404).json({
        status: 'error',
        message: 'Product not found for this code. Enter GTIN/barcode from catalog or internal GSKU.'
      });
    }

    const supplierId = req.userId;
    let supplierProduct = null;

    if (supplierId) {
      const pinnedSupplierProductId = resolved?.matchedSupplierProductId || null;
      if (pinnedSupplierProductId) {
        const outletUuid = isUuid(outletId) ? outletId : null;
        const pinnedQuery = supabase
          .from('supplier_products')
          .select('*')
          .eq('id', pinnedSupplierProductId)
          .eq('supplier_id', supplierId)
          .neq('status', 'rejected');
        if (outletUuid) {
          pinnedQuery.or(`outlet_id.eq.${outletUuid},outlet_id.is.null`);
        }
        const { data: pinned } = await pinnedQuery.maybeSingle();
        if (pinned) {
          supplierProduct = pinned;
        }
      }

      if (!supplierProduct) {
        supplierProduct = await selectSupplierProductForPos(supabase, product.id, supplierId, outletId);
      }
      if (!supplierProduct) {
        return res.status(404).json({
          status: 'error',
          message:
            'Product found by code, but you have no matching stock row for this location. Add the product for this outlet or as “all branches” (no outlet), and ensure it is not only pending without an offer for you.'
        });
      }
    } else {
      return res.status(403).json({ status: 'error', message: 'Supplier authentication required' });
    }

    const responseProduct = {
      ...product,
      price: supplierProduct?.price ?? product.price,
      stock: supplierProduct?.stock ?? product.stock,
      location: supplierProduct?.location ?? product.location,
      min_order_quantity: supplierProduct?.min_order_quantity ?? product.min_order_quantity,
      supplier_product_id: supplierProduct?.id || null
    };

    return res.json({ status: 'success', product: responseProduct });
  } catch (e) {
    console.error('Barcode lookup error:', e);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.post('/offline-order', authenticateToken, async (req, res) => {
  try {
    const payload = parseWithSchema(offlineOrderSchema, req.body || {});
    const { items, payment, outletId, clientOrderId, customerName, customerPhone } = payload;

    const supplierId = req.userId;
    let customerId = null;
    const trimmedPhone = (customerPhone || '').trim();
    const trimmedName = (customerName || '').trim();

    if (trimmedName || trimmedPhone) {
      try {
        if (trimmedPhone) {
          const { data: existingCustomer } = await supabase
            .from('customers')
            .select('id')
            .eq('phone', trimmedPhone)
            .maybeSingle();
          if (existingCustomer?.id) {
            customerId = existingCustomer.id;
          }
        }

        if (!customerId) {
          const { data: newCustomer } = await supabase
            .from('customers')
            .insert({
              name: trimmedName || trimmedPhone || 'Walk-in customer',
              phone: trimmedPhone || null
            })
            .select('id')
            .single();
          customerId = newCustomer?.id || null;
        }

        if (customerId && (trimmedName || trimmedPhone)) {
          await supabase.from('customer_addresses').insert({
            customer_id: customerId,
            name: trimmedName || trimmedPhone,
            phone: trimmedPhone || null
          });
        }
      } catch (custErr) {
        console.error('POS customer upsert error (non-fatal):', custErr);
      }
    }

    if (clientOrderId) {
      const { data: existing } = await supabase
        .from('orders')
        .select('id, order_number')
        .eq('supplier_id', supplierId)
        .eq('client_order_id', clientOrderId)
        .maybeSingle();
      if (existing?.id) {
        return res.json({
          status: 'success',
          orderId: existing.id,
          orderNumber: existing.order_number
        });
      }
    }

    const supplierState = '';
    const lineTaxBreakdown = [];
    for (const line of items) {
      const qty = parseFloat(line.quantity) || 0;
      const unitPrice = parseMoney(line.unit_price);
      const taxableAmount = lineMoneyTotal(unitPrice, qty);
      let igstRate = 0;
      let cgstRate = 0;
      let sgstRate = 0;
      if (line.supplier_product_id) {
        const { data: supplierProductRow } = await supabase
          .from('supplier_products')
          .select('igst_rate, cgst_rate, sgst_rate')
          .eq('id', line.supplier_product_id)
          .eq('supplier_id', supplierId)
          .maybeSingle();
        igstRate = supplierProductRow?.igst_rate || 0;
        cgstRate = supplierProductRow?.cgst_rate || 0;
        sgstRate = supplierProductRow?.sgst_rate || 0;
      }
      const lineGst = computeLineGst({
        taxableAmount,
        igstRate,
        cgstRate,
        sgstRate,
        intraState: true
      });
      lineTaxBreakdown.push(lineGst);
    }
    const gstSummary = sumGstLines(lineTaxBreakdown);
    const totalAmount = gstSummary.totalAmount;

    const paymentMethod = String(payment?.method || 'cash').toLowerCase().trim();
    const isCreditPayment = paymentMethod === 'credit';
    let paymentStatus = payment?.status || 'paid';
    let paymentDueAt = null;
    let creditPeriodDays = null;

    if (!trimmedPhone) {
      return res.status(400).json({
        status: 'error',
        message: 'Customer phone is required for offline POS sales.'
      });
    }

    if (isCreditPayment) {
      if (!trimmedName) {
        return res.status(400).json({
          status: 'error',
          message: 'Customer name is required for credit (pay later) sales.'
        });
      }
      const creditCheck = await buildCreditStatus({
        supplierId,
        customerId,
        customerName: trimmedName,
        customerPhone: trimmedPhone,
        orderAmount: totalAmount
      });
      if (!creditCheck.payLaterOffered || !creditCheck.allowed) {
        return res.status(400).json({
          status: 'error',
          message: `${creditCheck.message} Use cash, UPI, card, or bank transfer instead.`,
          credit: creditCheck
        });
      }
      paymentStatus = 'pending';
      creditPeriodDays = creditCheck.creditPeriodDays || 30;
      paymentDueAt =
        creditCheck.cycleDueAt ||
        new Date(Date.now() + Number(creditPeriodDays) * 86400000).toISOString();
    } else if (paymentMethod !== 'credit') {
      paymentStatus = payment?.status || 'paid';
    }

    let validOutletId = null;
    if (outletId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(outletId)) {
        validOutletId = outletId;
      }
    }

    let order = null;
    let orderError = null;
    for (let attempt = 0; attempt <= ORDER_INSERT_MAX_RETRIES; attempt++) {
      const orderInsertResult = await supabase
        .from('orders')
        .insert({
          service_provider_id: null,
          supplier_id: supplierId,
          boq_id: null,
          total_amount: totalAmount,
          status: 'confirmed',
          payment_status: paymentStatus,
          payment_method: paymentMethod || 'cash',
          payment_due_at: paymentDueAt,
          credit_line_days: creditPeriodDays,
          channel: 'offline_sale',
          outlet_id: validOutletId,
          customer_id: customerId || null,
          client_order_id: clientOrderId || null,
          status_history: [
            {
              status: 'confirmed',
              updatedBy: supplierId,
              notes: 'Offline POS sale',
              timestamp: new Date().toISOString()
            }
          ]
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
      console.error('Offline order creation error:', orderError);
      return res.status(500).json({ status: 'error', message: 'Failed to create offline order' });
    }

    const orderItems = items.map((item) => ({
      order_id: order.id,
      product_id: item.product_id,
      supplier_product_id: item.supplier_product_id || null,
      quantity: item.quantity,
      unit_price: item.unit_price,
      total_price: lineMoneyTotal(item.unit_price, item.quantity)
    }));

    const { error: orderTotalUpdateError } = await supabase
      .from('orders')
      .update({
        total_amount: totalAmount,
        delivery_address: {
          gstSummary: {
            taxType: 'CGST_SGST',
            supplierState,
            billingState: supplierState,
            subtotalAmount: gstSummary.subtotalAmount,
            taxAmount: gstSummary.taxAmount,
            igstAmount: gstSummary.igstAmount,
            cgstAmount: gstSummary.cgstAmount,
            sgstAmount: gstSummary.sgstAmount,
            totalAmount: gstSummary.totalAmount
          }
        }
      })
      .eq('id', order.id);
    if (orderTotalUpdateError) {
      console.error('Offline order total/tax update error:', orderTotalUpdateError);
    }

    const { data: insertedItems, error: itemsError } = await supabase.from('order_items').insert(orderItems).select();

    if (itemsError) {
      console.error('Offline order items error:', itemsError);
      await supabase.from('orders').delete().eq('id', order.id);
      return res.status(500).json({ status: 'error', message: 'Failed to create offline order items' });
    }

    let invoiceNumber = null;
    let invoicePdfUrl = null;
    let receiptNumber = null;
    try {
      const { invoice } = await createInvoiceForOrder(order);
      invoiceNumber = invoice?.invoice_number || null;
      try {
        const { pdfUrl, pdfPath } = await generateAndUploadInvoicePdf({ order, invoice });
        invoicePdfUrl = pdfUrl || null;
        if (pdfUrl) {
          await saveInvoicePdfUrlToInvoice({ orderId: order.id, pdfUrl, pdfPath });
        }
      } catch (pdfErr) {
        console.error('Offline order invoice PDF error (non-fatal):', pdfErr);
      }
    } catch (e) {
      console.error('Offline order invoice creation error (non-fatal):', e);
    }
    if (!isCreditPayment) {
      try {
        const { receipt } = await createReceiptIfMissing({
          order,
          paymentMethod: paymentMethod || null,
          paymentReference: payment?.reference || payment?.payment_reference || null,
          paidAt: payment?.paidAt || null,
          actorUserId: supplierId
        });
        receiptNumber = receipt?.receipt_number || null;
      } catch (e) {
        console.error('Offline order receipt creation error (non-fatal):', e);
      }
    }

    if (customerId && trimmedPhone) {
      try {
        await linkCustomerToPhoneCreditAccount({
          supplierId,
          customerId,
          customerPhone: normalizeCustomerPhone(trimmedPhone)
        });
      } catch (linkErr) {
        console.error('POS credit account link error (non-fatal):', linkErr);
      }
    }

    if (isCreditPayment) {
      try {
        await maybeNotifySupplierCreditAlert({
          supplierId,
          customerId,
          customerPhone: trimmedPhone,
          partyName: trimmedName || trimmedPhone || 'POS customer'
        });
      } catch (notifyErr) {
        console.error('POS credit alert notification error (non-fatal):', notifyErr);
      }
    }

    try {
      const itemsWithIds = insertedItems || [];
      for (let i = 0; i < itemsWithIds.length; i++) {
        const orderItem = itemsWithIds[i];
        const inputItem = items[i];

        if (!inputItem?.supplier_product_id) continue;

        const qty = parseFloat(orderItem.quantity) || 0;
        if (!qty || qty <= 0) continue;

        await recordInventoryMovement({
          supplierProductId: inputItem.supplier_product_id,
          supplierId,
          productId: orderItem.product_id,
          quantityChange: -qty,
          movementType: 'sale_offline',
          referenceOrderId: order.id,
          referenceOrderItemId: orderItem.id,
          notes: 'Offline POS sale',
          userId: supplierId
        });
      }
    } catch (invErr) {
      console.error('Offline order inventory movement error:', invErr);
    }

    return res.json({
      status: 'success',
      orderId: order.id,
      orderNumber: order.order_number,
      invoiceNumber,
      invoicePdfUrl,
      receiptNumber,
      gstSummary: {
        taxType: 'CGST_SGST',
        subtotalAmount: gstSummary.subtotalAmount,
        taxAmount: gstSummary.taxAmount,
        igstAmount: gstSummary.igstAmount,
        cgstAmount: gstSummary.cgstAmount,
        sgstAmount: gstSummary.sgstAmount,
        totalAmount: gstSummary.totalAmount
      }
    });
  } catch (e) {
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    console.error('Offline order error:', e);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

router.post('/offline-return', authenticateToken, async (req, res) => {
  try {
    const payload = parseWithSchema(offlineReturnSchema, req.body || {});
    const { items, referenceOrderId, outletId } = payload;

    const supplierId = req.userId;

    for (const item of items) {
      const qty = parseFloat(item.quantity) || 0;
      if (!qty || qty <= 0) continue;

      const supplierProductId = item.supplier_product_id;
      const productId = item.product_id;

      if (!supplierProductId || !productId) continue;

      await recordInventoryMovement({
        supplierProductId,
        supplierId,
        productId,
        quantityChange: qty,
        movementType: 'return_sale',
        referenceOrderId: referenceOrderId || null,
        referenceOrderItemId: null,
        notes: 'Offline POS return',
        userId: supplierId
      });
    }

    return res.json({
      status: 'success',
      message: 'Offline return recorded successfully'
    });
  } catch (e) {
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    console.error('Offline return error:', e);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

export { router as posRouter };
