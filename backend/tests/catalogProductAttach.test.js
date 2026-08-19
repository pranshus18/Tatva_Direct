import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogBrandsCompatible,
  catalogBrandsConflict,
  pickExactCatalogLookupProduct
} from '../utils/catalogProductAttach.js';

test('catalogBrandsConflict is true for Nothing vs JBL', () => {
  assert.equal(catalogBrandsConflict('Nothing', 'JBL'), true);
  assert.equal(catalogBrandsCompatible('Nothing', 'JBL'), false);
  assert.equal(catalogBrandsConflict('Philips', 'Phillips'), true);
  assert.equal(catalogBrandsCompatible('Philips', 'Phillips'), false);
  assert.equal(catalogBrandsConflict('Nothing', ''), false);
});

test('pickExactCatalogLookupProduct requires exact name and matching brand', () => {
  const catalog = [
    {
      id: 'jbl-1',
      name: 'JBL Wireless Over-Ear Headphones',
      brand: 'JBL',
      category: 'electronics'
    },
    {
      id: 'nothing-1',
      name: 'Nothing Power (45W)',
      brand: 'Nothing',
      category: 'electronics'
    }
  ];

  assert.equal(
    pickExactCatalogLookupProduct(catalog, {
      name: 'Nothing Power (45W)',
      brand: 'Nothing'
    })?.id,
    'nothing-1'
  );
  assert.equal(
    pickExactCatalogLookupProduct(catalog, {
      name: 'Nothing Power (45W)',
      brand: 'JBL'
    }),
    null
  );
  assert.equal(
    pickExactCatalogLookupProduct(catalog, {
      name: 'Nothing Power',
      brand: 'Nothing'
    }),
    null
  );
  assert.equal(
    pickExactCatalogLookupProduct(catalog, {
      name: 'JBL Wireless Over-Ear Headphones',
      brand: 'Nothing'
    }),
    null
  );
  assert.equal(
    pickExactCatalogLookupProduct(catalog, {
      name: 'Nothing Power (45W)'
    }),
    null
  );
});
