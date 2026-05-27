import test from 'node:test';
import assert from 'node:assert/strict';
import {
  branchRecordToAddressInput,
  isSupplierBranchAddressComplete,
  normalizeRequiredDateForUpstream,
  primaryBranchToUsersAddress,
  resolvePrimarySupplierShippingAddress,
  resolveUpstreamPaymentSelection
} from '../services/upstreamOrderInputService.js';

test('normalizeRequiredDateForUpstream accepts same-day required date', () => {
  const now = new Date('2026-05-27T10:00:00.000Z');
  const out = normalizeRequiredDateForUpstream('2026-05-27', now);
  assert.equal(out.error, null);
  assert.ok(typeof out.expectedDeliveryDate === 'string');
});

test('normalizeRequiredDateForUpstream rejects past required date', () => {
  const now = new Date('2026-05-27T10:00:00.000Z');
  const out = normalizeRequiredDateForUpstream('2026-05-26', now);
  assert.equal(out.expectedDeliveryDate, null);
  assert.equal(out.error, 'Required date cannot be in the past.');
});

test('normalizeRequiredDateForUpstream handles empty required date', () => {
  const out = normalizeRequiredDateForUpstream('');
  assert.equal(out.expectedDeliveryDate, null);
  assert.equal(out.error, null);
});

test('resolveUpstreamPaymentSelection maps UI payment methods to DB values', () => {
  assert.deepEqual(resolveUpstreamPaymentSelection('cod'), {
    payment_method: 'cash',
    payment_status: 'pending'
  });
  assert.deepEqual(resolveUpstreamPaymentSelection('bank_transfer'), {
    payment_method: 'bank_transfer',
    payment_status: 'pending'
  });
  assert.deepEqual(resolveUpstreamPaymentSelection('credit'), {
    payment_method: 'credit',
    payment_status: 'pending'
  });
  assert.deepEqual(resolveUpstreamPaymentSelection('card'), {
    payment_method: 'card',
    payment_status: 'pending'
  });
  assert.deepEqual(resolveUpstreamPaymentSelection('online'), {
    payment_method: 'online',
    payment_status: 'pending'
  });
});

test('isSupplierBranchAddressComplete validates branch location fields', () => {
  assert.equal(
    isSupplierBranchAddressComplete({
      address: '12 MG Road',
      city: 'Pune',
      state: 'MH',
      zipCode: '411001',
      country: 'India'
    }),
    true
  );
  assert.equal(isSupplierBranchAddressComplete({ address: '12 MG Road' }), false);
});

test('primaryBranchToUsersAddress maps branch zipCode to users.address pincode', () => {
  const out = primaryBranchToUsersAddress([
    {
      address: 'Warehouse 1',
      city: 'Pune',
      state: 'MH',
      zipCode: '411026',
      country: 'India'
    }
  ]);
  assert.equal(out.line1, 'Warehouse 1');
  assert.equal(out.pincode, '411026');
});

test('resolvePrimarySupplierShippingAddress prefers profile branches over legacy address', () => {
  const out = resolvePrimarySupplierShippingAddress({
    profileRow: {
      address: { line1: 'Legacy', city: 'X', state: 'Y', pincode: '110001', country: 'India' },
      profile: {
        branches: [
          {
            address: 'Warehouse 1',
            city: 'Pune',
            state: 'MH',
            zipCode: '411026',
            country: 'India'
          }
        ]
      }
    }
  });
  assert.equal(branchRecordToAddressInput({ address: 'Warehouse 1' }).line1, 'Warehouse 1');
  assert.equal(out.line1, 'Warehouse 1');
  assert.equal(out.pincode, '411026');
});

