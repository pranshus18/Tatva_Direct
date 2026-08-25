import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatEffectivePaymentStatusLabel,
  resolveEffectivePaymentStatus
} from '../utils/effectivePaymentStatus.js';

test('vault held debit is paid even when order payment_status is pending', () => {
  assert.equal(
    resolveEffectivePaymentStatus({
      order: { payment_status: 'pending', wallet_payment_status: 'held' }
    }),
    'paid'
  );
});

test('payment receipt means paid', () => {
  assert.equal(
    resolveEffectivePaymentStatus({
      order: { payment_status: 'pending' },
      receipt: { receipt_number: 'RCPT-1', paid_at: '2026-08-18T08:00:00.000Z' }
    }),
    'paid'
  );
});

test('unpaid vault checkout stays pending', () => {
  assert.equal(
    resolveEffectivePaymentStatus({
      order: { payment_status: 'pending', payment_method: 'vault' }
    }),
    'pending'
  );
});

test('label is Paid for vault-paid orders', () => {
  assert.equal(
    formatEffectivePaymentStatusLabel({
      order: { payment_status: 'pending', payment_verified_at: '2026-08-18T08:00:00.000Z' }
    }),
    'Paid'
  );
});
