import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAsinLikeId,
  buildVariantAsinLikeId,
  buildIdentityBundle,
  isLegacyCatalogTsin,
  isPersistableProductBarcode,
  CATALOG_TSIN_TOTAL_LENGTH,
  VARIANT_TSIN_TOTAL_LENGTH,
  CATALOG_TSIN_BODY_LENGTH,
  VARIANT_TSIN_BODY_LENGTH,
  LEGACY_VARIANT_TSIN_BODY_LENGTH
} from '../services/productIdentityService.js';

test('buildAsinLikeId produces exactly 5-char catalog TSINs (TS + 3)', () => {
  const tsin = buildAsinLikeId({
    name: 'Steel Bottle',
    category: 'Kitchen',
    brand: 'Milton',
    unit: 'nos'
  });
  assert.match(tsin, /^TS[A-Z0-9]{3}$/);
  assert.equal(tsin.length, CATALOG_TSIN_TOTAL_LENGTH);
  assert.equal(CATALOG_TSIN_BODY_LENGTH, 3);
});

test('buildAsinLikeId is deterministic for the same catalog identity', () => {
  const catalog = {
    name: 'Steel Bottle',
    category: 'Kitchen',
    brand: 'Milton',
    unit: 'nos'
  };
  assert.equal(buildAsinLikeId(catalog), buildAsinLikeId(catalog));
});

test('buildAsinLikeId diverges for meaningfully different catalogs', () => {
  const a = buildAsinLikeId({ name: 'Bottle A', category: 'Kitchen', brand: 'Milton' });
  const b = buildAsinLikeId({ name: 'Bottle B', category: 'Kitchen', brand: 'Milton' });
  assert.notEqual(a, b);
});

test('isLegacyCatalogTsin recognizes legacy 4-char parent codes only', () => {
  assert.equal(isLegacyCatalogTsin('TS22'), true);
  assert.equal(isLegacyCatalogTsin('TSA7'), true);
  assert.equal(isLegacyCatalogTsin('TSA7K'), false);
  assert.equal(isLegacyCatalogTsin('TSA7K3M'), false);
  assert.equal(isLegacyCatalogTsin(''), false);
});

test('buildVariantAsinLikeId produces 7-char TSINs for legacy 4-char parents', () => {
  const parent = 'TSA7';
  const variantKey = '069d7926b78243e48b2325c0792e7fb577e6dc559b9212a3756f7532d62507a9';
  const variantTsin = buildVariantAsinLikeId(parent, variantKey);
  assert.match(variantTsin, /^TS[A-Z0-9]{5}$/);
  assert.equal(variantTsin.length, VARIANT_TSIN_TOTAL_LENGTH);
  assert.equal(variantTsin.slice(0, parent.length), parent);
  assert.equal(LEGACY_VARIANT_TSIN_BODY_LENGTH, 3);
  assert.equal(buildVariantAsinLikeId(parent, variantKey), variantTsin);
});

test('buildVariantAsinLikeId produces 7-char TSINs for new 5-char parents', () => {
  const parent = buildAsinLikeId({
    name: 'Steel Bottle',
    category: 'Kitchen',
    brand: 'Milton'
  });
  assert.equal(parent.length, 5);
  assert.equal(isLegacyCatalogTsin(parent), false);

  const variantKey = 'variant-key-black-500ml';
  const variantTsin = buildVariantAsinLikeId(parent, variantKey);
  assert.match(variantTsin, /^TS[A-Z0-9]{5}$/);
  assert.equal(variantTsin.length, VARIANT_TSIN_TOTAL_LENGTH);
  assert.equal(variantTsin.slice(0, parent.length), parent);
  assert.equal(VARIANT_TSIN_BODY_LENGTH, 2);
  assert.equal(buildVariantAsinLikeId(parent, variantKey), variantTsin);
});

test('buildVariantAsinLikeId separates variants on the same new parent', () => {
  const parent = buildAsinLikeId({ name: 'Shared Parent', category: 'Tools', brand: 'Bosch' });
  const variantA = buildVariantAsinLikeId(parent, 'variant-a');
  const variantB = buildVariantAsinLikeId(parent, 'variant-b');
  assert.notEqual(variantA, variantB);
  assert.equal(variantA.length, 7);
  assert.equal(variantB.length, 7);
  assert.equal(variantA.slice(0, parent.length), parent);
  assert.equal(variantB.slice(0, parent.length), parent);
});

test('buildIdentityBundle wires 5-char catalog and 7-char variant TSINs', () => {
  const bundle = buildIdentityBundle({
    name: 'Drill Machine',
    category: 'Tools',
    brand: 'Bosch',
    specifications: { voltage: '18v' }
  });
  assert.match(bundle.asinLikeId, /^TS[A-Z0-9]{3}$/);
  assert.equal(bundle.asinLikeId.length, 5);
  assert.equal(bundle.variantAsinLikeId, buildVariantAsinLikeId(bundle.asinLikeId, bundle.variantKey));
  assert.equal(bundle.variantAsinLikeId.length, 7);
});

test('buildAsinLikeId stays mostly unique across moderate catalog volume', () => {
  const seen = new Set();
  const sampleSize = 1000;
  for (let i = 0; i < sampleSize; i += 1) {
    const tsin = buildAsinLikeId({
      name: `Product ${i}`,
      category: 'Category',
      brand: `Brand ${i % 97}`,
      unit: 'nos'
    });
    assert.equal(tsin.length, 5);
    seen.add(tsin);
  }
  // ~46k code space (36^3): expect high uniqueness at 1k sample size.
  assert.ok(seen.size / sampleSize >= 0.98, `expected >=98% unique, got ${seen.size}/${sampleSize}`);
});

test('description starting with the product name does not change variant identity', () => {
  const specs = { COLOR: 'Black', 'PRODUCT TYPE': '45W Fast Adapter' };
  const withoutDescription = buildIdentityBundle({
    name: '45W Fast Adapter',
    brand: 'Anker',
    category: 'Chargers',
    specifications: specs
  });
  const descriptionStartsWithName = buildIdentityBundle({
    name: '45W Fast Adapter',
    brand: 'Anker',
    category: 'Chargers',
    specifications: {
      ...specs,
      description: '45W Fast Adapter is a compact USB-C charger for phones and laptops.',
      name: '45W Fast Adapter'
    }
  });
  assert.equal(withoutDescription.variantKey, descriptionStartsWithName.variantKey);
  assert.equal(withoutDescription.catalogKey, descriptionStartsWithName.catalogKey);
});

test('isPersistableProductBarcode rejects the product name and description copy', () => {
  const name = '45W Fast Adapter';
  const description = '45W Fast Adapter is a compact USB-C charger.';
  assert.equal(isPersistableProductBarcode(name, { name, description }), false);
  assert.equal(isPersistableProductBarcode(description, { name, description }), false);
  assert.equal(isPersistableProductBarcode('8901234567890', { name, description }), true);
});
