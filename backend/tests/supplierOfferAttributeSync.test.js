import test from 'node:test';
import assert from 'node:assert/strict';
import {
  syncOfferAttributesWithSpecifications,
  normalizeVariantAttributes
} from '../services/productIdentityService.js';
import {
  mergeOfferSpecifications,
  resolveSupplierOfferDisplaySpecifications
} from '../services/supplierCatalogHelpersService.js';

test('syncOfferAttributesWithSpecifications mirrors specifications into variantAttributes', () => {
  const synced = syncOfferAttributesWithSpecifications({
    specifications: { Color: 'black', Capacity: '500ML', 'BPA-Free': 'Yes' },
    variantAttributes: { color: 'silver', capacity: '1 l' }
  });

  assert.equal(synced.specifications.Color, 'black');
  assert.equal(synced.variantAttributes.color, 'black');
  assert.equal(synced.variantAttributes.capacity, '500ml');
  assert.equal(synced.variantAttributes['bpa-free'], 'yes');
});

test('resolveSupplierOfferDisplaySpecifications matches mergeOfferSpecifications', () => {
  const catalog = { Color: 'Silver', Capacity: '1 L' };
  const attributes = {
    specifications: { Color: 'black', Capacity: '500ML' },
    variantAttributes: { color: 'silver', capacity: '1 l' }
  };
  const viaHelper = resolveSupplierOfferDisplaySpecifications(catalog, attributes);
  const viaMerge = mergeOfferSpecifications(catalog, { attributes });
  assert.deepEqual(viaHelper, viaMerge);
  assert.equal(viaHelper.Color, 'black');
  assert.equal(viaHelper.Capacity, '500ML');
});

test('normalizeVariantAttributes ignores empty specification placeholders', () => {
  const attrs = normalizeVariantAttributes({
    Color: '',
    Capacity: '500ML',
    Height: null
  });
  assert.equal(attrs.color, undefined);
  assert.equal(attrs.capacity, '500ml');
});
