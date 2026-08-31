import test from 'node:test';
import assert from 'node:assert/strict';
import {
  roundVariantMrp,
  validateSupplierVariantMrpConsistency,
  buildVariantMrpMapKey,
  formatVariantMrpMismatchMessage,
  pickCanonicalVariantMrpFromOffers
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

const catalogWcSpecs = { Color: 'White', Series: 'Continental', Weight: '17.5 kg' };

test('pickCanonicalVariantMrpFromOffers reuses MRP when leftover variant keys differ', () => {
  const offers = [
    {
      variant_key: 'TSPCYY1YL',
      price: 0,
      status: 'approved',
      is_active: true,
      attributes: { specifications: {} }
    },
    {
      variant_key: 'TSPCYY1JI',
      price: 10500,
      status: 'approved',
      is_active: true,
      updated_at: '2026-01-01T00:00:00.000Z',
      attributes: { specifications: {} }
    }
  ];

  assert.equal(
    pickCanonicalVariantMrpFromOffers(offers, {
      variantKey: 'computed-new-key',
      specifications: catalogWcSpecs,
      catalogSpecs: catalogWcSpecs
    }),
    10500
  );
  assert.equal(
    pickCanonicalVariantMrpFromOffers(offers, {
      variantKey: '',
      specifications: catalogWcSpecs,
      catalogSpecs: catalogWcSpecs
    }),
    10500
  );
});

test('pickCanonicalVariantMrpFromOffers prefers the unique positive MRP on a product', () => {
  assert.equal(
    pickCanonicalVariantMrpFromOffers(
      [
        { variant_key: 'a', price: 0, status: 'pending' },
        { variant_key: 'b', price: 10500, status: 'approved', is_active: true }
      ],
      { variantKey: 'brand-new' }
    ),
    10500
  );
});

test('pickCanonicalVariantMrpFromOffers does not mix different catalog variants', () => {
  const offers = [
    {
      variant_key: 'white',
      price: 10500,
      status: 'approved',
      is_active: true,
      attributes: { specifications: { Color: 'White' } }
    },
    {
      variant_key: 'black',
      price: 8000,
      status: 'approved',
      is_active: true,
      attributes: { specifications: { Color: 'Black' } }
    }
  ];
  assert.equal(
    pickCanonicalVariantMrpFromOffers(offers, {
      variantKey: 'new-white',
      specifications: { Color: 'White' },
      catalogSpecs: { Color: 'White' }
    }),
    10500
  );
  assert.equal(
    pickCanonicalVariantMrpFromOffers(offers, {
      variantKey: 'new-black',
      specifications: { Color: 'Black' },
      catalogSpecs: { Color: 'White' }
    }),
    8000
  );
});

