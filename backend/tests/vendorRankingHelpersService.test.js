import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSupplierPincode, supplierLocationCandidates } from '../services/vendorRankingHelpersService.js';

test('resolveSupplierPincode prefers the specific product/listing pincode over the supplier account address', () => {
  // Regression: a supplier listed a product from Pune (411026) but registered their
  // account with a generic Bengaluru address (560102) — the pincode shown for THIS
  // listing must be Pune's, not the unrelated account pincode.
  const pincode = resolveSupplierPincode({
    productLocation: 'Pune, Pune, Maharashtra, 411026, India',
    supplierAddress: { city: 'Bengaluru', state: 'Karnataka', pincode: '560102' },
    supplierProfile: {}
  });
  assert.equal(pincode, '411026');
});

test('resolveSupplierPincode falls back to the account address when the listing has no pincode', () => {
  const pincode = resolveSupplierPincode({
    productLocation: 'Pune, Maharashtra',
    supplierAddress: { city: 'Bengaluru', state: 'Karnataka', pincode: '560102' },
    supplierProfile: {}
  });
  assert.equal(pincode, '560102');
});

test('supplierLocationCandidates lists the product/listing location before the account address', () => {
  const candidates = supplierLocationCandidates({
    productLocation: 'Pune, Pune, Maharashtra, 411026, India',
    supplierAddress: { city: 'Bengaluru', state: 'Karnataka', pincode: '560102' },
    supplierProfile: {}
  });
  assert.equal(candidates[0], 'Pune, Pune, Maharashtra, 411026, India');
  assert.ok(candidates.some((c) => c.includes('560102')));
});
