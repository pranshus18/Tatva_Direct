import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSupplierOfferDisplayName, resolveSupplierOfferDisplayCategory } from '../services/supplierProductWriteService.js';

test('resolveSupplierOfferDisplayName prefers listingName over shared catalog name', () => {
  assert.equal(
    resolveSupplierOfferDisplayName({
      attributes: { listingName: 'Safari Hard Shell', name: 'Fallback offer' },
      catalogName: 'Stella Suede Ballet Flat with Iridescent Accent.'
    }),
    'Safari Hard Shell'
  );
});

test('resolveSupplierOfferDisplayName falls back to offer name before catalog', () => {
  assert.equal(
    resolveSupplierOfferDisplayName({
      attributes: { name: 'Tata Headphones' },
      catalogName: 'Stella Suede Ballet Flat with Iridescent Accent.'
    }),
    'Tata Headphones'
  );
});

test('resolveSupplierOfferDisplayName uses catalog when offer has no title', () => {
  assert.equal(
    resolveSupplierOfferDisplayName({
      attributes: {},
      catalogName: 'oneplus'
    }),
    'oneplus'
  );
});

test('resolveSupplierOfferDisplayCategory prefers offer category over shared catalog category', () => {
  assert.equal(
    resolveSupplierOfferDisplayCategory({
      attributes: { category: 'flasks & bottles' },
      catalogCategory: 'footwear'
    }),
    'flasks & bottles'
  );
});

test('resolveSupplierOfferDisplayCategory falls back to catalog category', () => {
  assert.equal(
    resolveSupplierOfferDisplayCategory({
      attributes: {},
      catalogCategory: 'footwear'
    }),
    'footwear'
  );
});
