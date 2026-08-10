import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roundVariantMrp,
  validateSupplierVariantMrpConsistency,
  buildVariantMrpMapKey,
  formatVariantMrpMismatchMessage
} from '../services/variantMrpService.js';

test('roundVariantMrp normalizes currency to two decimals', () => {
  assert.equal(roundVariantMrp(99.999), 100);
  assert.equal(roundVariantMrp('120.5'), 120.5);
  assert.equal(roundVariantMrp(null), null);
  assert.equal(roundVariantMrp(-1), null);
});

test('validateSupplierVariantMrpConsistency allows first supplier to set MRP', () => {
  const result = validateSupplierVariantMrpConsistency({
    body: { price: 250 },
    canonicalMrp: null
  });
  assert.equal(result.ok, true);
});

test('validateSupplierVariantMrpConsistency blocks mismatched MRP', () => {
  const result = validateSupplierVariantMrpConsistency({
    body: { price: 300 },
    canonicalMrp: 250
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'variant_mrp_mismatch');
  assert.match(result.message, /250\.00/);
  assert.match(formatVariantMrpMismatchMessage(250), /250\.00/);
});

test('validateSupplierVariantMrpConsistency allows matching canonical MRP', () => {
  const result = validateSupplierVariantMrpConsistency({
    body: { price: 250 },
    canonicalMrp: 250
  });
  assert.equal(result.ok, true);
});

test('buildVariantMrpMapKey combines product and variant identifiers', () => {
  assert.equal(buildVariantMrpMapKey('prod-1', 'vk-a'), 'prod-1::vk-a');
});
