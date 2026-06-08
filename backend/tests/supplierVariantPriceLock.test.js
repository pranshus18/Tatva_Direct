import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pickLockedProductPriceFromOffers,
  pickLockedVariantPriceFromOffers
} from '../services/supplierProductWriteService.js';

test('pickLockedVariantPriceFromOffers prefers approved active offer price', () => {
  const price = pickLockedVariantPriceFromOffers([
    { price: 120, status: 'pending', is_active: false },
    { price: 150, status: 'approved', is_active: true },
    { price: 140, status: 'approved', is_active: false }
  ]);
  assert.equal(price, 150);
});

test('pickLockedVariantPriceFromOffers falls back to approved when active missing', () => {
  const price = pickLockedVariantPriceFromOffers([
    { price: 175, status: 'approved', is_active: false },
    { price: 160, status: 'pending', is_active: false }
  ]);
  assert.equal(price, 175);
});

test('pickLockedVariantPriceFromOffers ignores invalid prices', () => {
  const price = pickLockedVariantPriceFromOffers([
    { price: null, status: 'approved', is_active: true },
    { price: 'abc', status: 'approved', is_active: true }
  ]);
  assert.equal(price, null);
});

test('pickLockedProductPriceFromOffers applies same lock across variants', () => {
  const price = pickLockedProductPriceFromOffers([
    { price: 210, status: 'approved', is_active: true, variant_key: 'v1' },
    { price: 190, status: 'pending', is_active: false, variant_key: 'v2' }
  ]);
  assert.equal(price, 210);
});
