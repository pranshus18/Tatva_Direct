import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUPLICATE_SUPPLIER_VARIANT_MESSAGE,
  DUPLICATE_CATALOG_PRODUCT_MESSAGE,
  findOwnOfferForUniqueConflict,
  findOwnOfferForVariantLocation,
  isExistingOfferUpdatableOnCreate,
  isPgUniqueViolation,
  isCatalogProductUniqueViolation,
  isSupplierOfferUniqueViolation,
  looksLikePostgresConstraintError,
  parsePgUniqueViolationIdentity,
  supplierOfferLocationsMatch,
  canonicalSupplierOfferLocation,
  toCatalogProductWriteErrorResponse,
  toSupplierOfferWriteErrorResponse
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

test('findOwnOfferForVariantLocation matches empty variant keys at the same location', () => {
  const row = {
    id: 'offer-empty',
    supplier_id: 'sup-1',
    location: 'Not specified',
    variant_key: '',
    status: 'pending'
  };
  const found = findOwnOfferForVariantLocation([row], {
    supplierId: 'sup-1',
    location: '',
    variantKey: ''
  });
  assert.equal(found?.id, 'offer-empty');
});

test('findOwnOfferForUniqueConflict finds the row even when location aliases differ', () => {
  const row = {
    id: 'offer-2',
    supplier_id: 'sup-1',
    location: 'Not specified',
    variant_key: 'vk-1',
    status: 'approved'
  };
  const found = findOwnOfferForUniqueConflict([row], {
    supplierId: 'sup-1',
    location: '',
    variantKey: 'vk-1'
  });
  assert.equal(found?.id, 'offer-2');
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

test('detects unique violations when PostgREST omits the table name from details', () => {
  assert.equal(
    isSupplierOfferUniqueViolation({
      code: '23505',
      details:
        'Key (product_id, supplier_id, location, variant_key)=(aaa, bbb, , vk-1) already exists.'
    }),
    true
  );
  assert.equal(
    isSupplierOfferUniqueViolation({
      code: '23505',
      details: 'Key (product_id, supplier_id, location, variant_key)=(aaa, bbb, , vk-1) already exists.',
      message: ''
    }),
    true
  );
});

test('detects unique violations on Error objects whose message is non-enumerable', () => {
  const err = new Error(
    'duplicate key value violates unique constraint "supplier_products_product_supplier_location_variant_key"'
  );
  err.code = '23505';
  assert.equal(isSupplierOfferUniqueViolation(err), true);
  assert.equal(isPgUniqueViolation(err), true);
  assert.equal(looksLikePostgresConstraintError(err), true);
});

test('toSupplierOfferWriteErrorResponse maps PostgREST details-only unique errors', () => {
  const response = toSupplierOfferWriteErrorResponse({
    code: '23505',
    message: '',
    details:
      'Key (product_id, supplier_id, location, variant_key)=(aaa, bbb, , vk-1) already exists.'
  });
  assert.equal(response.code, 'duplicate_supplier_variant');
  assert.equal(response.message, DUPLICATE_SUPPLIER_VARIANT_MESSAGE);
  assert.equal(/duplicate key|unique constraint|23505/i.test(response.message), false);
});

test('canonicalSupplierOfferLocation collapses empty aliases to one uniqueness slot', () => {
  assert.equal(canonicalSupplierOfferLocation(''), '');
  assert.equal(canonicalSupplierOfferLocation(null), '');
  assert.equal(canonicalSupplierOfferLocation('Not specified'), '');
  assert.equal(canonicalSupplierOfferLocation('Pune warehouse'), 'Pune warehouse');
});

test('toSupplierOfferWriteErrorResponse never returns the raw constraint name', () => {
  const response = toSupplierOfferWriteErrorResponse({
    code: '23505',
    message:
      'duplicate key value violates unique constraint "supplier_products_product_supplier_location_variant_key"'
  });
  assert.equal(response.code, 'duplicate_supplier_variant');
  assert.equal(response.message, DUPLICATE_SUPPLIER_VARIANT_MESSAGE);
  assert.equal(/duplicate key|unique constraint/i.test(response.message), false);
});

test('idx_products_barcode unique violations are catalog identity collisions, not offer duplicates', () => {
  const error = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "idx_products_barcode"',
    details: 'Key (barcode)=(45W Fast Adapter) already exists.'
  };
  assert.equal(isPgUniqueViolation(error), true);
  assert.equal(isCatalogProductUniqueViolation(error), true);
  assert.equal(isSupplierOfferUniqueViolation(error), false);
  assert.deepEqual(parsePgUniqueViolationIdentity(error), {
    column: 'barcode',
    value: '45W Fast Adapter'
  });
  const response = toCatalogProductWriteErrorResponse(error);
  assert.equal(response.code, 'duplicate_catalog_product');
  assert.equal(response.message, DUPLICATE_CATALOG_PRODUCT_MESSAGE);
  assert.equal(/idx_products_barcode|duplicate key/i.test(response.message), false);
});
