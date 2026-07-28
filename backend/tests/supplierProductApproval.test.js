import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areSpecificationsEqual,
  shouldMoveToPendingForSpecChange,
  shouldAutoApproveSupplierOfferOnCreate,
  shouldRequireApprovalForVariantSpecChange
} from '../utils/supplierProductApproval.js';

test('areSpecificationsEqual treats same spec object with different key order as equal', () => {
  const currentSpecs = {
    ram: '8gb',
    dimensions: { width: 10, height: 20 },
    tags: ['a', 'b']
  };
  const nextSpecs = {
    tags: ['a', 'b'],
    dimensions: { height: 20, width: 10 },
    ram: '8gb'
  };

  assert.equal(areSpecificationsEqual(currentSpecs, nextSpecs), true);
});

test('shouldMoveToPendingForSpecChange returns false when specifications are not provided', () => {
  const result = shouldMoveToPendingForSpecChange({
    specificationsProvided: false,
    currentSpecs: { color: 'red' },
    nextSpecs: { color: 'blue' }
  });

  assert.equal(result, false);
});

test('shouldMoveToPendingForSpecChange returns true when supplier changes specifications', () => {
  const result = shouldMoveToPendingForSpecChange({
    specificationsProvided: true,
    currentSpecs: { color: 'red', size: 'm' },
    nextSpecs: { color: 'blue', size: 'm' }
  });

  assert.equal(result, true);
});

test('shouldAutoApproveSupplierOfferOnCreate approves when same variant already approved', () => {
  assert.equal(
    shouldAutoApproveSupplierOfferOnCreate({
      hasApprovedSameVariantOffer: true,
      catalogProductStatus: 'pending',
      hasAnyApprovedOfferForProduct: false
    }),
    true
  );
});

test('shouldAutoApproveSupplierOfferOnCreate approves different variant when catalog is approved', () => {
  assert.equal(
    shouldAutoApproveSupplierOfferOnCreate({
      hasApprovedSameVariantOffer: false,
      catalogProductStatus: 'approved',
      hasAnyApprovedOfferForProduct: false
    }),
    true
  );
});

test('shouldAutoApproveSupplierOfferOnCreate approves different variant when another offer is already approved', () => {
  assert.equal(
    shouldAutoApproveSupplierOfferOnCreate({
      hasApprovedSameVariantOffer: false,
      catalogProductStatus: 'pending',
      hasAnyApprovedOfferForProduct: true
    }),
    true
  );
});

test('shouldAutoApproveSupplierOfferOnCreate keeps brand-new products pending', () => {
  assert.equal(
    shouldAutoApproveSupplierOfferOnCreate({
      hasApprovedSameVariantOffer: false,
      catalogProductStatus: 'pending',
      hasAnyApprovedOfferForProduct: false
    }),
    false
  );
});

test('shouldRequireApprovalForVariantSpecChange is false when catalog is already approved', () => {
  assert.equal(
    shouldRequireApprovalForVariantSpecChange({
      catalogProductStatus: 'approved',
      hasAnyApprovedOfferForProduct: false,
      currentOfferStatus: 'approved'
    }),
    false
  );
});

test('shouldRequireApprovalForVariantSpecChange is false when another variant offer is approved', () => {
  assert.equal(
    shouldRequireApprovalForVariantSpecChange({
      catalogProductStatus: 'pending',
      hasAnyApprovedOfferForProduct: true,
      currentOfferStatus: 'pending'
    }),
    false
  );
});

test('shouldRequireApprovalForVariantSpecChange is true for brand-new pending products', () => {
  assert.equal(
    shouldRequireApprovalForVariantSpecChange({
      catalogProductStatus: 'pending',
      hasAnyApprovedOfferForProduct: false,
      currentOfferStatus: 'pending'
    }),
    true
  );
});
