import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PDFKit from 'pdfkit';
import {
  buildReconciliationStatement,
  buildSettlementSummary
} from './reconciliationService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PDFDocument = PDFKit?.default || PDFKit;
const BRAND_BLUE = '#5b4fe5';
const HEADING = '#1f2937';
const BODY = '#374151';

const ISSUE_LABELS = {
  missing_receipt: 'Missing receipt',
  missing_payment_txn: 'Missing payment transaction',
  amount_mismatch: 'Amount mismatch',
  ledger_mismatch: 'Ledger entry missing',
  missing_invoice: 'Missing invoice'
};

function formatIssueType(type) {
  return ISSUE_LABELS[type] || String(type || '').replace(/_/g, ' ');
}

function formatInr(amount) {
  return Number(amount || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatDateTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function formatDateOnly(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function periodLabel(fromDate, toDate) {
  const from = fromDate ? formatDateOnly(fromDate) : 'Beginning';
  const to = toDate ? formatDateOnly(toDate) : 'Today';
  return `${from} to ${to}`;
}

function drawPdfTableRow(doc, columns, y, options = {}) {
  const { header = false, fontSize = 8 } = options;
  doc.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
  let x = doc.page.margins.left;
  const rowHeight = header ? 18 : 16;
  columns.forEach((cell, index) => {
    const width = [28, 72, 58, 78, 78, 52, 52][index] || 52;
    doc.text(String(cell ?? ''), x, y, { width, lineBreak: false });
    x += width;
  });
  return y + rowHeight;
}

function resolveStatementLogoPath() {
  const candidates = [
    path.resolve(__dirname, '../assets/tatva-logo.png'),
    path.resolve(__dirname, '../../frontend/src/images/tatva_d.png')
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function drawStatementHeader(doc, statement, logoPath = resolveStatementLogoPath()) {
  const pageLeft = doc.page.margins.left;
  const pageRight = doc.page.width - doc.page.margins.right;
  const headerTop = doc.page.margins.top;
  const textColumnX = logoPath ? pageLeft + 118 : pageLeft;
  const textWidth = pageRight - textColumnX;
  let headerBottom = headerTop;

  if (logoPath) {
    doc.image(logoPath, pageLeft, headerTop, { fit: [96, 52], align: 'left', valign: 'top' });
    headerBottom = Math.max(headerBottom, headerTop + 54);
  }

  doc.font('Helvetica-Bold').fontSize(18).fillColor(HEADING).text('Reconciliation Statement', textColumnX, headerTop, {
    width: textWidth
  });
  doc.font('Helvetica').fontSize(10).fillColor(BODY);
  doc.text(`Generated: ${formatDateTime(statement.generatedAt)}`, textColumnX, doc.y + 4, { width: textWidth });
  doc.text(`Period: ${periodLabel(statement.fromDate, statement.toDate)}`, textColumnX, doc.y + 2, { width: textWidth });
  doc.text(`Filter: ${statement.filter || 'all'}`, textColumnX, doc.y + 2, { width: textWidth });

  headerBottom = Math.max(headerBottom, doc.y + 8);
  const dividerY = headerBottom + 4;
  doc.save();
  doc.moveTo(pageLeft, dividerY).lineTo(pageRight, dividerY).lineWidth(1).strokeColor(BRAND_BLUE).stroke();
  doc.restore();

  doc.y = dividerY + 12;
  doc.x = pageLeft;
  doc.fillColor('#000000');
}

export async function buildReconciliationStatementPdf({ statement, settlement, logoPath = resolveStatementLogoPath() }) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 36, size: 'A4', layout: 'landscape' });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageLeft = doc.page.margins.left;

      drawStatementHeader(doc, statement, logoPath);

      doc.font('Helvetica-Bold').fontSize(12).text('Summary');
      doc.font('Helvetica').fontSize(10);
      doc.text(`Orders checked: ${statement.checked}`);
      doc.text(
        `Matched: ${statement.matched} | Mismatched: ${statement.mismatches} | Success rate: ${statement.successRatePct}%`
      );
      doc.text(`Total order amount: INR ${formatInr(statement.totalOrderAmount)}`);
      doc.text(`Total receipt amount: INR ${formatInr(statement.totalReceiptAmount)}`);
      doc.text(`Total transaction amount: INR ${formatInr(statement.totalTransactionAmount)}`);
      doc.text(`Total ledger amount: INR ${formatInr(statement.totalLedgerAmount)}`);
      doc.text(
        `Captured settlements: ${settlement?.transactionCount || 0} txn | INR ${formatInr(settlement?.totalCaptured || 0)}`
      );
      doc.moveDown(0.8);

      const compactHeaders = ['#', 'Order', 'Date', 'SP', 'Supplier', 'Method', 'Order Amt'];
      let y = doc.y;
      y = drawPdfTableRow(doc, compactHeaders, y, { header: true });
      doc.moveTo(pageLeft, y - 4).lineTo(doc.page.width - doc.page.margins.right, y - 4).stroke('#d1d5db');

      for (const [index, line] of (statement.lines || []).entries()) {
        if (y > doc.page.height - 80) {
          doc.addPage();
          drawStatementHeader(doc, statement, logoPath);
          y = doc.y;
          y = drawPdfTableRow(doc, compactHeaders, y, { header: true });
        }
        y = drawPdfTableRow(
          doc,
          [
            index + 1,
            line.orderNumber || '',
            formatDateOnly(line.orderDate),
            line.serviceProvider || '',
            line.supplier || '',
            line.paymentMethod || '',
            formatInr(line.orderTotal)
          ],
          y
        );
      }

      doc.addPage();
      drawStatementHeader(doc, statement, logoPath);
      doc.font('Helvetica-Bold').fontSize(12).text('Detailed Reconciliation Lines');
      doc.moveDown(0.5);
      doc.font('Helvetica').fontSize(8);

      for (const [index, line] of (statement.lines || []).entries()) {
        if (doc.y > doc.page.height - 60) {
          doc.addPage();
          drawStatementHeader(doc, statement, logoPath);
          doc.font('Helvetica-Bold').fontSize(12).text('Detailed Reconciliation Lines (contd.)');
          doc.moveDown(0.4);
          doc.font('Helvetica').fontSize(8);
        }

        doc.font('Helvetica-Bold').text(`${index + 1}. ${line.orderNumber || line.orderId} — ${line.status.toUpperCase()}`);
        doc.font('Helvetica');
        doc.text(
          [
            `Order date: ${formatDateTime(line.orderDate)}`,
            `Parties: ${line.serviceProvider || 'N/A'} / ${line.supplier || 'N/A'}`,
            `Order amount: INR ${formatInr(line.orderTotal)}`,
            `Receipt: ${
              line.receipt?.present
                ? `${line.receipt.number} | INR ${formatInr(line.receipt.amount)} | ${formatDateTime(line.receipt.paidAt)}`
                : 'Missing'
            }`,
            `Transaction: ${
              line.transaction?.present
                ? `${line.transaction.status} | ${line.transaction.method || 'N/A'} | INR ${formatInr(line.transaction.amount)}`
                : 'Missing'
            }`,
            `Reference: ${line.receipt?.paymentReference || line.transaction?.providerPaymentId || 'N/A'}`,
            `Ledger: ${line.ledger?.present ? `Present | INR ${formatInr(line.ledger.amount)}` : 'Missing'}`,
            `Variance (order-receipt): ${line.varianceOrderReceipt ?? 'N/A'}`,
            `Issues: ${(line.issueTypes || []).map(formatIssueType).join(', ') || 'None'}`
          ].join('\n')
        );
        doc.moveDown(0.4);
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

export async function buildReconciliationStatementDownload({
  fromDate = null,
  toDate = null,
  filter = 'all'
}) {
  const [statement, settlement] = await Promise.all([
    buildReconciliationStatement({ fromDate, toDate, filter }),
    buildSettlementSummary({ fromDate, toDate })
  ]);

  const stamp = new Date().toISOString().slice(0, 10);
  const periodSlug = `${fromDate ? String(fromDate).slice(0, 10) : 'all'}-to-${toDate ? String(toDate).slice(0, 10) : 'all'}`;
  const buffer = await buildReconciliationStatementPdf({ statement, settlement });

  return {
    buffer,
    contentType: 'application/pdf',
    filename: `reconciliation-statement-${periodSlug}-${stamp}.pdf`
  };
}

export default {
  buildReconciliationStatementPdf,
  buildReconciliationStatementDownload
};
