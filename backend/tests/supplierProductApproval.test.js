import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areSpecificationsEqual,
  shouldMoveToPendingForSpecChange,
  shouldAutoApproveSupplierOfferOnCreate,
  shouldRequireApprovalForVariantSpecChange,
  hasSupplierSpecificationChangesFromCatalog,
  shouldRecomputeSupplierVariantKeyOnUpdate,
  submittedSpecsCompatibleWithExistingVariant,
  specsRepresentSameCatalogVariant,
  findBestMatchingApprovedOfferForSpecs,
  retainCatalogCompatibleSpecifications
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

test('areSpecificationsEqual treats numeric strings and numbers as equal', () => {
  assert.equal(
    areSpecificationsEqual({ playtime: '57', battery: '40' }, { playtime: 57, battery: 40 }),
    true
  );
});

test('hasSupplierSpecificationChangesFromCatalog ignores number vs string for same value', () => {
  assert.equal(
    hasSupplierSpecificationChangesFromCatalog({
      catalogSpecs: { playtime: '57' },
      supplierSpecs: { playtime: 57 }
    }),
    false
  );
});

test('findBestMatchingApprovedOfferForSpecs reuses legacy approved offer with empty specs', () => {
  const matched = findBestMatchingApprovedOfferForSpecs(
    [
      {
        id: 'offer-1',
        status: 'approved',
        is_active: true,
        variant_key: 'vk-1',
        attributes: { description: 'legacy', name: 'JBL' }
      }
    ],
    { Color: 'Black', Connectivity: 'Bluetooth' }
  );
  assert.equal(matched?.id, 'offer-1');
});

test('retainCatalogCompatibleSpecifications drops unrelated category defaults', () => {
  const cleaned = retainCatalogCompatibleSpecifications(
    { Connectivity: 'Bluetooth', Playtime: '57H' },
    {
      Connectivity: 'Bluetooth',
      Playtime: '57H',
      'Product Type': 'Wireless Mouse',
      'Sensor Type': 'Optical'
    }
  );
  assert.deepEqual(cleaned, {
    Connectivity: 'Bluetooth',
    Playtime: '57H'
  });
});

test('retainCatalogCompatibleSpecifications keeps intentional overlapping edits', () => {
  const cleaned = retainCatalogCompatibleSpecifications(
    { Color: 'Black', Size: 'M' },
    { Color: 'White', Size: 'M', Material: 'Plastic' }
  );
  assert.equal(cleaned.Color, 'White');
  assert.equal(cleaned.Size, 'M');
  assert.equal(cleaned.Material, undefined);
});

test('findBestMatchingApprovedOfferForSpecs picks overlapping-agreeing offer among several', () => {
  const matched = findBestMatchingApprovedOfferForSpecs(
    [
      {
        id: 'red',
        status: 'approved',
        attributes: { specifications: { Color: 'Red' } }
      },
      {
        id: 'black',
        status: 'approved',
        attributes: { specifications: { Color: 'Black', Size: 'M' } }
      }
    ],
    { Color: 'Black', Material: 'Plastic' }
  );
  assert.equal(matched?.id, 'black');
});

test('specsRepresentSameCatalogVariant treats empty offer specs as the catalog product', () => {
  const catalog = { Color: 'White', Series: 'Continental', Weight: '17.5 kg' };
  assert.equal(specsRepresentSameCatalogVariant(catalog, {}, catalog), true);
  assert.equal(specsRepresentSameCatalogVariant({}, catalog, catalog), true);
  assert.equal(
    specsRepresentSameCatalogVariant(
      { Color: 'Black', Series: 'Continental', Weight: '17.5 kg' },
      catalog,
      catalog
    ),
    false
  );
});

test('submittedSpecsCompatibleWithExistingVariant allows extra template fields', () => {
  assert.equal(
    submittedSpecsCompatibleWithExistingVariant(
      { Color: 'Black', Capacity: '500ML', Material: 'Steel' },
      { Color: 'Black', Capacity: '500ML' }
    ),
    true
  );
  assert.equal(
    submittedSpecsCompatibleWithExistingVariant(
      { Color: 'Black' },
      { Color: 'Black', Capacity: '500ML' }
    ),
    false
  );
  assert.equal(
    submittedSpecsCompatibleWithExistingVariant(
      { Color: 'White', Capacity: '500ML' },
      { Color: 'Black', Capacity: '500ML' }
    ),
    false
  );
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

test('inventory-only update does not recompute variant id', () => {
  assert.equal(
    shouldRecomputeSupplierVariantKeyOnUpdate({
      specificationsProvided: false,
      specificationsChanged: false
    }),
    false
  );
});

test('same specs with inventory save does not recompute variant id', () => {
  assert.equal(
    shouldRecomputeSupplierVariantKeyOnUpdate({
      specificationsProvided: true,
      specificationsChanged: false
    }),
    false
  );
});

test('changed specs recompute a new variant id', () => {
  assert.equal(
    shouldRecomputeSupplierVariantKeyOnUpdate({
      specificationsProvided: true,
      specificationsChanged: true
    }),
    true
  );
});

test('shouldAutoApproveSupplierOfferOnCreate approves when same variant already approved', () => {
  assert.equal(
    shouldAutoApproveSupplierOfferOnCreate({
      hasApprovedSameVariantOffer: true,
      catalogProductStatus: 'pending',
      hasAnyApprovedOfferForProduct: false,
      matchStrength: 'none'
    }),
    true
  );
});

test('shouldAutoApproveSupplierOfferOnCreate approves explicit re-list of approved catalog', () => {
  assert.equal(
    shouldAutoApproveSupplierOfferOnCreate({
      hasApprovedSameVariantOffer: false,
      catalogProductStatus: 'approved',
      hasAnyApprovedOfferForProduct: false,
      matchStrength: 'explicit'
    }),
    true
  );
});

test('shouldAutoApproveSupplierOfferOnCreate approves strong identity match when catalog is approved', () => {
  assert.equal(
    shouldAutoApproveSupplierOfferOnCreate({
      hasApprovedSameVariantOffer: false,
      catalogProductStatus: 'approved',
      hasAnyApprovedOfferForProduct: false,
      matchStrength: 'strong'
    }),
    true
  );
});

test('shouldAutoApproveSupplierOfferOnCreate keeps weak name-only match pending', () => {
  assert.equal(
    shouldAutoApproveSupplierOfferOnCreate({
      hasApprovedSameVariantOffer: false,
      catalogProductStatus: 'approved',
      hasAnyApprovedOfferForProduct: true,
      matchStrength: 'weak'
    }),
    false
  );
});

test('shouldAutoApproveSupplierOfferOnCreate keeps brand-new products pending', () => {
  assert.equal(
    shouldAutoApproveSupplierOfferOnCreate({
      hasApprovedSameVariantOffer: false,
      catalogProductStatus: 'pending',
      hasAnyApprovedOfferForProduct: false,
      matchStrength: 'none'
    }),
    false
  );
});

test('shouldAutoApproveSupplierOfferOnCreate does not approve mere catalog status without strong match', () => {
  assert.equal(
    shouldAutoApproveSupplierOfferOnCreate({
      hasApprovedSameVariantOffer: false,
      catalogProductStatus: 'approved',
      hasAnyApprovedOfferForProduct: false,
      matchStrength: 'none'
    }),
    false
  );
});

test('shouldAutoApproveSupplierOfferOnCreate keeps confirmed re-list pending when specs changed', () => {
  assert.equal(
    shouldAutoApproveSupplierOfferOnCreate({
      hasApprovedSameVariantOffer: false,
      catalogProductStatus: 'approved',
      hasAnyApprovedOfferForProduct: true,
      matchStrength: 'explicit',
      hasSpecificationChanges: true
    }),
    false
  );
});

test('hasSupplierSpecificationChangesFromCatalog detects changed values', () => {
  assert.equal(
    hasSupplierSpecificationChangesFromCatalog({
      catalogSpecs: { ram: '8GB', storage: '256GB' },
      supplierSpecs: { ram: '16GB', storage: '256GB' }
    }),
    true
  );
});

test('hasSupplierSpecificationChangesFromCatalog treats matching values as unchanged', () => {
  assert.equal(
    hasSupplierSpecificationChangesFromCatalog({
      catalogSpecs: { ram: '8GB', storage: '256GB' },
      supplierSpecs: { storage: '256GB', ram: '8gb' }
    }),
    false
  );
});

test('hasSupplierSpecificationChangesFromCatalog ignores extra template keys when core values match', () => {
  assert.equal(
    hasSupplierSpecificationChangesFromCatalog({
      catalogSpecs: { ram: '8GB' },
      supplierSpecs: { ram: '8GB', color: 'Black' }
    }),
    false
  );
});

test('hasSupplierSpecificationChangesFromCatalog ignores empty catalog baseline', () => {
  assert.equal(
    hasSupplierSpecificationChangesFromCatalog({
      catalogSpecs: { ram: '', storage: null },
      supplierSpecs: { ram: '8GB', storage: '256GB' }
    }),
    false
  );
});

test('shouldRecomputeSupplierVariantKeyOnUpdate is false for inventory-only saves', () => {
  assert.equal(
    shouldRecomputeSupplierVariantKeyOnUpdate({
      specificationsProvided: false,
      specificationsChanged: false,
      computedVariantKey: 'next-key',
      storedVariantKey: 'stored-key'
    }),
    false
  );
});

test('shouldRecomputeSupplierVariantKeyOnUpdate is true when specs changed', () => {
  assert.equal(
    shouldRecomputeSupplierVariantKeyOnUpdate({
      specificationsProvided: true,
      specificationsChanged: true,
      computedVariantKey: 'next-key',
      storedVariantKey: 'stored-key'
    }),
    true
  );
});

test('shouldRecomputeSupplierVariantKeyOnUpdate is false when specs are unchanged even if computed key drifts', () => {
  assert.equal(
    shouldRecomputeSupplierVariantKeyOnUpdate({
      specificationsProvided: true,
      specificationsChanged: false,
      computedVariantKey: 'next-key-from-catalog-drift',
      storedVariantKey: 'stored-key'
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
