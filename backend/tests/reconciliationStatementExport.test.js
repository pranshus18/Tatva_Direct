import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  buildReconciliationStatementCsv,
  buildReconciliationStatementPdf
} from '../services/reconciliationStatementExportService.js';

test('buildReconciliationStatementCsv includes summary and detailed columns', () => {
  const csv = buildReconciliationStatementCsv({
    statement: {
      generatedAt: '2026-06-12T10:00:00.000Z',
      fromDate: '2026-06-01T00:00:00.000Z',
      toDate: '2026-06-12T23:59:59.999Z',
      filter: 'all',
      checked: 1,
      matched: 0,
      mismatches: 1,
      issueCount: 1,
      successRatePct: 0,
      totalOrderAmount: 1000,
      totalReceiptAmount: 0,
      totalTransactionAmount: 0,
      totalLedgerAmount: 0,
      lines: [
        {
          orderId: 'order-1',
          orderNumber: 'ORD-1001',
          orderDate: '2026-06-10T08:00:00.000Z',
          serviceProvider: 'Alpha SP',
          supplier: 'Beta Supplier',
          paymentMethod: 'upi',
          paymentProvider: 'razorpay',
          orderTotal: 1000,
          receipt: { present: false },
          transaction: { present: false },
          ledger: { present: false },
          varianceOrderReceipt: null,
          varianceOrderTransaction: null,
          issueTypes: ['missing_receipt'],
          status: 'mismatch'
        }
      ]
    },
    settlement: {
      transactionCount: 0,
      totalCaptured: 0,
      byMethod: {}
    }
  });

  const text = csv.toString('utf8');
  assert.ok(text.startsWith('\uFEFF'), 'CSV should include UTF-8 BOM for Excel');
  assert.match(text, /Reconciliation Statement/);
  assert.match(text, /Total Order Amount \(INR\)/);
  assert.match(text, /Payment Reference \/ UTR/);
  assert.match(text, /ORD-1001/);
  assert.match(text, /Alpha SP/);
  assert.match(text, /Missing receipt/);
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
