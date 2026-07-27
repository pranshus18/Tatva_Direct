import PDFKit from 'pdfkit';
import { supabase } from '../config/supabase.js';
import { ORDER_ATTACHMENTS_BUCKET, uploadFile } from './storage.js';
import { formatPlatformDate, formatPlatformDateTime } from '../utils/dateTime.js';

// pdfkit is CommonJS; in ESM builds the default import might be the module namespace.
const PDFDocument = PDFKit?.default || PDFKit;
const BRAND_BLUE = '#5b4fe5';
const HEADING = '#1f2937';
const BODY = '#374151';
const GRID = '#e5e7eb';

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function formatINR(amount) {
  const n = Number(amount || 0);
  return `INR ${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatSpecs(spec) {
  if (spec === null || spec === undefined || spec === '') return '';
  if (typeof spec === 'string') return spec.trim();
  if (typeof spec === 'object') {
    try {
      const entries = Object.entries(spec).filter(([, v]) => v !== null && v !== undefined && v !== '');
      if (!entries.length) return '';
      return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
    } catch {
      return JSON.stringify(spec);
    }
  }
  return String(spec);
}

function channelLabel(channel) {
  const c = safeString(channel).toLowerCase();
  if (c === 'offline_sale') return 'Offline (POS)';
  if (c === 'online_sale') return 'Online (direct)';
  // PO flow is created & paid through the app (Razorpay / mark paid / bank) — treat as online B2B.
  if (c === 'b2b_po') return 'Online B2B (purchase order)';
  if (c === '') return '—';
  return c || '—';
}

function buildTrackingLine({ brandModel } = {}) {
  const parts = [brandModel]
    .map((p) => (p === null || p === undefined ? '' : String(p).trim()))
    .filter(Boolean);
  return parts.length ? parts.join('-') : '';
}

function formatAddress(address = {}) {
  const parts = [
    address?.line1 || address?.street,
    address?.line2,
    address?.city,
    address?.state,
    address?.pincode || address?.zipCode,
    address?.country
  ]
    .map((part) => safeString(part))
    .filter(Boolean);
  return parts.join(', ');
}

function getTransportBillFromOrder(order) {
  const tb = order?.delivery_address?.transportBill;
  if (!tb || typeof tb !== 'object') return null;
  const amt = Number(tb.amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  return {
    amount: Math.round(amt * 100) / 100,
    provider: tb.provider != null ? String(tb.provider) : ''
  };
}

function normalizePartyAddress(address = {}, profile = {}) {
  const base = address && typeof address === 'object' ? address : {};
  const branches = Array.isArray(profile?.branches) ? profile.branches : [];
  const firstBranch = branches.find((b) => b && typeof b === 'object') || {};
  return {
    line1: base.line1 || base.street || firstBranch.line1 || firstBranch.address || '',
    line2: base.line2 || firstBranch.line2 || '',
    city: base.city || firstBranch.city || '',
    state: base.state || firstBranch.state || '',
    pincode: base.pincode || base.zipCode || firstBranch.pincode || firstBranch.zipCode || '',
    country: base.country || firstBranch.country || ''
  };
}

/**
 * Full order graph for invoice PDFs (line items + catalog joins).
 */
export async function loadOrderForInvoicePdf(orderId) {
  if (!orderId) return null;
  const { data, error } = await supabase
    .from('orders')
    .select(
      `
      *,
      order_items (
        *,
        product:products (*)
      ),
      supplier:users!orders_supplier_id_fkey (id, name, company, email, phone, address, profile),
      service_provider:users!orders_service_provider_id_fkey (id, name, company, email, phone, address, profile)
    `
    )
    .eq('id', orderId)
    .maybeSingle();

  if (error) {
    console.error('[InvoicePDF] loadOrderForInvoicePdf error:', error);
    return null;
  }
  return data;
}

async function fetchProductVariantsByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (!unique.length) return new Map();
  try {
    const { data, error } = await supabase
      .from('product_variants')
      .select(
        'id, variant_name, variant_key, variant_asin, gtin, mpn, brand, canonical_attributes, unit, pack_size'
      )
      .in('id', unique);
    if (error) {
      console.warn('[InvoicePDF] product_variants fetch skipped:', error.message);
      return new Map();
    }
    return new Map((data || []).map((pv) => [pv.id, pv]));
  } catch (e) {
    console.warn('[InvoicePDF] product_variants fetch failed:', e?.message || e);
    return new Map();
  }
}

/**
 * Enrich order line items with supplier_product + product_variant data for clear invoices.
 */
async function enrichItemsForInvoice(orderItems) {
  const items = Array.isArray(orderItems) ? orderItems : [];
  const supplierProductIds = [...new Set(items.map((it) => it?.supplier_product_id).filter(Boolean))];

  if (supplierProductIds.length === 0) {
    return items.map((it) => ({ ...it, _supplierProduct: null, _productVariant: null }));
  }

  const { data: supplierProductRows, error } = await supabase
    .from('supplier_products')
    .select('*')
    .in('id', supplierProductIds);

  if (error) {
    console.error('[InvoicePDF] supplier_products fetch failed:', error);
    return items.map((it) => ({ ...it, _supplierProduct: null, _productVariant: null }));
  }

  const spMap = new Map((supplierProductRows || []).map((sp) => [sp.id, sp]));
  const variantIds = [...new Set((supplierProductRows || []).map((sp) => sp.product_variant_id).filter(Boolean))];
  const pvMap = await fetchProductVariantsByIds(variantIds);

  return items.map((it) => {
    const sp = spMap.get(it?.supplier_product_id);
    const attrs = sp?.attributes && typeof sp.attributes === 'object' ? sp.attributes : {};
    const pv = sp?.product_variant_id ? pvMap.get(sp.product_variant_id) : null;

    return {
      ...it,
      _supplierProduct: sp || null,
      _productVariant: pv || null,
      brandModel: attrs.brandModel ?? it?.brandModel,
      barcode: attrs.barcode ?? attrs.ean ?? attrs.gtin ?? attrs.upc ?? it?.barcode
    };
  });
}

function createInvoicePdfBuffer({ order, invoice, items, receiptNumber = null }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const orderNumber =
        safeString(order?.order_number) || safeString(order?.orderNumber) || safeString(order?.id);
      const invoiceNumber = safeString(invoice?.invoice_number);
      const receiptRef = safeString(receiptNumber) || '-';
      const pageWidth = doc.page.width;
      const pageLeft = doc.page.margins.left;
      const contentWidth = pageWidth - doc.page.margins.left - doc.page.margins.right;
      const section = (title) => {
        doc.x = pageLeft;
        doc.moveDown(0.45);
        doc.fontSize(14).font('Helvetica-Bold').fillColor(HEADING).text(title);
        const y = doc.y + 2;
        doc.save();
        doc.moveTo(pageLeft, y).lineTo(pageLeft + contentWidth, y).lineWidth(0.8).strokeColor(BRAND_BLUE).stroke();
        doc.restore();
        doc.moveDown(0.45);
        doc.x = pageLeft;
        doc.fillColor('#000000');
      };

      doc.fontSize(19).font('Helvetica-Bold').fillColor(HEADING).text(`Order Details - ${orderNumber}`);
      doc.moveDown(0.4);
      doc.fontSize(10.2).font('Helvetica').fillColor(BODY);
      doc.text(`Order: ${orderNumber}`);
      doc.text(`Invoice: ${invoiceNumber}`);
      doc.text(`Receipt: ${receiptRef}`);
      doc.text(`Sales channel: ${channelLabel(order?.channel)}`);
      doc.text(
        `Issued date: ${
          invoice?.issued_at ? formatPlatformDate(invoice.issued_at) : formatPlatformDate(new Date())
        }`
      );
      doc.fillColor('#000000');

      const sup = order?.supplier || {};
      const supplierAddress = normalizePartyAddress(sup?.address || {}, sup?.profile || {});
      section('Supplier Information');
      doc.fontSize(10).font('Helvetica');
      doc.text(`Name: ${safeString(sup?.name || '-')}`);
      doc.text(`Company: ${safeString(sup?.company || '-')}`);
      doc.text(`Email: ${safeString(sup?.email || '-')}`);
      doc.text(`Address: ${formatAddress(supplierAddress) || '-'}`);

      section('Order Items');
      const tableStartX = pageLeft;
      const tableTop = doc.y;
      const colProduct = Math.floor(contentWidth * 0.58);
      const colQty = Math.floor(contentWidth * 0.14);
      const colUnit = Math.floor(contentWidth * 0.14);
      const colTotal = contentWidth - colProduct - colQty - colUnit;
      const headerHeight = 22;
      doc.save();
      doc.rect(tableStartX, tableTop, contentWidth, headerHeight).fill(BRAND_BLUE);
      doc.restore();
      doc.fontSize(9.2).font('Helvetica-Bold').fillColor('#ffffff');
      doc.text('PRODUCT', tableStartX + 7, tableTop + 7, { width: colProduct - 12 });
      doc.text('QUANTITY', tableStartX + colProduct + 7, tableTop + 7, { width: colQty - 12 });
      doc.text('UNIT PRICE', tableStartX + colProduct + colQty + 7, tableTop + 7, { width: colUnit - 12 });
      doc.text('TOTAL', tableStartX + colProduct + colQty + colUnit + 7, tableTop + 7, { width: colTotal - 12 });
      doc.fillColor('#000000');
      doc.y = tableTop + headerHeight + 8;
      doc.x = pageLeft;

      const transportBillRow = getTransportBillFromOrder(order);

      if (!items.length && !transportBillRow) {
        doc.fontSize(10).font('Helvetica').text('No line items found.');
      } else {
        items.forEach((item) => {
          const rowTop = doc.y;
          const product = item?.product || {};
          const productName = product?.name || item?.product_name || item?.name || 'Product';
          const specs = formatSpecs(item?.specifications || product?.specifications);
          const tracking = buildTrackingLine({
            brandModel: item?.brandModel
          });
          const productCell = [
            productName,
            specs ? specs : null,
            tracking ? `Trace: ${tracking}` : null
          ]
            .filter(Boolean)
            .join('\n');

          doc.fontSize(9.2).font('Helvetica').text(productCell, tableStartX + 6, rowTop, { width: colProduct - 12 });
          doc.text(`${Number(item?.quantity || 0)} ${safeString(product?.unit || '').trim() || 'units'}`, tableStartX + colProduct + 6, rowTop, {
            width: colQty - 12
          });
          doc.text(formatINR(item?.unit_price ?? item?.unitPrice), tableStartX + colProduct + colQty + 6, rowTop, {
            width: colUnit - 12
          });
          doc.text(formatINR(item?.total_price ?? item?.totalPrice), tableStartX + colProduct + colQty + colUnit + 6, rowTop, {
            width: colTotal - 12
          });

          const rowBottom = Math.max(doc.y, rowTop + 40);
          doc.save();
          doc
            .moveTo(tableStartX, rowBottom + 2)
            .lineTo(tableStartX + contentWidth, rowBottom + 2)
            .lineWidth(0.4)
            .strokeColor(GRID)
            .stroke();
          doc.restore();
          doc.y = rowBottom + 6;
          doc.x = pageLeft;
          if (doc.y > doc.page.height - 180) {
            doc.addPage();
            doc.x = pageLeft;
          }
        });
        if (transportBillRow) {
          const rowTop = doc.y;
          const provLine = transportBillRow.provider ? `\nCarrier: ${transportBillRow.provider}` : '';
          doc.fontSize(9.2).font('Helvetica').text(
            `Transport / courier (quoted)${provLine}\nQuoted logistics charge (incl. carrier fees as applicable)`,
            tableStartX + 6,
            rowTop,
            { width: colProduct - 12 }
          );
          doc.text('—', tableStartX + colProduct + 6, rowTop, { width: colQty - 12 });
          doc.text('—', tableStartX + colProduct + colQty + 6, rowTop, { width: colUnit - 12 });
          doc.text(formatINR(transportBillRow.amount), tableStartX + colProduct + colQty + colUnit + 6, rowTop, {
            width: colTotal - 12
          });
          const rowBottom = Math.max(doc.y, rowTop + 40);
          doc.save();
          doc
            .moveTo(tableStartX, rowBottom + 2)
            .lineTo(tableStartX + contentWidth, rowBottom + 2)
            .lineWidth(0.4)
            .strokeColor(GRID)
            .stroke();
          doc.restore();
          doc.y = rowBottom + 6;
          doc.x = pageLeft;
          if (doc.y > doc.page.height - 180) {
            doc.addPage();
            doc.x = pageLeft;
          }
        }
      }

      const gstSummary = invoice?.metadata?.gstSummary || order?.delivery_address?.gstSummary || null;
      section('Total Amount');
      if (gstSummary) {
        doc.fontSize(10.3).font('Helvetica');
        doc.text(`Taxable subtotal (products): ${formatINR(gstSummary.subtotalAmount)}`);
        if (gstSummary.taxType === 'IGST') {
          doc.text(`GST type: IGST`);
          doc.text(`IGST: ${formatINR(gstSummary.igstAmount || gstSummary.taxAmount)}`);
        } else {
          doc.text(`GST type: CGST + SGST`);
          doc.text(`CGST: ${formatINR(gstSummary.cgstAmount)} | SGST: ${formatINR(gstSummary.sgstAmount)}`);
        }
        doc.text(`Total GST (products): ${formatINR(gstSummary.taxAmount)}`);
        doc.text(`Products total (incl. GST): ${formatINR(gstSummary.totalAmount)}`);
      }
      if (transportBillRow) {
        doc.moveDown(0.12);
        doc.fontSize(10.1).fillColor('#334155').text(
          'Courier / transport per selected logistics quote (may include carrier fees and taxes).',
          { width: contentWidth }
        );
        doc.fillColor('#000000');
        doc.fontSize(10.3).font('Helvetica');
        const prov = transportBillRow.provider ? ` — ${transportBillRow.provider}` : '';
        doc.text(`Transport / courier${prov}: ${formatINR(transportBillRow.amount)}`);
      }
      doc.moveDown(0.08);
      doc.fontSize(11.5).font('Helvetica-Bold');
      doc.text(`Grand total (products + transport): ${formatINR(order?.total_amount ?? order?.totalAmount)}`);

      const addr = order?.delivery_address || {};
      section('Delivery Address');
      doc.fontSize(10.3).font('Helvetica');
      doc.text(formatAddress(addr) || '-');
      if (addr?.deliveryDestination) {
        doc.text(`Delivery destination: ${addr.deliveryDestination === 'billing' ? 'Billing address' : 'Shipping address'}`);
      }
      if (addr?.shippingAddress) doc.text(`Shipping: ${formatAddress(addr.shippingAddress)}`);
      if (addr?.billingAddress) doc.text(`Billing (GST): ${formatAddress(addr.billingAddress)}`);

      section('Order Status & Dates');
      doc.fontSize(10).font('Helvetica');
      doc.text(`Status: ${safeString(order?.status || '-')}`);
      doc.text(`Payment Status: ${safeString(order?.payment_status || '-')}`);
      doc.text(`Payment Method: ${safeString(order?.payment_method || '-')}`);
      doc.text(`Order Date: ${order?.created_at ? formatPlatformDateTime(order.created_at, '-') : '-'}`);
      doc.text(
        `Expected Dispatch: ${
          order?.expected_delivery_date ? formatPlatformDate(order.expected_delivery_date, '-') : '-'
        }`
      );
      doc.text(
        `Actual Delivery: ${order?.actual_delivery_date ? formatPlatformDate(order.actual_delivery_date, '-') : '-'}`
      );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export async function generateAndUploadInvoicePdf({ order, invoice }) {
  if (!order) throw new Error('order is required');
  if (!invoice) throw new Error('invoice is required');

  let workingOrder = order;
  const rawItems = Array.isArray(order?.order_items) ? order.order_items : Array.isArray(order?.items) ? order.items : [];
  if (!rawItems.length && order?.id) {
    const loaded = await loadOrderForInvoicePdf(order.id);
    if (loaded) workingOrder = loaded;
  }

  const finalRaw = Array.isArray(workingOrder?.order_items)
    ? workingOrder.order_items
    : Array.isArray(workingOrder?.items)
      ? workingOrder.items
      : [];
  const items = await enrichItemsForInvoice(finalRaw);
  let receiptNumber = null;
  if (workingOrder?.id) {
    const { data: receiptRow } = await supabase
      .from('payment_receipts')
      .select('receipt_number')
      .eq('order_id', workingOrder.id)
      .maybeSingle();
    receiptNumber = receiptRow?.receipt_number || null;
  }

  const pdfBuffer = await createInvoicePdfBuffer({
    order: workingOrder,
    invoice,
    items,
    receiptNumber
  });

  const invoiceNumber = safeString(invoice?.invoice_number) || `INV-${safeString(workingOrder?.order_number)}`;
  const path = `${workingOrder.id}/invoice/${invoiceNumber.replaceAll('/', '-')}.pdf`;

  let url;
  let storedPath;
  try {
    const up = await uploadFile(ORDER_ATTACHMENTS_BUCKET, path, pdfBuffer, {
      contentType: 'application/pdf',
      upsert: true
    });
    url = up.url;
    storedPath = up.path;
  } catch (e) {
    const msg = e?.message || String(e);
    console.warn(
      `[invoicePdf] Upload skipped (${msg}). Create Storage bucket "${ORDER_ATTACHMENTS_BUCKET}" in Supabase or set SUPABASE_STORAGE_ORDER_BUCKET.`
    );
    return { pdfUrl: null, pdfPath: null };
  }

  return { pdfUrl: url, pdfPath: storedPath };
}

export async function saveInvoicePdfUrlToInvoice({ orderId, pdfUrl, pdfPath }) {
  const generatedAt = new Date().toISOString();

  const { data: existingInvoice } = await supabase
    .from('invoices')
    .select('id, metadata')
    .eq('order_id', orderId)
    .maybeSingle();

  // If invoice row doesn't exist, we cannot attach the URL here.
  if (!existingInvoice) return null;

  const existingMetadata = existingInvoice?.metadata || {};
  const metadata = {
    ...existingMetadata,
    pdfUrl,
    pdfPath,
    pdfGeneratedAt: generatedAt
  };

  const { data: updated, error } = await supabase
    .from('invoices')
    .update({ metadata })
    .eq('order_id', orderId)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[InvoicePDF] Failed to update invoice metadata:', error);
    return null;
  }

  return updated || null;
}
