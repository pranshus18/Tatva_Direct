import PDFKit from 'pdfkit';
import { supabase } from '../config/supabase.js';
import { ORDER_ATTACHMENTS_BUCKET, uploadFile } from './storage.js';
import {
  assertGstStateInputs,
  assertSupplierProductTaxRates,
  computeLineGst,
  extractUserState,
  isSameIndianState,
  sumGstLines
} from './gstService.js';
import { formatPlatformDate, formatPlatformDateTime } from '../utils/dateTime.js';

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

function parseSpecObject(specifications) {
  if (!specifications) return {};
  if (typeof specifications === 'object') return specifications;
  if (typeof specifications !== 'string') return {};
  try {
    return JSON.parse(specifications);
  } catch {
    return {};
  }
}

function getTransportBill(order) {
  const tb = order?.delivery_address?.transportBill;
  if (!tb || typeof tb !== 'object') return null;
  const amt = Number(tb.amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  return {
    amount: Math.round(amt * 100) / 100,
    provider: tb.provider != null ? String(tb.provider) : '',
    currency: tb.currency || 'INR',
    source: tb.source != null ? String(tb.source) : ''
  };
}

export async function loadReceiptItemsAndGst({ order, supplier, serviceProvider }) {
  const { data: rows } = await supabase
    .from('order_items')
    .select('id, quantity, unit_price, total_price, supplier_product_id, specifications, product:products(name, unit)')
    .eq('order_id', order.id);

  const items = rows || [];
  const supplierProductIds = [...new Set(items.map((it) => it?.supplier_product_id).filter(Boolean))];
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
    context: 'Receipt GST calculation'
  });
  const intraState = isSameIndianState(supplierState, billingState);

  const enrichedItems = items.map((item) => {
    const qty = Number(item?.quantity || 0);
    const unitPrice = Number(item?.unit_price || 0);
    const taxableAmount = Number(item?.total_price || qty * unitPrice);
    const spTax = supplierProductsById.get(item?.supplier_product_id) || {};
    assertSupplierProductTaxRates({
      supplierProduct: spTax,
      context: 'Receipt GST calculation',
      productRef: `supplier_product_id ${item?.supplier_product_id || 'unknown'}`
    });
    const lineGst = computeLineGst({
      taxableAmount,
      igstRate: spTax?.igst_rate,
      cgstRate: spTax?.cgst_rate,
      sgstRate: spTax?.sgst_rate,
      intraState
    });
    return {
      ...item,
      lineGst
    };
  });

  const gstSummary = sumGstLines(enrichedItems.map((it) => it.lineGst));
  return { items: enrichedItems, gstSummary };
}

export function createReceiptPdfBuffer({ receipt, order, supplier, serviceProvider, items = [], gstSummary = null }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

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

      doc.fontSize(19).font('Helvetica-Bold').fillColor(HEADING).text(`Order Details - ${safeString(order?.order_number)}`);
      doc.moveDown(0.4);
      doc.fontSize(10.2).font('Helvetica').fillColor(BODY);
      doc.text(`Receipt: ${safeString(receipt?.receipt_number)}`);
      doc.text(`Order: ${safeString(order?.order_number)}`);
      doc.text(`Paid At: ${receipt?.paid_at ? formatPlatformDateTime(receipt.paid_at) : formatPlatformDateTime(new Date())}`);
      doc.fillColor('#000000');

      section('Supplier Information');
      doc.fontSize(10).font('Helvetica');
      const supplierAddress = normalizePartyAddress(supplier?.address || {}, supplier?.profile || {});
      doc.text(`Name: ${safeString(supplier?.name || '-')}`);
      doc.text(`Company: ${safeString(supplier?.company || '-')}`);
      doc.text(`Email: ${safeString(supplier?.email || '-')}`);
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

      const transportBillRow = getTransportBill(order);

      if (!items.length && !transportBillRow) {
        doc.fontSize(10).font('Helvetica').text('No line items found.');
      } else {
        items.forEach((item, idx) => {
          const qty = Number(item?.quantity || 0);
          const unitPrice = Number(item?.unit_price || 0);
          const taxableAmount = Number(item?.total_price || qty * unitPrice);
          const lineGst = item?.lineGst || {};
          const lineName = item?.product?.name || `Item ${idx + 1}`;
          const lineUnit = item?.product?.unit || 'units';
          const lineTaxLabel =
            lineGst?.taxType === 'IGST'
              ? `IGST ${Number(lineGst?.igstRate || 0)}%`
              : `CGST ${Number(lineGst?.cgstRate || 0)}% + SGST ${Number(lineGst?.sgstRate || 0)}%`;

          const rowTop = doc.y;
          doc.fontSize(9.2).font('Helvetica').text(
            `${lineName}\n${lineTaxLabel} = ${formatINR(lineGst?.taxAmount || 0)}\nLine total (incl GST): ${formatINR(
              lineGst?.totalAmount || taxableAmount
            )}`,
            tableStartX + 6,
            rowTop,
            { width: colProduct - 12 }
          );
          doc.text(`${qty} ${lineUnit}`, tableStartX + colProduct + 6, rowTop, { width: colQty - 12 });
          doc.text(formatINR(unitPrice), tableStartX + colProduct + colQty + 6, rowTop, { width: colUnit - 12 });
          doc.text(formatINR(taxableAmount), tableStartX + colProduct + colQty + colUnit + 6, rowTop, {
            width: colTotal - 12
          });
          const rowBottom = Math.max(doc.y, rowTop + 40);
          doc.save();
          doc.moveTo(tableStartX, rowBottom + 2).lineTo(tableStartX + contentWidth, rowBottom + 2).lineWidth(0.4).strokeColor(GRID).stroke();
          doc.restore();
          doc.y = rowBottom + 6;
          doc.x = pageLeft;
          if (doc.y > doc.page.height - 180) {
            doc.addPage();
            doc.x = pageLeft;
          }
        });
        if (transportBillRow) {
          const tAmt = transportBillRow.amount;
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
          doc.text(formatINR(tAmt), tableStartX + colProduct + colQty + colUnit + 6, rowTop, {
            width: colTotal - 12
          });
          const rowBottom = Math.max(doc.y, rowTop + 40);
          doc.save();
          doc.moveTo(tableStartX, rowBottom + 2).lineTo(tableStartX + contentWidth, rowBottom + 2).lineWidth(0.4).strokeColor(GRID).stroke();
          doc.restore();
          doc.y = rowBottom + 6;
          doc.x = pageLeft;
          if (doc.y > doc.page.height - 180) {
            doc.addPage();
            doc.x = pageLeft;
          }
        }
      }

      const strictSummary = gstSummary && typeof gstSummary === 'object'
        ? gstSummary
        : sumGstLines(items.map((it) => it?.lineGst || {}));
      const subtotalAmount = Number(strictSummary?.subtotalAmount || 0);
      const taxAmount = Number(strictSummary?.taxAmount || 0);
      const cgstAmount = Number(strictSummary?.cgstAmount || 0);
      const sgstAmount = Number(strictSummary?.sgstAmount || 0);
      const igstAmount = Number(strictSummary?.igstAmount || 0);
      const productsInclGst = Number(strictSummary?.totalAmount || 0);
      const transportAmt = transportBillRow ? transportBillRow.amount : 0;
      const totalAmount = transportBillRow
        ? Number(order?.total_amount || (productsInclGst + transportAmt) || receipt?.amount || 0)
        : Number(receipt?.amount || order?.total_amount || (productsInclGst + transportAmt) || 0);

      doc.moveDown(0.2);
      doc.fontSize(11).font('Helvetica-Bold').text('Total Amount');
      doc.moveDown(0.15);
      doc.fontSize(10.3).font('Helvetica');
      doc.text(`Taxable subtotal (products): ${formatINR(subtotalAmount)}`);
      if (igstAmount > 0) {
        doc.text(`GST type: IGST`);
        doc.text(`IGST: ${formatINR(igstAmount || taxAmount)}`);
      } else {
        doc.text(`GST type: CGST + SGST`);
        doc.text(`CGST: ${formatINR(cgstAmount)} | SGST: ${formatINR(sgstAmount)}`);
      }
      doc.text(`Total GST (products): ${formatINR(taxAmount)}`);
      doc.text(`Products total (incl. GST): ${formatINR(productsInclGst)}`);
      if (transportBillRow) {
        doc.moveDown(0.15);
        doc.fontSize(10.1).fillColor('#334155').text(
          'Courier / transport charges are per the selected logistics quote (may include carrier fees and taxes).',
          { width: contentWidth }
        );
        doc.fillColor('#000000');
        doc.fontSize(10.3).font('Helvetica');
        const prov = transportBillRow.provider ? ` — ${transportBillRow.provider}` : '';
        doc.text(`Transport / courier${prov}: ${formatINR(transportAmt)}`);
      }
      doc.moveDown(0.12);
      doc.fontSize(11.5).font('Helvetica-Bold').text(`Grand total (products + transport): ${formatINR(totalAmount)}`);

      const deliveryAddress = order?.delivery_address || {};
      section('Delivery Address');
      doc.fontSize(10.3).font('Helvetica');
      doc.text(formatAddress(deliveryAddress) || '-');
      if (deliveryAddress?.deliveryDestination) {
        doc.text(
          `Delivery destination: ${deliveryAddress.deliveryDestination === 'billing' ? 'Billing address' : 'Shipping address'}`
        );
      }
      if (deliveryAddress?.shippingAddress) {
        doc.text(`Shipping: ${formatAddress(deliveryAddress.shippingAddress)}`);
      }
      if (deliveryAddress?.billingAddress) {
        doc.text(`Billing (GST): ${formatAddress(deliveryAddress.billingAddress)}`);
      }

      section('Order Status & Dates');
      doc.fontSize(10).font('Helvetica');
      doc.text(`Status: ${safeString(order?.status || '-')}`);
      doc.text(`Payment Status: ${safeString(order?.payment_status || '-')}`);
      doc.text(`Payment Method: ${safeString(order?.payment_method || '-')}`);
      doc.text(`Order Date: ${order?.created_at ? formatPlatformDateTime(order.created_at, '-') : '-'}`);
      doc.text(
        `Expected Delivery: ${
          order?.expected_delivery_date ? formatPlatformDate(order.expected_delivery_date, '-') : '-'
        }`
      );
      doc.text(
        `Actual Delivery: ${order?.actual_delivery_date ? formatPlatformDate(order.actual_delivery_date, '-') : '-'}`
      );

      doc.moveDown(1.2);
      doc.fontSize(10).fillColor('#475569').text(
        'This receipt confirms that payment has been recorded for the above order.',
        { align: 'left' }
      );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

export async function generateAndAttachReceiptPdf({ receipt, order, supplier, serviceProvider }) {
  if (!receipt || !order) return { pdfUrl: null, pdfPath: null, receipt: receipt || null };

  const { items, gstSummary } = await loadReceiptItemsAndGst({ order, supplier, serviceProvider });
  const pdfBuffer = await createReceiptPdfBuffer({
    receipt,
    order,
    supplier,
    serviceProvider,
    items,
    gstSummary
  });
  const filename = `${safeString(receipt.receipt_number || `RCPT-${order.order_number}`)}.pdf`.replaceAll('/', '-');
  const path = `${order.id}/receipt/${filename}`;

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
      `[receiptPdf] Upload skipped (${msg}). Create Storage bucket "${ORDER_ATTACHMENTS_BUCKET}" in Supabase (see STORAGE_BUCKETS_SETUP.md) or set SUPABASE_STORAGE_ORDER_BUCKET to your bucket name.`
    );
    return { pdfUrl: null, pdfPath: null, receipt };
  }

  const metadata = {
    ...(receipt.metadata || {}),
    pdfUrl: url,
    pdfPath: storedPath,
    pdfGeneratedAt: new Date().toISOString()
  };

  const { data: updatedReceipt } = await supabase
    .from('payment_receipts')
    .update({ metadata })
    .eq('id', receipt.id)
    .select('*')
    .maybeSingle();

  return {
    pdfUrl: url,
    pdfPath: storedPath,
    receipt: updatedReceipt || receipt
  };
}

