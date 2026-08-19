import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveReceiptPaymentMethodLabel,
  resolveReceiptPaymentStatusLabel
} from '../services/receiptPdfService.js';

test('receipt shows Paid when vault was debited even if order status is still pending', () => {
  assert.equal(
    resolveReceiptPaymentStatusLabel({
      order: { payment_status: 'pending', wallet_payment_status: 'held' },
      receipt: { receipt_number: 'RCPT-1', paid_at: '2026-08-18T08:00:00.000Z' }
    }),
    'Paid'
  );
  assert.equal(
    resolveReceiptPaymentStatusLabel({
      order: { payment_status: 'pending', payment_verified_at: '2026-08-18T08:00:00.000Z' },
      receipt: { receipt_number: 'RCPT-1' }
    }),
    'Paid'
  );
  assert.equal(
    resolveReceiptPaymentStatusLabel({
      order: { payment_status: 'pending' },
      receipt: { receipt_number: 'RCPT-1', payment_reference: 'pm-vault-abc' }
    }),
    'Paid'
  );
});

test('receipt shows Paid when order payment_status is paid', () => {
  assert.equal(
    resolveReceiptPaymentStatusLabel({
      order: { payment_status: 'paid' },
      receipt: { receipt_number: 'RCPT-1' }
    }),
    'Paid'
  );
});

test('receipt payment method labels vault clearly', () => {
  assert.equal(
    resolveReceiptPaymentMethodLabel({
      order: { payment_method: 'vault' },
      receipt: { payment_method: 'vault' }
    }),
    'Vault'
  );
});
