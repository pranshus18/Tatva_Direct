import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  buildReconciliationStatementDownload,
  buildReconciliationStatementPdf
} from '../services/reconciliationStatementExportService.js';

test('buildReconciliationStatementDownload returns a PDF file', async () => {
  const baseStatement = {
    generatedAt: '2026-06-12T10:00:00.000Z',
    fromDate: '2026-06-01T00:00:00.000Z',
    toDate: '2026-06-12T23:59:59.999Z',
    filter: 'all',
    checked: 1,
    matched: 1,
    mismatches: 0,
    issueCount: 0,
    successRatePct: 100,
    totalOrderAmount: 1200,
    totalReceiptAmount: 1200,
    totalTransactionAmount: 1200,
    totalLedgerAmount: 1200,
    lines: [
      {
        orderId: 'o-1',
        orderNumber: 'ORD-1',
        orderDate: '2026-06-05T10:00:00.000Z',
        status: 'matched',
        serviceProvider: 'SP Demo',
        supplier: 'Supplier Demo',
        paymentMethod: 'vault',
        orderTotal: 1200,
        receipt: { present: true, number: 'R-1', amount: 1200, paidAt: '2026-06-05T10:30:00.000Z', paymentReference: 'PAY-1' },
        transaction: { present: true, status: 'captured', method: 'vault', amount: 1200, providerPaymentId: 'TXN-1' },
        ledger: { present: true, amount: 1200 },
        varianceOrderReceipt: 0,
        issueTypes: []
      }
    ]
  };

  const download = await buildReconciliationStatementDownload({
    fromDate: '2026-06-01T00:00:00.000Z',
    toDate: '2026-06-12T23:59:59.999Z',
    filter: 'all'
  }, {
    loadStatement: async () => baseStatement,
    loadSettlement: async () => ({ transactionCount: 1, totalCaptured: 1200, byMethod: { vault: 1200 } })
  });

  assert.equal(download.contentType, 'application/pdf');
  assert.match(download.filename, /\.pdf$/);
  assert.ok(download.buffer.length > 100);
});

test('buildReconciliationStatementPdf embeds bundled Tatva logo when available', async () => {
  const logoPath = new URL('../assets/tatva-logo.png', import.meta.url).pathname;
  assert.ok(fs.existsSync(logoPath), 'bundled logo should exist for PDF export');

  const pdf = await buildReconciliationStatementPdf({
    statement: {
      generatedAt: '2026-06-12T10:00:00.000Z',
      fromDate: '2026-06-01T00:00:00.000Z',
      toDate: '2026-06-12T23:59:59.999Z',
      filter: 'all',
      checked: 0,
      matched: 0,
      mismatches: 0,
      issueCount: 0,
      successRatePct: 100,
      totalOrderAmount: 0,
      totalReceiptAmount: 0,
      totalTransactionAmount: 0,
      totalLedgerAmount: 0,
      lines: []
    },
    settlement: { transactionCount: 0, totalCaptured: 0, byMethod: {} },
    logoPath
  });

  assert.ok(pdf.length > 1000);
});
