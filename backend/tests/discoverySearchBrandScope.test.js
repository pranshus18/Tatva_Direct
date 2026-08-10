import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldBrandScopeDiscoverySearch,
  shouldCatalogAutocompleteSearch,
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

test('catalog autocomplete opts out of brand scoping so all approved products are searchable', () => {
  assert.equal(shouldCatalogAutocompleteSearch({ catalogAutocomplete: '1' }), true);
  assert.equal(shouldCatalogAutocompleteSearch({ scope: 'catalog' }), true);
  assert.equal(shouldBrandScopeDiscoverySearch({ brandScoped: '1', catalogAutocomplete: '1' }), false);
  assert.equal(shouldBrandScopeDiscoverySearch({ catalogAutocomplete: 'true' }), false);
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

test('mergeOwnedIntoDiscoverySuggestions keeps pending owned products and dedupes by id', async () => {
  const { mergeOwnedIntoDiscoverySuggestions } = await import(
    '../services/productDiscoverySearchService.js'
  );

  const merged = mergeOwnedIntoDiscoverySuggestions(
    [
      { id: 'approved-1', name: 'LG Fridge 260L', brand: 'LG', supplierCount: 2 },
      { id: 'shared-1', name: 'Shared SKU', brand: 'LG', supplierCount: 3 }
    ],
    [
      {
        id: 'pending-1',
        name: 'LG TV 43',
        brand: 'LG',
        status: 'pending',
        ownedBySupplier: true,
        offerStatus: 'pending',
        supplierCount: 1
      },
      {
        id: 'shared-1',
        name: 'Shared SKU (mine)',
        brand: 'LG',
        ownedBySupplier: true,
        offerStatus: 'pending',
        supplierCount: 1
      }
    ],
    { query: 'lg' }
  );

  const ids = merged.map((row) => row.id);
  assert.ok(ids.includes('pending-1'));
  assert.ok(ids.includes('approved-1'));
  assert.equal(ids.filter((id) => id === 'shared-1').length, 1);
  const shared = merged.find((row) => row.id === 'shared-1');
  assert.equal(shared.ownedBySupplier, true);
  assert.equal(shared.name, 'Shared SKU (mine)');
});
