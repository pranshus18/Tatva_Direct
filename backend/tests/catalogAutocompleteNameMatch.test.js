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

test('Nothing Power query does not return JBL catalog rows', () => {
  const catalog = [
    { id: 'jbl-1', name: 'JBL Wireless Over-Ear Headphones', brand: 'JBL' },
    { id: 'nothing-1', name: 'Nothing Power (45W)', brand: 'Nothing' }
  ];
  const hits = filterCatalogAutocompleteNameMatches('Nothing Power (45W)', catalog);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, 'nothing-1');
  assert.equal(hits[0].brand, 'Nothing');
});

test('Nothing Power query does not attach to JBL when Nothing is not in the catalog yet', () => {
  const catalog = [
    { id: 'jbl-1', name: 'JBL Charge Powerbank', brand: 'JBL' },
    { id: 'jbl-2', name: 'JBL Wireless Over-Ear Headphones', brand: 'JBL' }
  ];
  assert.deepEqual(filterCatalogAutocompleteNameMatches('Nothing Power (45W)', catalog), []);
});
