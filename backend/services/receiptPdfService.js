import PDFKit from 'pdfkit';
import { supabase } from '../config/supabase.js';
import { ORDER_ATTACHMENTS_BUCKET, uploadFile } from './storage.js';
import {
  assertGstStateInputs,
  assertSupplierProductTaxRates,
  buildOrderGstSummary,
  computeLineGst,
  extractUserState,
  formatGstTaxTypeLabel,
  isSameIndianState,
  lineGstFromOrderItemSnapshot,
  resolvePriceIncludesGstFromItem,
  sumGstLines
} from './gstService.js';
import { lineMoneyTotal } from '../utils/money.js';
import { formatPlatformDate, formatPlatformDateTime } from '../utils/dateTime.js';

const PDFDocument = PDFKit?.default || PDFKit;
const BRAND_BLUE = '#5b4fe5';
const BRAND_LIGHT = '#ede9fe';
const HEADING = '#111827';
const BODY = '#374151';
const MUTED = '#6b7280';
const GRID = '#e5e7eb';
const PAID_GREEN = '#059669';
/** Bump when receipt layout fixes need re-upload for existing orders. */
export const RECEIPT_PDF_LAYOUT_VERSION = 2;

function safeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

function formatINR(amount) {
  const n = Number(amount || 0);
  // Helvetica has no ₹ glyph — use INR so amounts do not render as a broken superscript.
  return `INR ${n.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatAddress(address = {}) {
  const raw = [
    address?.line1 || address?.street,
    address?.line2,
    address?.city,
    address?.state,
    address?.pincode || address?.zipCode,
    address?.country
  ];
  const seen = new Set();
  const parts = [];
  for (const part of raw) {
    const s = safeString(part).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(s);
  }
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
  if (tb.source === 'self_ship' || tb.paymentVault === 'none') return null;
  const amt = Number(tb.amount);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  return {
    amount: Math.round(amt * 100) / 100,
    provider: tb.provider != null ? String(tb.provider) : '',
    currency: tb.currency || 'INR',
    source: tb.source != null ? String(tb.source) : ''
  };
}

function resolveReceiptDeliveryAddress(order) {
  const d = order?.delivery_address || {};
  if (d.deliveryDestination === 'billing' && d.billingAddress) {
    return formatAddress(d.billingAddress);
  }
  if (d.shippingAddress) return formatAddress(d.shippingAddress);
  return formatAddress(d);
}

function resolveCustomerParty(order, serviceProvider) {
  const d = order?.delivery_address || {};
  const spAddr = normalizePartyAddress(serviceProvider?.address || {}, serviceProvider?.profile || {});
  return {
    name: safeString(serviceProvider?.name || '-'),
    company: safeString(serviceProvider?.company || '-'),
    email: safeString(serviceProvider?.email || '-'),
    phone: safeString(serviceProvider?.phone || '-'),
    gstin: safeString(d?.gstin || serviceProvider?.profile?.gstin || ''),
    address: formatAddress(spAddr) || '-'
  };
}

export async function loadReceiptItemsAndGst({ order, supplier, serviceProvider }) {
  const { data: rows } = await supabase
    .from('order_items')
    .select('id, quantity, unit_price, total_price, supplier_product_id, specifications, product:products(name, unit)')
    .eq('order_id', order.id);

  const items = rows || [];
  const orderLevelGst = order?.delivery_address?.gstSummary || null;

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
    orderLevelGst?.placeOfSupplyState ||
    orderLevelGst?.billingState ||
    order?.delivery_address?.billingAddress?.state ||
    order?.delivery_address?.state ||
    extractUserState(serviceProvider || {}) ||
    '';
  const supplierState =
    orderLevelGst?.supplierState || extractUserState(supplier || {}) || '';
  assertGstStateInputs({
    supplierState,
    billingState,
    context: 'Receipt GST calculation'
  });
  const intraState = isSameIndianState(supplierState, billingState);

  const enrichedItems = items.map((item) => {
    const qty = Number(item?.quantity || 0);
    const unitPrice = Number(item?.unit_price || 0);
    const taxableAmount = Number(item?.total_price || lineMoneyTotal(unitPrice, qty));
    const snapshotLineGst = lineGstFromOrderItemSnapshot(item, taxableAmount);
    if (snapshotLineGst) {
      return {
        ...item,
        lineGst: snapshotLineGst
      };
    }

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
      intraState,
      priceIncludesGst: resolvePriceIncludesGstFromItem(item)
    });
    return {
      ...item,
      lineGst
    };
  });

  const gstSummary =
    orderLevelGst && typeof orderLevelGst === 'object' && orderLevelGst.totalAmount
      ? {
          ...orderLevelGst,
          taxType:
            orderLevelGst.taxType ||
            sumGstLines(enrichedItems.map((it) => it.lineGst)).taxType
        }
      : buildOrderGstSummary({
          lineTaxBreakdown: enrichedItems.map((it) => it.lineGst),
          supplierState,
          billingState,
          placeOfSupplyState: billingState,
          intraStateTax: intraState
        });
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
      const pageRight = pageWidth - doc.page.margins.right;
      const contentWidth = pageRight - pageLeft;
      const paidAt = receipt?.paid_at ? formatPlatformDateTime(receipt.paid_at) : formatPlatformDateTime(new Date());

      const drawSectionTitle = (title) => {
        doc.x = pageLeft;
        doc.moveDown(0.55);
        doc.fontSize(11).font('Helvetica-Bold').fillColor(HEADING).text(title.toUpperCase());
        doc.moveDown(0.15);
        doc.save();
        doc.moveTo(pageLeft, doc.y).lineTo(pageRight, doc.y).lineWidth(0.5).strokeColor(GRID).stroke();
        doc.restore();
        doc.moveDown(0.35);
        doc.x = pageLeft;
      };

      const drawPartyBox = (x, y, width, label, party) => {
        const padX = 10;
        const padTop = 10;
        const padBottom = 10;
        const innerW = Math.max(40, width - padX * 2);
        const gapAfterLabel = 5;
        const gapAfterName = 4;
        const lineGap = 2;

        // Measure content height first so the border never clips or overlaps lines.
        let measured = padTop;
        doc.fontSize(8).font('Helvetica-Bold');
        measured += doc.heightOfString(String(label || '').toUpperCase(), { width: innerW });
        measured += gapAfterLabel;

        doc.fontSize(10.5).font('Helvetica-Bold');
        measured += doc.heightOfString(party.name || '-', { width: innerW });
        measured += gapAfterName;

        const detailLines = [];
        if (party.company && party.company !== '-') detailLines.push(party.company);
        if (party.email && party.email !== '-') detailLines.push(party.email);
        if (party.phone && party.phone !== '-') detailLines.push(party.phone);
        if (party.gstin) detailLines.push(`GSTIN: ${party.gstin}`);

        doc.fontSize(9).font('Helvetica');
        for (const line of detailLines) {
          measured += doc.heightOfString(line, { width: innerW });
          measured += lineGap;
        }

        const address = party.address || '-';
        doc.fontSize(8.5).font('Helvetica');
        measured += doc.heightOfString(address, { width: innerW, lineGap: 1.5 });
        measured += padBottom;

        const boxHeight = Math.max(96, Math.ceil(measured));

        doc.save();
        doc.roundedRect(x, y, width, boxHeight, 4).lineWidth(0.6).strokeColor(GRID).stroke();
        doc.restore();

        let cursorY = y + padTop;
        doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED).text(String(label || '').toUpperCase(), x + padX, cursorY, {
          width: innerW
        });
        cursorY = doc.y + gapAfterLabel;

        doc.fontSize(10.5).font('Helvetica-Bold').fillColor(HEADING).text(party.name || '-', x + padX, cursorY, {
          width: innerW
        });
        cursorY = doc.y + gapAfterName;

        doc.fontSize(9).font('Helvetica').fillColor(BODY);
        for (const line of detailLines) {
          doc.text(line, x + padX, cursorY, { width: innerW });
          cursorY = doc.y + lineGap;
        }

        doc.fontSize(8.5).font('Helvetica').fillColor(MUTED).text(address, x + padX, cursorY, {
          width: innerW,
          lineGap: 1.5
        });

        return boxHeight;
      };

      // —— Header band ——
      doc.save();
      doc.rect(pageLeft, doc.page.margins.top - 18, contentWidth, 52).fill(BRAND_BLUE);
      doc.restore();
      doc.fontSize(20).font('Helvetica-Bold').fillColor('#ffffff').text('PAYMENT RECEIPT', pageLeft, doc.page.margins.top - 4);
      doc.fontSize(9).font('Helvetica').fillColor('#e0e7ff').text('Tatva Direct', pageLeft, doc.page.margins.top + 22);

      const paidBadgeW = 72;
      const paidBadgeX = pageRight - paidBadgeW;
      doc.save();
      doc.roundedRect(paidBadgeX, doc.page.margins.top + 2, paidBadgeW, 22, 3).fill(PAID_GREEN);
      doc.restore();
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff').text('PAID', paidBadgeX, doc.page.margins.top + 9, {
        width: paidBadgeW,
        align: 'center'
      });

      doc.y = doc.page.margins.top + 48;
      doc.x = pageLeft;

      // —— Meta row ——
      const metaY = doc.y;
      const colW = contentWidth / 3;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED).text('RECEIPT NO.', pageLeft, metaY);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(HEADING).text(safeString(receipt?.receipt_number || '-'), pageLeft, metaY + 12);

      doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED).text('ORDER NO.', pageLeft + colW, metaY);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(HEADING).text(safeString(order?.order_number || '-'), pageLeft + colW, metaY + 12);

      doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED).text('PAID ON', pageLeft + colW * 2, metaY);
      doc.fontSize(10).font('Helvetica').fillColor(HEADING).text(paidAt, pageLeft + colW * 2, metaY + 12, {
        width: colW
      });

      doc.y = metaY + 38;

      // —— Bill From / Bill To ——
      const supplierAddress = normalizePartyAddress(supplier?.address || {}, supplier?.profile || {});
      const supplierParty = {
        name: safeString(supplier?.name || '-'),
        company: safeString(supplier?.company || '-'),
        email: safeString(supplier?.email || '-'),
        phone: safeString(supplier?.phone || '-'),
        gstin: '',
        address: formatAddress(supplierAddress) || '-'
      };
      const customerParty = resolveCustomerParty(order, serviceProvider);
      const boxGap = 14;
      const boxW = (contentWidth - boxGap) / 2;
      const boxesTop = doc.y;
      const supplierBoxHeight = drawPartyBox(pageLeft, boxesTop, boxW, 'Sold By (Supplier)', supplierParty);
      const customerBoxHeight = drawPartyBox(
        pageLeft + boxW + boxGap,
        boxesTop,
        boxW,
        'Bill To (Customer)',
        customerParty
      );
      doc.y = boxesTop + Math.max(supplierBoxHeight, customerBoxHeight) + 14;
      doc.x = pageLeft;

      // —— Line items table ——
      drawSectionTitle('Order Items');

      const tableStartX = pageLeft;
      const colProduct = Math.floor(contentWidth * 0.46);
      const colQty = Math.floor(contentWidth * 0.12);
      const colUnit = Math.floor(contentWidth * 0.18);
      const colTotal = contentWidth - colProduct - colQty - colUnit;
      const headerHeight = 24;

      const drawTableHeader = () => {
        const top = doc.y;
        doc.save();
        doc.rect(tableStartX, top, contentWidth, headerHeight).fill(BRAND_BLUE);
        doc.restore();
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor('#ffffff');
        doc.text('DESCRIPTION', tableStartX + 8, top + 8, { width: colProduct - 12 });
        doc.text('QTY', tableStartX + colProduct + 4, top + 8, { width: colQty - 6, align: 'center' });
        doc.text('UNIT PRICE', tableStartX + colProduct + colQty + 4, top + 8, { width: colUnit - 8, align: 'right' });
        doc.text('AMOUNT', tableStartX + colProduct + colQty + colUnit + 4, top + 8, {
          width: colTotal - 8,
          align: 'right'
        });
        doc.fillColor(BODY);
        doc.y = top + headerHeight;
      };

      const drawTableRow = ({ name, sublines = [], qty, unitPrice, lineTotal }) => {
        const rowTop = doc.y + 6;
        doc.fontSize(9.5).font('Helvetica-Bold').fillColor(HEADING).text(name, tableStartX + 8, rowTop, {
          width: colProduct - 12
        });
        let textBottom = doc.y;
        if (sublines.length) {
          doc.fontSize(7.8).font('Helvetica').fillColor(MUTED);
          for (const line of sublines) {
            doc.text(line, tableStartX + 8, textBottom + 1, { width: colProduct - 12 });
            textBottom = doc.y;
          }
        }
        doc.fontSize(9.5).font('Helvetica').fillColor(BODY);
        doc.text(String(qty), tableStartX + colProduct + 4, rowTop, { width: colQty - 6, align: 'center' });
        doc.text(formatINR(unitPrice), tableStartX + colProduct + colQty + 4, rowTop, {
          width: colUnit - 8,
          align: 'right'
        });
        doc.font('Helvetica-Bold').fillColor(HEADING);
        doc.text(formatINR(lineTotal), tableStartX + colProduct + colQty + colUnit + 4, rowTop, {
          width: colTotal - 8,
          align: 'right'
        });
        const rowBottom = Math.max(doc.y, textBottom) + 8;
        doc.save();
        doc.moveTo(tableStartX, rowBottom).lineTo(tableStartX + contentWidth, rowBottom).lineWidth(0.4).strokeColor(GRID).stroke();
        doc.restore();
        doc.y = rowBottom;
        doc.x = pageLeft;
        if (doc.y > doc.page.height - 200) {
          doc.addPage();
          doc.x = pageLeft;
          drawTableHeader();
        }
      };

      drawTableHeader();

      const transportBillRow = getTransportBill(order);
      const orderGstSummary =
        gstSummary && typeof gstSummary === 'object'
          ? gstSummary
          : sumGstLines(items.map((it) => it?.lineGst || {}));

      if (!items.length && !transportBillRow) {
        doc.fontSize(9.5).font('Helvetica').fillColor(MUTED).text('No line items found.', tableStartX + 8, doc.y + 10);
        doc.moveDown(1.5);
      } else {
        items.forEach((item, idx) => {
          const qty = Number(item?.quantity || 0);
          const unitPrice = Number(item?.unit_price || 0);
          const lineGst = item?.lineGst || {};
          const lineTotal = Number(
            lineGst?.totalAmount || item?.total_price || lineMoneyTotal(unitPrice, qty)
          );
          const lineName = item?.product?.name || `Item ${idx + 1}`;
          const lineUnit = item?.product?.unit || 'units';
          const lineTaxLabel =
            lineGst?.taxType === 'IGST'
              ? `IGST ${Number(lineGst?.igstRate || 0)}% (${formatINR(lineGst?.igstAmount || lineGst?.taxAmount || 0)})`
              : lineGst?.taxAmount
                ? `CGST ${Number(lineGst?.cgstRate || 0)}% + SGST ${Number(lineGst?.sgstRate || 0)}% (${formatINR(lineGst?.taxAmount || 0)})`
                : null;
          const sublines = [
            ...(lineTaxLabel ? [lineTaxLabel] : []),
            `MRP incl. GST`
          ];
          drawTableRow({
            name: lineName,
            sublines,
            qty: `${qty} ${lineUnit}`,
            unitPrice,
            lineTotal
          });
        });

        if (transportBillRow) {
          const provLine = transportBillRow.provider ? `Carrier: ${transportBillRow.provider}` : null;
          drawTableRow({
            name: 'Transport / Courier',
            sublines: provLine ? [provLine, 'Quoted logistics charge'] : ['Quoted logistics charge'],
            qty: '—',
            unitPrice: transportBillRow.amount,
            lineTotal: transportBillRow.amount
          });
        }
      }

      // —— GST summary (compact) ——
      doc.moveDown(0.4);
      const gstBoxTop = doc.y;
      const gstBoxW = contentWidth * 0.58;
      const gstLines = [
        `Supplier state: ${safeString(orderGstSummary?.supplierState || extractUserState(supplier || {}))}`,
        `Place of supply: ${safeString(
          orderGstSummary?.placeOfSupplyState ||
            orderGstSummary?.billingState ||
            order?.delivery_address?.billingAddress?.state ||
            '-'
        )}`,
        `Tax type: ${formatGstTaxTypeLabel(orderGstSummary?.taxType)}${
          orderGstSummary?.intraStateTax != null
            ? ` · ${orderGstSummary.intraStateTax ? 'Intra-state' : 'Inter-state'}`
            : ''
        }`
      ];
      doc.fontSize(8.5).font('Helvetica');
      const gstBodyHeight = doc.heightOfString(gstLines.join('\n'), {
        width: gstBoxW - 20,
        lineGap: 2
      });
      const gstBoxHeight = Math.max(56, 30 + gstBodyHeight);
      doc.save();
      doc.roundedRect(pageLeft, gstBoxTop, gstBoxW, gstBoxHeight, 4).fill(BRAND_LIGHT);
      doc.restore();
      doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED).text('GST SUMMARY', pageLeft + 10, gstBoxTop + 8);
      doc.fontSize(8.5).font('Helvetica').fillColor(BODY);
      doc.text(gstLines.join('\n'), pageLeft + 10, gstBoxTop + 22, { width: gstBoxW - 20, lineGap: 2 });

      const strictSummary =
        gstSummary && typeof gstSummary === 'object'
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
        ? Number(order?.total_amount || productsInclGst + transportAmt || receipt?.amount || 0)
        : Number(receipt?.amount || order?.total_amount || productsInclGst + transportAmt || 0);

      // —— Totals box (right) ——
      const totalsW = contentWidth * 0.38;
      const totalsX = pageRight - totalsW;
      const totalsTop = gstBoxTop;
      const totalsRows = [
        ['Taxable value', formatINR(subtotalAmount)],
        ...(igstAmount > 0 ? [['IGST', formatINR(igstAmount)]] : []),
        ...(cgstAmount > 0 ? [['CGST', formatINR(cgstAmount)]] : []),
        ...(sgstAmount > 0 ? [['SGST', formatINR(sgstAmount)]] : []),
        ...(igstAmount <= 0 && cgstAmount <= 0 && sgstAmount <= 0 && taxAmount > 0
          ? [['Total GST', formatINR(taxAmount)]]
          : taxAmount > 0
            ? [['Total GST', formatINR(taxAmount)]]
            : []),
        ['Products total', formatINR(productsInclGst)],
        ...(transportBillRow ? [['Transport', formatINR(transportAmt)]] : [])
      ];
      const totalsHeight = 24 + totalsRows.length * 16 + 28;
      doc.save();
      doc.roundedRect(totalsX, totalsTop, totalsW, totalsHeight, 4).lineWidth(0.6).strokeColor(GRID).stroke();
      doc.restore();

      let ty = totalsTop + 10;
      doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED).text('AMOUNT SUMMARY', totalsX + 10, ty);
      ty += 16;
      for (const [label, value] of totalsRows) {
        doc.fontSize(8.5).font('Helvetica').fillColor(BODY).text(label, totalsX + 10, ty, {
          width: totalsW * 0.48
        });
        doc.font('Helvetica').text(value, totalsX + totalsW * 0.48, ty, {
          width: totalsW * 0.45,
          align: 'right'
        });
        ty += 16;
      }
      doc.save();
      doc.moveTo(totalsX + 8, ty + 2).lineTo(totalsX + totalsW - 8, ty + 2).lineWidth(0.5).strokeColor(GRID).stroke();
      doc.restore();
      ty += 8;
      doc.fontSize(10.5).font('Helvetica-Bold').fillColor(BRAND_BLUE).text('Grand Total', totalsX + 10, ty);
      doc.fontSize(11).text(formatINR(totalAmount), totalsX + totalsW * 0.48, ty - 1, {
        width: totalsW * 0.45,
        align: 'right'
      });

      doc.y = Math.max(gstBoxTop + gstBoxHeight, totalsTop + totalsHeight) + 16;
      doc.x = pageLeft;

      // —— Delivery ——
      drawSectionTitle('Delivery Address');
      doc.fontSize(9.5).font('Helvetica').fillColor(BODY).text(resolveReceiptDeliveryAddress(order) || '-', {
        width: contentWidth,
        lineGap: 2
      });

      // —— Order status ——
      drawSectionTitle('Order Information');
      const infoY = doc.y;
      const infoCol = contentWidth / 2;
      const infoPairs = [
        ['Order status', safeString(order?.status || '-')],
        ['Payment status', safeString(order?.payment_status || '-')],
        ['Payment method', safeString(order?.payment_method || '-')],
        ['Order date', order?.created_at ? formatPlatformDateTime(order.created_at, '-') : '-'],
        [
          'Expected dispatch',
          order?.expected_delivery_date ? formatPlatformDate(order.expected_delivery_date, '-') : '-'
        ],
        [
          'Actual delivery',
          order?.actual_delivery_date ? formatPlatformDate(order.actual_delivery_date, '-') : '-'
        ]
      ];
      infoPairs.forEach(([label, value], i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = pageLeft + col * infoCol;
        const y = infoY + row * 28;
        doc.fontSize(8).font('Helvetica-Bold').fillColor(MUTED).text(label.toUpperCase(), x, y);
        doc.fontSize(9.5).font('Helvetica').fillColor(BODY).text(value, x, y + 11, { width: infoCol - 12 });
      });
      doc.y = infoY + Math.ceil(infoPairs.length / 2) * 28 + 8;

      // —— Footer ——
      doc.save();
      doc.moveTo(pageLeft, doc.y + 8).lineTo(pageRight, doc.y + 8).lineWidth(0.5).strokeColor(GRID).stroke();
      doc.restore();
      doc.moveDown(1.2);
      doc.fontSize(8.5).font('Helvetica').fillColor(MUTED).text(
        'This is a computer-generated payment receipt. It confirms that payment has been recorded for the order above.',
        pageLeft,
        doc.y,
        { width: contentWidth, align: 'center', lineGap: 2 }
      );
      doc.fontSize(8).text('Thank you for your business.', pageLeft, doc.y + 4, {
        width: contentWidth,
        align: 'center'
      });

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
    pdfGeneratedAt: new Date().toISOString(),
    pdfLayoutVersion: RECEIPT_PDF_LAYOUT_VERSION
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

