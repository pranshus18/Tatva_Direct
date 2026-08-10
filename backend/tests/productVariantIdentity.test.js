import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIdentityBundle,
  buildSupplierVariantIdentity,
  resolveSupplierVariantKeyForItem,
  hasSupplierVariantSignals
} from '../services/productIdentityService.js';
import { resolveVariantTsin, resolveParentTsin } from '../controllers/supplier/shared/productHelpers.js';
import {
  mergeOrderItemSpecificationsForDisplay,
  ORDER_SNAPSHOT_META_KEYS
} from '../services/supplierCatalogHelpersService.js';

test('buildSupplierVariantIdentity: catalog weight changes variant key vs offer-only', () => {
  const parent = { specifications: { weight: '1.5 kg' } };
  const offerOnly = buildIdentityBundle({ specifications: {} });
  const merged = buildSupplierVariantIdentity({ specifications: {} }, parent);
  assert.notEqual(merged.variantKey, offerOnly.variantKey);
  assert.equal(merged.variant.variantAttributes.weight, '1.5 kg');
});

test('buildSupplierVariantIdentity: offer specs override empty catalog slots', () => {
  const parent = { specifications: { finish: 'matt' } };
  const merged = buildSupplierVariantIdentity({ specifications: { weight: '2 kg' } }, parent);
  assert.equal(merged.variant.variantAttributes.finish, 'matt');
  assert.equal(merged.variant.variantAttributes.weight, '2 kg');
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

test('resolveVariantTsin: returns stored supplier variant_asin even when not TSxxxx format', () => {
  const legacy = 'A1B2C3D4E5F6';
  assert.equal(resolveVariantTsin('TS22', 'some-key', legacy), legacy);
  assert.equal(resolveParentTsin('ts22'), 'TS22');
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
