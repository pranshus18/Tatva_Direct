import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCatalogAutocompleteNameMatches } from '../services/productDiscoverySearchService.js';

test('filterCatalogAutocompleteNameMatches returns empty for brand-new product names', () => {
  const catalog = [
    { id: '1', name: 'Fastrack Reflex Analog Men Watch', brand: 'Fastrack' },
    { id: '2', name: 'Cement OPC 53 Grade', brand: 'UltraTech' }
  ];

  assert.deepEqual(
    filterCatalogAutocompleteNameMatches('Completely New Widget ZX-999', catalog),
    []
  );
  assert.deepEqual(filterCatalogAutocompleteNameMatches('SPARSGA Unique SKU', catalog), []);
});

test('filterCatalogAutocompleteNameMatches keeps real catalog / variant name hits', () => {
  const catalog = [
    { id: '1', name: 'Fastrack Reflex Analog Men Watch', brand: 'Fastrack' },
    { id: '2', name: 'Cement OPC 53 Grade', brand: 'UltraTech' },
    { id: '3', name: 'TMT Steel Bar 12mm', brand: 'Tata' }
  ];

  const watchHits = filterCatalogAutocompleteNameMatches('Fastrack Reflex', catalog);
  assert.equal(watchHits.length, 1);
  assert.equal(watchHits[0].id, '1');

  const cementHits = filterCatalogAutocompleteNameMatches('Cement OPC', catalog);
  assert.equal(cementHits.length, 1);
  assert.equal(cementHits[0].id, '2');
});
