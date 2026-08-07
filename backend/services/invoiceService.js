import { supabase } from '../config/supabase.js';
import { recordInvoiceLedger } from './ledgerService.js';
import {
  assertGstStateInputs,
  assertSupplierProductTaxRates,
  computeLineGst,
  extractUserState,
  isSameIndianState,
  resolvePriceIncludesGstFromItem,
  sumGstLines
} from './gstService.js';

async function buildOrderTaxSummary(order) {
  const orderId = order?.id;
  if (!orderId) {
    return {
      taxType: null,
      subtotalAmount: 0,
      taxAmount: 0,
      igstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      totalAmount: 0
    };
  }

  const [{ data: orderItems }, { data: supplier }, { data: serviceProvider }] = await Promise.all([
    supabase
      .from('order_items')
      .select('quantity, unit_price, supplier_product_id, specifications')
      .eq('order_id', orderId),
    order?.supplier_id
      ? supabase.from('users').select('address, profile').eq('id', order.supplier_id).maybeSingle()
      : Promise.resolve({ data: null }),
    order?.service_provider_id
      ? supabase.from('users').select('address, profile').eq('id', order.service_provider_id).maybeSingle()
      : Promise.resolve({ data: null })
  ]);

  const supplierProductIds = [...new Set((orderItems || []).map((item) => item?.supplier_product_id).filter(Boolean))];
  let supplierProductsById = new Map();
  if (supplierProductIds.length > 0) {
    const { data: supplierProducts } = await supabase
      .from('supplier_products')
      .select('id, igst_rate, cgst_rate, sgst_rate')
      .in('id', supplierProductIds);
    supplierProductsById = new Map((supplierProducts || []).map((row) => [row.id, row]));
  }

  const billingState =
    order?.delivery_address?.billingAddress?.state ||
    order?.delivery_address?.state ||
    extractUserState(serviceProvider || {}) ||
    '';
  const supplierState = extractUserState(supplier || {});
  assertGstStateInputs({
    supplierState,
    billingState,
    context: 'Invoice GST calculation'
  });
  const intraStateTax = isSameIndianState(supplierState, billingState);

  const lineTaxBreakdown = (orderItems || []).map((line) => {
    const quantity = Number(line?.quantity) || 0;
    const unitPrice = Number(line?.unit_price) || 0;
    const supplierProduct = supplierProductsById.get(line?.supplier_product_id) || {};
    assertSupplierProductTaxRates({
      supplierProduct,
      context: 'Invoice GST calculation',
      productRef: `supplier_product_id ${line?.supplier_product_id || 'unknown'}`
    });
    return computeLineGst({
      taxableAmount: quantity * unitPrice,
      igstRate: supplierProduct?.igst_rate,
      cgstRate: supplierProduct?.cgst_rate,
      sgstRate: supplierProduct?.sgst_rate,
      intraState: intraStateTax,
      priceIncludesGst: resolvePriceIncludesGstFromItem(line)
    });
  });

  const totals = sumGstLines(lineTaxBreakdown);
  return {
    taxType: intraStateTax ? 'CGST_SGST' : 'IGST',
    supplierState,
    billingState,
    ...totals
  };
}

export async function getInvoiceForOrder(orderId) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();

  if (error) {
    console.error('[Invoice] getInvoiceForOrder error', error);
    throw error;
  }

  return data || null;
}

export async function createInvoiceForOrder(order, { issuedAt = null, dueDate = null } = {}) {
  if (!order) throw new Error('Order is required to create invoice');

  // Check if invoice already exists
  const existing = await getInvoiceForOrder(order.id);
  if (existing) return { invoice: existing, created: false };

  const invoiceNumber = `INV-${order.order_number}`;
  const issuedAtIso = issuedAt ? new Date(issuedAt).toISOString() : new Date().toISOString();

  const computedTax = await buildOrderTaxSummary(order);
  const totalAmount = Number(computedTax.totalAmount || 0);
  const subtotalAmount = Number(computedTax.subtotalAmount || 0);
  const taxAmount = Number(computedTax.taxAmount || 0);

  const payload = {
    invoice_number: invoiceNumber,
    order_id: order.id,
    service_provider_id: order.service_provider_id,
    supplier_id: order.supplier_id,
    billing_address: order.delivery_address || null,
    shipping_address: order.delivery_address || null,
    subtotal_amount: subtotalAmount,
    tax_amount: taxAmount,
    total_amount: totalAmount,
    currency: 'INR',
    status: 'issued',
    issued_at: issuedAtIso,
    due_date: dueDate ? new Date(dueDate).toISOString() : null,
    paid_at: null,
    metadata: {
      generatedAt: new Date().toISOString(),
      gstSummary: {
        taxType: computedTax.taxType || null,
        supplierState: computedTax.supplierState || '',
        billingState: computedTax.billingState || '',
        subtotalAmount,
        taxAmount,
        igstAmount: Number(computedTax.igstAmount || 0),
        cgstAmount: Number(computedTax.cgstAmount || 0),
        sgstAmount: Number(computedTax.sgstAmount || 0),
        totalAmount
      }
    }
  };

  const { data: inserted, error } = await supabase
    .from('invoices')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    console.error('[Invoice] createInvoiceForOrder error', error);
    throw error;
  }

  // Record ledger impact (Accounts Receivable vs Sales)
  try {
    await recordInvoiceLedger({ invoice: inserted, order });
  } catch (e) {
    console.error('[Invoice] Failed to record invoice ledger entry', e);
  }

  return { invoice: inserted, created: true };
}

