import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIdentityBundle,
  buildSupplierVariantIdentity,
  buildVariantAsinLikeId,
  resolveStableVariantIdentityFromExistingOffers,
  resolveSupplierVariantKeyForItem,
  hasSupplierVariantSignals
} from '../services/productIdentityService.js';
import { resolveVariantTsin, resolveParentTsin } from '../controllers/supplier/shared/productHelpers.js';
import {
  mergeOrderItemSpecificationsForDisplay,
  ORDER_SNAPSHOT_META_KEYS
} from '../services/supplierCatalogHelpersService.js';

test('buildSupplierVariantIdentity: supplier SKU does not change the variant key', () => {
  const parent = { specifications: { Color: 'White', Series: 'Continental', Weight: '17.5 kg' } };
  const first = buildSupplierVariantIdentity(
    { specifications: { Color: 'White', Series: 'Continental', Weight: '17.5 kg' }, sku: 'LOKESH-1' },
    parent
  );
  const second = buildSupplierVariantIdentity(
    { specifications: { Color: 'White', Series: 'Continental', Weight: '17.5 kg' }, sku: 'SPARSHA-9' },
    parent
  );
  assert.equal(first.variantKey, second.variantKey);
  assert.equal(
    buildVariantAsinLikeId('TSPCYY1', first.variantKey),
    buildVariantAsinLikeId('TSPCYY1', second.variantKey)
  );
});

test('resolveStableVariantIdentityFromExistingOffers reuses catalog variant when offer specs are empty', () => {
  const catalogSpecs = { Color: 'White', Series: 'Continental', Weight: '17.5 kg' };
  const parent = { specifications: catalogSpecs, asin: 'TSPCYY1' };
  const computed = buildSupplierVariantIdentity(
    { specifications: catalogSpecs, sku: 'NEW-SUPPLIER' },
    parent
  );

  const stable = resolveStableVariantIdentityFromExistingOffers({
    parentAsin: 'TSPCYY1',
    parentProduct: parent,
    computedIdentity: computed,
    offerSpecifications: catalogSpecs,
    catalogSpecifications: catalogSpecs,
    specsUnchangedFromCatalog: true,
    existingOffers: [
      {
        status: 'approved',
        is_active: true,
        variant_key: 'stored-jaquar-wc',
        variant_asin: 'TSPCYY1JI',
        attributes: { sku: 'SPARSHA-SKU', specifications: {} }
      }
    ]
  });

  assert.equal(stable.reused, true);
  assert.equal(stable.variantKey, 'stored-jaquar-wc');
  assert.equal(stable.variantAsin, 'TSPCYY1JI');
});

test('buildSupplierVariantIdentity: catalog filled values do not change variant key vs offer-only', () => {
  const parent = { specifications: { weight: '1.5 kg', Color: 'Silver' } };
  const offerOnly = buildIdentityBundle({ specifications: { Color: 'Black' } });
  const merged = buildSupplierVariantIdentity({ specifications: { Color: 'Black' } }, parent);
  assert.equal(merged.variantKey, offerOnly.variantKey);
  assert.equal(merged.variant.variantAttributes.color, 'black');
  assert.equal(merged.variant.variantAttributes.weight, undefined);
});

test('buildSupplierVariantIdentity: empty offer does not inherit catalog filled values into identity', () => {
  const parent = { specifications: { weight: '1.5 kg' } };
  const offerOnly = buildIdentityBundle({ specifications: {} });
  const merged = buildSupplierVariantIdentity({ specifications: {} }, parent);
  assert.equal(merged.variantKey, offerOnly.variantKey);
  assert.equal(merged.variant.variantAttributes.weight, undefined);
});

test('buildSupplierVariantIdentity: changed offer specs produce a different variant key', () => {
  const parent = {
    specifications: {
      COLOR: 'Black',
      'FILTER TYPE': 'Pure Air Filter',
      'STAR RATING': '3 Star',
      'AIR FLOW VOLUME': '740 CMH (435 CFM)'
    }
  };
  const sameAsCatalog = buildSupplierVariantIdentity(
    {
      specifications: {
        COLOR: 'Black',
        'FILTER TYPE': 'Pure Air Filter',
        'STAR RATING': '3 Star',
        'AIR FLOW VOLUME': '740 CMH (435 CFM)'
      }
    },
    parent
  );
  const changedVariant = buildSupplierVariantIdentity(
    {
      specifications: {
        COLOR: 'White',
        'FILTER TYPE': 'Pure Air Filter',
        'STAR RATING': '3 Star',
        'AIR FLOW VOLUME': '740 CMH (435 CFM)'
      }
    },
    parent
  );

  assert.equal(sameAsCatalog.variant.variantAttributes.color, 'black');
  assert.equal(changedVariant.variant.variantAttributes.color, 'white');
  assert.notEqual(changedVariant.variantKey, sameAsCatalog.variantKey);
});

test('buildSupplierVariantIdentity: same offer specs keep the same Variant TSIN even if catalog drifts', () => {
  const offerSpecs = {
    COLOR: 'Black',
    Capacity: '500ML'
  };
  const first = buildSupplierVariantIdentity(
    { specifications: offerSpecs },
    { specifications: { COLOR: 'Silver', Capacity: '1 L' }, asin: 'TSA7K' }
  );
  const second = buildSupplierVariantIdentity(
    { specifications: offerSpecs },
    {
      specifications: { COLOR: 'Gold', Capacity: '2 L', Height: '8 inch' },
      asin: 'TSA7K'
    }
  );
  assert.equal(first.variantKey, second.variantKey);
  assert.equal(
    buildVariantAsinLikeId('TSA7K', first.variantKey),
    buildVariantAsinLikeId('TSA7K', second.variantKey)
  );
});

test('resolveStableVariantIdentityFromExistingOffers reuses legacy key when offer specs match', () => {
  const parent = { specifications: { Color: 'Silver', Capacity: '1 L' }, asin: 'TSA7K' };
  const offerInput = {
    specifications: { Color: 'Black', Capacity: '500ML' },
    sku: 'SKU-1'
  };
  const computed = buildSupplierVariantIdentity(offerInput, parent);
  const legacyKey = 'legacy-catalog-merged-key';
  const legacyAsin = 'TSLEGACY';

  const stable = resolveStableVariantIdentityFromExistingOffers({
    parentAsin: 'TSA7K',
    parentProduct: parent,
    computedIdentity: computed,
    offerSpecifications: offerInput.specifications,
    existingOffers: [
      {
        status: 'approved',
        is_active: true,
        variant_key: legacyKey,
        variant_asin: legacyAsin,
        attributes: {
          sku: 'SKU-DIFFERENT',
          specifications: { Color: 'Black', Capacity: '500ML' }
        }
      }
    ]
  });

  assert.equal(stable.reused, true);
  assert.equal(stable.reason, 'same_offer_specs');
  assert.equal(stable.variantKey, legacyKey);
  assert.equal(stable.variantAsin, buildVariantAsinLikeId('TSA7K', legacyKey));
});

test('resolveStableVariantIdentityFromExistingOffers reuses key when variant_asin is missing on legacy offer', () => {
  const parent = { specifications: { Color: 'Black', Capacity: '500ML' }, asin: 'TSA7K' };
  const specs = { Color: 'Black', Capacity: '500ML' };
  const computed = buildSupplierVariantIdentity({ specifications: specs }, parent);

  const stable = resolveStableVariantIdentityFromExistingOffers({
    parentAsin: 'TSA7K',
    parentProduct: parent,
    computedIdentity: computed,
    offerSpecifications: specs,
    existingOffers: [
      {
        status: 'approved',
        is_active: true,
        variant_key: 'legacy-key-no-asin',
        variant_asin: '',
        attributes: { specifications: specs }
      }
    ]
  });

  assert.equal(stable.reused, true);
  assert.equal(stable.variantKey, 'legacy-key-no-asin');
  assert.ok(String(stable.variantAsin || '').trim());
});

test('resolveStableVariantIdentityFromExistingOffers reuses key when submitted only adds template fields', () => {
  const parent = { specifications: { Color: 'Black', Capacity: '500ML' }, asin: 'TSA7K' };
  const existingSpecs = { Color: 'Black', Capacity: '500ML' };
  const submittedSpecs = {
    Color: 'Black',
    Capacity: '500ML',
    Material: 'Steel',
    Finish: 'Matte'
  };
  const computed = buildSupplierVariantIdentity({ specifications: submittedSpecs }, parent);

  const stable = resolveStableVariantIdentityFromExistingOffers({
    parentAsin: 'TSA7K',
    parentProduct: parent,
    computedIdentity: computed,
    offerSpecifications: submittedSpecs,
    existingOffers: [
      {
        status: 'approved',
        is_active: true,
        variant_key: 'stored-black-500',
        variant_asin: 'TSBLK500',
        attributes: { specifications: existingSpecs }
      }
    ]
  });

  assert.equal(stable.reused, true);
  assert.equal(stable.variantKey, 'stored-black-500');
  assert.equal(stable.variantAsin, buildVariantAsinLikeId('TSA7K', 'stored-black-500'));
});

test('resolveStableVariantIdentityFromExistingOffers reuses DB variant when catalog specs are unchanged', () => {
  const catalogSpecs = { Color: 'Silver', Capacity: '1 L' };
  const parent = { specifications: catalogSpecs, asin: 'TSA7K' };
  const computed = buildSupplierVariantIdentity(
    { specifications: catalogSpecs, sku: 'SUPPLIER-B-SKU' },
    parent
  );

  const stable = resolveStableVariantIdentityFromExistingOffers({
    parentAsin: 'TSA7K',
    parentProduct: parent,
    computedIdentity: computed,
    offerSpecifications: catalogSpecs,
    catalogSpecifications: catalogSpecs,
    specsUnchangedFromCatalog: true,
    existingOffers: [
      {
        status: 'approved',
        is_active: true,
        variant_key: 'stored-db-key',
        variant_asin: 'TSSTORED',
        attributes: {
          sku: 'SUPPLIER-A-SKU',
          specifications: catalogSpecs
        }
      }
    ]
  });

  assert.equal(stable.reused, true);
  assert.equal(stable.variantKey, 'stored-db-key');
  assert.equal(stable.variantAsin, buildVariantAsinLikeId('TSA7K', 'stored-db-key'));
});

test('resolveStableVariantIdentityFromExistingOffers reuses product_variants row for unchanged catalog add', () => {
  const catalogSpecs = { Color: 'Black', Capacity: '500ML' };
  const parent = { specifications: catalogSpecs, asin: 'TSA7K' };
  const computed = buildSupplierVariantIdentity({ specifications: catalogSpecs }, parent);

  const stable = resolveStableVariantIdentityFromExistingOffers({
    parentAsin: 'TSA7K',
    parentProduct: parent,
    computedIdentity: computed,
    offerSpecifications: catalogSpecs,
    catalogSpecifications: catalogSpecs,
    specsUnchangedFromCatalog: true,
    existingOffers: [],
    existingProductVariants: [
      {
        status: 'approved',
        variant_key: 'pv-key-1',
        variant_asin: 'TSPV0001',
        canonical_attributes: { specifications: catalogSpecs }
      }
    ]
  });

  assert.equal(stable.reused, true);
  assert.equal(stable.variantKey, 'pv-key-1');
  assert.equal(stable.variantAsin, buildVariantAsinLikeId('TSA7K', 'pv-key-1'));
});

test('resolveStableVariantIdentityFromExistingOffers keeps computed identity for a new variant', () => {
  const parent = { specifications: { Color: 'Silver' }, asin: 'TSA7K' };
  const computed = buildSupplierVariantIdentity(
    { specifications: { Color: 'White' }, sku: 'SKU-NEW' },
    parent
  );
  const stable = resolveStableVariantIdentityFromExistingOffers({
    parentAsin: 'TSA7K',
    parentProduct: parent,
    computedIdentity: computed,
    offerSpecifications: { Color: 'White' },
    existingOffers: [
      {
        status: 'approved',
        variant_key: 'other-key',
        variant_asin: 'TSOTHER1',
        attributes: {
          sku: 'SKU-OLD',
          specifications: { Color: 'Black' }
        }
      }
    ]
  });

  assert.equal(stable.reused, false);
  assert.equal(stable.variantKey, computed.variantKey);
  assert.equal(stable.variantAsin, buildVariantAsinLikeId('TSA7K', computed.variantKey));
});

test('resolveStableVariantIdentityFromExistingOffers does not reuse a single existing key for a different filled variant', () => {
  const parent = { specifications: {}, asin: 'TSA7K' };
  const submitted = { Color: 'White', Capacity: '1 L' };
  const computed = buildSupplierVariantIdentity({ specifications: submitted }, parent);
  const stable = resolveStableVariantIdentityFromExistingOffers({
    parentAsin: 'TSA7K',
    parentProduct: parent,
    computedIdentity: computed,
    offerSpecifications: submitted,
    catalogSpecifications: {},
    specsUnchangedFromCatalog: true,
    existingOffers: [
      {
        status: 'approved',
        is_active: true,
        variant_key: 'only-existing-key',
        variant_asin: 'TSONLY01',
        attributes: {
          specifications: { Color: 'Black', Capacity: '500ML' }
        }
      }
    ]
  });

  assert.equal(stable.reused, false);
  assert.equal(stable.variantKey, computed.variantKey);
  assert.notEqual(stable.variantKey, 'only-existing-key');
});

test('resolveSupplierVariantKeyForItem: prefers supplier-page variantKey on cart line', () => {
  const parent = { specifications: { weight: '1.5 kg' } };
  const computed = buildSupplierVariantIdentity({ specifications: {} }, parent).variantKey;
  const resolved = resolveSupplierVariantKeyForItem(
    { variantKey: 'supplier-page-key-abc', specifications: {} },
    parent
  );
  assert.equal(resolved, 'supplier-page-key-abc');
  assert.notEqual(resolved, computed);
});

test('hasSupplierVariantSignals: true when only variantAttributes differ', () => {
  const identity = buildSupplierVariantIdentity({ specifications: { weight: '1.5 kg' } });
  assert.equal(hasSupplierVariantSignals({ specifications: { weight: '1.5 kg' } }, identity), true);
});

test('resolveVariantTsin rebuilds outdated stored TSINs onto current parent + 2 chars', () => {
  const parent = 'TSA7K3M';
  const rebuilt = resolveVariantTsin(parent, 'some-key', 'TSCYE7HNUN');
  assert.equal(rebuilt, buildVariantAsinLikeId(parent, 'some-key'));
  assert.match(rebuilt, /^TS[A-Z0-9]{7}$/);
  assert.equal(rebuilt.slice(0, parent.length), parent);

  const current = `${parent}9K`;
  assert.equal(resolveVariantTsin(parent, 'some-key', current), current);
  assert.equal(resolveParentTsin('tsa7k3m'), 'TSA7K3M');
});

test('mergeOrderItemSpecificationsForDisplay: keeps snapshot identity, not live catalog drift', () => {
  const productSpecs = { weight: '9 kg', variantKey: 'live-wrong' };
  const snapshot = {
    parentAsin: 'TS22',
    variantKey: '069d7926b78243e48b2325c0792e7fb577e6dc559b9212a3756f7532d62507a9',
    variantAttributes: { weight: '1.5 kg' },
    snapshotAt: '2026-05-14T10:58:35.113Z'
  };
  const merged = mergeOrderItemSpecificationsForDisplay(productSpecs, snapshot);
  assert.equal(merged.variantKey, snapshot.variantKey);
  assert.equal(merged.parentAsin, 'TS22');
  assert.deepEqual(merged.variantAttributes, { weight: '1.5 kg' });
  assert.ok(ORDER_SNAPSHOT_META_KEYS.has('variantKey'));
});
