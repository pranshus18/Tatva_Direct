import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catalogBrandsCompatible,
  catalogBrandsConflict,
  catalogCategoriesCompatible,
  catalogCategoriesConflict,
  catalogListingIdentityConflicts,
  catalogOfferIdentityConflicts,
  inferDeclaredBrandFromProductName,
  pickExactCatalogLookupProduct,
  resolveListingBrandIdentity
} from '../utils/catalogProductAttach.js';

test('catalogBrandsConflict is true for Nothing vs JBL', () => {
  assert.equal(catalogBrandsConflict('Nothing', 'JBL'), true);
  assert.equal(catalogBrandsCompatible('Nothing', 'JBL'), false);
  assert.equal(catalogBrandsConflict('Philips', 'Phillips'), true);
  assert.equal(catalogBrandsCompatible('Philips', 'Phillips'), false);
  assert.equal(catalogBrandsConflict('Nothing', ''), false);
});

test('catalogCategoriesConflict treats flasks and footwear as different products', () => {
  assert.equal(catalogCategoriesConflict('flasks & bottles', 'footwear'), true);
  assert.equal(catalogCategoriesCompatible('flasks & bottles', 'footwear'), false);
  assert.equal(catalogCategoriesCompatible('Footwear', 'footwear'), true);
  assert.equal(catalogCategoriesConflict('flasks & bottles', ''), false);
});

test('catalogListingIdentityConflicts detects name or category mismatch', () => {
  assert.equal(
    catalogListingIdentityConflicts({
      catalogName: 'Stella Suede Ballet Flat with Iridescent Accent.',
      catalogCategory: 'footwear',
      listingName: 'Milton Thermosteel Flask',
      listingCategory: 'flasks & bottles'
    }),
    true
  );
  assert.equal(
    catalogListingIdentityConflicts({
      catalogName: 'Milton Thermosteel Flask',
      catalogCategory: 'flasks & bottles',
      listingName: 'Milton Thermosteel Flask',
      listingCategory: 'flasks & bottles'
    }),
    false
  );
});

test('catalogOfferIdentityConflicts is true for Nothing Power on a JBL catalog row', () => {
  assert.equal(
    catalogOfferIdentityConflicts(
      {
        name: 'JBL Wireless Over-Ear Headphones',
        brand: 'JBL',
        category: 'electronics'
      },
      {
        listingName: 'Nothing Power (45W)',
        brand: 'Nothing',
        category: 'electronics'
      }
    ),
    true
  );
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

test('inferDeclaredBrandFromProductName maps Nothing Power to Nothing not JBL', () => {
  const declared = ['JBL', 'Nothing'];
  assert.equal(inferDeclaredBrandFromProductName('Nothing Power (45W)', declared), 'Nothing');
  assert.equal(
    resolveListingBrandIdentity({
      selectedBrand: 'JBL',
      catalogBrand: 'JBL',
      productName: 'Nothing Power (45W)',
      declaredLabels: declared
    }),
    'Nothing'
  );
});
