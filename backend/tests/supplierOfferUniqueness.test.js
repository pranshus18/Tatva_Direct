import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUPLICATE_SUPPLIER_VARIANT_MESSAGE,
  findOwnOfferForVariantLocation,
  isExistingOfferUpdatableOnCreate,
  isSupplierOfferUniqueViolation,
  supplierOfferLocationsMatch
} from '../utils/supplierOfferUniqueness.js';

test('supplierOfferLocationsMatch treats blank step-1 locations as the same slot', () => {
  assert.equal(supplierOfferLocationsMatch('', ''), true);
  assert.equal(supplierOfferLocationsMatch('', 'Not specified'), true);
  assert.equal(supplierOfferLocationsMatch('not specified', 'N/A'), true);
  assert.equal(supplierOfferLocationsMatch('Mumbai', 'mumbai'), true);
  assert.equal(supplierOfferLocationsMatch('Mumbai', ''), false);
});

test('findOwnOfferForVariantLocation matches after variant key reuse at empty location', () => {
  const row = {
    id: 'offer-1',
    supplier_id: 'sup-1',
    location: '',
    variant_key: 'reused-key',
    status: 'pending'
  };
  const found = findOwnOfferForVariantLocation([row], {
    supplierId: 'sup-1',
    location: '',
    variantKey: 'reused-key'
  });
  assert.equal(found?.id, 'offer-1');
});

test('pending and rejected offers can be updated on create; approved cannot', () => {
  assert.equal(isExistingOfferUpdatableOnCreate({ status: 'pending' }), true);
  assert.equal(isExistingOfferUpdatableOnCreate({ status: 'rejected' }), true);
  assert.equal(isExistingOfferUpdatableOnCreate({ status: 'approved' }), false);
});

test('detects the supplier_products location+variant unique constraint from Postgres', () => {
  assert.equal(
    isSupplierOfferUniqueViolation({
      code: '23505',
      message:
        'duplicate key value violates unique constraint "supplier_products_product_supplier_location_variant_key"'
    }),
    true
  );
  assert.equal(
    isSupplierOfferUniqueViolation({
      message: 'duplicate key value violates unique constraint "uq_supplier_offer_variant_outlet"'
    }),
    true
  );
  assert.equal(
    isSupplierOfferUniqueViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint "uq_products_catalog_key_not_blank"'
    }),
    false
  );
  assert.equal(DUPLICATE_SUPPLIER_VARIANT_MESSAGE.includes('already added'), true);
});
