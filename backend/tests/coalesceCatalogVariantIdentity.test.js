import test from 'node:test';
import assert from 'node:assert/strict';
import {
  offersRepresentSameCatalogVariant,
  clusterOffersBySameCatalogVariant,
  pickCanonicalOfferForVariantCluster,
  planCatalogVariantIdentityCoalesce
} from '../services/coalesceCatalogVariantIdentityService.js';

const catalogWcSpecs = { Color: 'White', Series: 'Continental', Weight: '17.5 kg' };

const lokesh = {
  id: 'lokesh',
  supplier_id: 'supplier-lokesh',
  product_id: 'prod-wc',
  outlet_id: 'out-1',
  price: 0,
  status: 'approved',
  is_active: true,
  variant_key: 'key-yl',
  variant_asin: 'TSPCYY1YL',
  created_at: '2026-08-30T10:00:00.000Z',
  attributes: { specifications: {} }
};

const sparsha = {
  id: 'sparsha',
  supplier_id: 'supplier-sparsha',
  product_id: 'prod-wc',
  outlet_id: 'out-2',
  price: 10500,
  status: 'approved',
  is_active: true,
  variant_key: 'key-ji',
  variant_asin: 'TSPCYY1JI',
  product_variant_id: 'pv-ji',
  created_at: '2026-08-01T10:00:00.000Z',
  attributes: { specifications: {} }
};

test('same catalog WC offers cluster even with leftover empty specs', () => {
  assert.equal(offersRepresentSameCatalogVariant(lokesh, sparsha, catalogWcSpecs), true);
  const clusters = clusterOffersBySameCatalogVariant([lokesh, sparsha], catalogWcSpecs);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].length, 2);
});

test('different colors stay on different variant numbers', () => {
  const white = {
    ...sparsha,
    id: 'white',
    attributes: { specifications: { Color: 'White' } }
  };
  const black = {
    ...lokesh,
    id: 'black',
    price: 8000,
    variant_key: 'key-black',
    variant_asin: 'TSPCYY1BK',
    attributes: { specifications: { Color: 'Black' } }
  };
  assert.equal(offersRepresentSameCatalogVariant(white, black, catalogWcSpecs), false);
  assert.equal(clusterOffersBySameCatalogVariant([white, black], catalogWcSpecs).length, 2);
});

test('plan coalesces leftover WC TSINs onto the priced listing', () => {
  const patches = planCatalogVariantIdentityCoalesce({
    parentAsin: 'TSPCYY1',
    catalogSpecs: catalogWcSpecs,
    offers: [lokesh, sparsha]
  });
  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, 'lokesh');
  assert.equal(patches[0].to.variant_key, 'key-ji');
  assert.equal(patches[0].to.variant_asin, 'TSPCYY1JI');
  assert.equal(patches[0].to.product_variant_id, 'pv-ji');
  assert.equal(patches[0].canonicalMrp, 10500);
});

test('plan does not overwrite competing positive MRPs when unifying TSINs', () => {
  const a = { ...sparsha, id: 'a', price: 350, variant_key: 'k1', variant_asin: 'TS2F7Y527' };
  const b = { ...lokesh, id: 'b', price: 375, variant_key: 'k2', variant_asin: 'TS2F7Y5R4' };
  const patches = planCatalogVariantIdentityCoalesce({
    parentAsin: 'TS2F7Y5',
    catalogSpecs: catalogWcSpecs,
    offers: [a, b]
  });
  assert.ok(patches.length >= 1);
  assert.equal(patches.every((patch) => patch.canonicalMrp == null), true);
});

test('same variant_key with split TSINs coalesces onto one number', () => {
  const first = {
    id: 'a',
    supplier_id: 's1',
    product_id: 'p1',
    price: 3999,
    status: 'approved',
    is_active: true,
    variant_key: 'shared-key',
    variant_asin: 'TS60ICOEA',
    created_at: '2026-01-01T00:00:00.000Z',
    attributes: { specifications: { Color: 'Black' } }
  };
  const second = {
    ...first,
    id: 'b',
    supplier_id: 's2',
    variant_asin: 'TS60ICOB6',
    created_at: '2026-02-01T00:00:00.000Z'
  };
  const patches = planCatalogVariantIdentityCoalesce({
    parentAsin: 'TS60ICO',
    catalogSpecs: { Color: 'Black' },
    offers: [first, second]
  });
  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, 'b');
  assert.equal(patches[0].to.variant_asin, 'TS60ICOEA');
  assert.equal(patches[0].to.variant_key, 'shared-key');
});

test('pickCanonicalOfferForVariantCluster prefers a positive MRP', () => {
  const picked = pickCanonicalOfferForVariantCluster([lokesh, sparsha]);
  assert.equal(picked.id, 'sparsha');
});
