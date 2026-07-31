import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldBrandScopeDiscoverySearch,
  filterSuggestionsBySupplierBrandAccess
} from '../controllers/supplier/catalogRoutes.js';

test('buyer discovery search is not brand-scoped by default', () => {
  assert.equal(shouldBrandScopeDiscoverySearch({}), false);
  assert.equal(shouldBrandScopeDiscoverySearch({ q: 'cement', limit: '24', page: '1' }), false);
});

test('supplier product-management autocomplete can opt into brand scoping', () => {
  assert.equal(shouldBrandScopeDiscoverySearch({ brandScoped: '1' }), true);
  assert.equal(shouldBrandScopeDiscoverySearch({ brand_scoped: 'true' }), true);
  assert.equal(shouldBrandScopeDiscoverySearch({ scope: 'supplier' }), true);
  assert.equal(shouldBrandScopeDiscoverySearch({ scope: 'buyer' }), false);
});

test('brand-scoped filter hides catalog when supplier has no declared brands', () => {
  const suggestions = [
    { id: '1', name: 'ACC cement', brand: 'acc' },
    { id: '2', name: 'Mac Air M1', brand: 'apple' }
  ];
  const emptyProfile = {
    registeredRoles: ['service_provider', 'supplier']
  };

  assert.deepEqual(filterSuggestionsBySupplierBrandAccess(suggestions, emptyProfile), []);
});

test('brand-scoped filter keeps brands declared on the supplier profile', () => {
  const suggestions = [
    { id: '1', name: 'ACC cement', brand: 'acc' },
    { id: '2', name: 'Mac Air M1', brand: 'apple' }
  ];
  const profile = {
    brands: 'ACC, JSW',
    supplierRole: 'stockist'
  };

  const visible = filterSuggestionsBySupplierBrandAccess(suggestions, profile);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, '1');
});
