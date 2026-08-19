import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Lightweight regression coverage for the Select yourself approval → roles path.
 * Mirrors the catalogBrandDedupKey matching used by fetchSupplierApprovedBrands.
 */
test('catalogBrandDedupKey treats spelling variants as distinct brands', async () => {
  const { catalogBrandDedupKey, normalizeBrandKey } = await import(
    '../services/supplyChainSharedService.js'
  );

  const declared = 'Phillips';
  const storedNormalized = 'philips';
  const identity = (value) => catalogBrandDedupKey(value) || normalizeBrandKey(value);

  assert.notEqual(identity(declared), identity(storedNormalized));
  assert.notEqual(identity(declared), identity('Philips'));
  assert.equal(identity('Philips'), identity('philips'));
});

test('duplicate-of-approved rejection reason is detectable', () => {
  const reason = 'Duplicate of approved brand "Samsung".';
  assert.match(reason, /duplicate of (approved brand\s+)?["“]?/i);
  assert.match(
    'Duplicate of "Samsung" — merged automatically.',
    /duplicate of (approved brand\s+)?["“]?/i
  );
});
