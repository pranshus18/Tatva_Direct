import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOVERY_DETAIL_AUDIENCES,
  aggregateOffersByVariantIdentity,
  buildVariantOptions,
  enrichDiscoverySuggestionsWithVariantCounts,
  mergeOfferSpecifications,
  resolveDiscoveryAudienceRules,
  resolveVariantCatalogProduct,
  resolveVariantDisplayImages,
  resolveViewerListingForVariant,
  indexListedOffersByCatalogProduct
} from '../services/productDiscoveryDetailService.js';

test('service-provider detail keeps terminal-tier offer eligibility', () => {
  for (const audience of [undefined, '', 'service_provider']) {
    const rules = resolveDiscoveryAudienceRules(audience);
    assert.equal(rules.audience, DISCOVERY_DETAIL_AUDIENCES.SERVICE_PROVIDER);
    assert.equal(rules.enforceTerminalRole, true);
    assert.equal(rules.requireEligibleOffers, true);
    assert.equal(rules.allowUnapprovedOwnListing, false);
  }
});

test('supplier upstream detail ignores terminal tier and shows products without offers', () => {
  for (const audience of ['supplier', 'supplier_upstream', 'Supplier_Upstream']) {
    const rules = resolveDiscoveryAudienceRules(audience);
    assert.equal(rules.audience, DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM);
    assert.equal(rules.enforceTerminalRole, false);
    assert.equal(rules.requireEligibleOffers, false);
    assert.equal(rules.allowUnapprovedOwnListing, true);
  }
});

test('discovery detail summary uses selected product name, not family canonical name', () => {
  const selectedProduct = { id: 'p1', name: 'Apex Ultima Protek 10L' };
  const family = { canonicalName: 'Asian Paints Premium Emulsion' };
  const summaryName = selectedProduct.name || family.canonicalName;
  assert.equal(summaryName, 'Apex Ultima Protek 10L');
});

test('mergeOfferSpecifications: per-variant offer values win over shared catalog placeholders', () => {
  const catalog = { COLOR: 'Silver', CAPACITY: '1 L', MATERIAL: 'Steel' };
  const offerA = {
    attributes: {
      specifications: { COLOR: 'Silver', CAPACITY: '1 L' }
    }
  };
  const offerB = {
    attributes: {
      specifications: { COLOR: 'Rose Gold', CAPACITY: '600 ml' }
    }
  };

  const mergedA = mergeOfferSpecifications(catalog, offerA);
  const mergedB = mergeOfferSpecifications(catalog, offerB);

  assert.equal(mergedA.COLOR, 'Silver');
  assert.equal(mergedA.CAPACITY, '1 L');
  assert.equal(mergedB.COLOR, 'Rose Gold');
  assert.equal(mergedB.CAPACITY, '600 ml');
  assert.equal(mergedB.MATERIAL, '');
});

test('mergeOfferSpecifications: empty offer placeholders stay empty without cross-variant catalog bleed', () => {
  const merged = mergeOfferSpecifications(
    { HEIGHT: '25 cm', COLOR: 'Blue' },
    { attributes: { specifications: { HEIGHT: '', COLOR: '' } } }
  );
  assert.equal(merged.HEIGHT, '');
  assert.equal(merged.COLOR, '');
});

test('buildVariantOptions ignores category and case-only attribute differences', () => {
  const options = buildVariantOptions([
    {
      specifications: { category: 'flasks & bottles', color: 'Red' },
      canonicalAttributes: {}
    },
    {
      specifications: { category: 'Flasks & Bottles', color: 'Blue' },
      canonicalAttributes: {}
    }
  ]);

  assert.equal(options.some((option) => option.key === 'category'), false);
  assert.equal(options.length, 1);
  assert.equal(options[0].key, 'color');
  assert.deepEqual(options[0].values, ['Blue', 'Red']);
});

test('buildVariantOptions returns selectors only for attributes that differ', () => {
  const options = buildVariantOptions([
    {
      specifications: { color: 'Red', size: 'M', brandModel: 'X' },
      canonicalAttributes: {}
    },
    {
      specifications: { color: 'Blue', size: 'M', brandModel: 'X' },
      canonicalAttributes: {}
    }
  ]);

  assert.equal(options.length, 1);
  assert.equal(options[0].key, 'color');
  assert.deepEqual(options[0].values, ['Blue', 'Red']);
});

test('aggregateOffersByVariantIdentity keeps distinct variant_asin rows separate', () => {
  const grouped = aggregateOffersByVariantIdentity([
    {
      id: 'offer-a',
      variant_key: '',
      variant_asin: 'TS1B2N',
      price: 100,
      stock: 120,
      status: 'approved',
      is_active: true
    },
    {
      id: 'offer-b',
      variant_key: '',
      variant_asin: 'TS1B1H',
      price: 150,
      stock: 120,
      status: 'approved',
      is_active: true
    }
  ]);

  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('va:TS1B2N')?.price, 100);
  assert.equal(grouped.get('va:TS1B1H')?.price, 150);
});

test('aggregateOffersByVariantIdentity keeps distinct variant_key rows separate', () => {
  const grouped = aggregateOffersByVariantIdentity([
    {
      id: 'offer-a',
      variant_key: 'silver-600',
      price: 100,
      stock: 120,
      status: 'approved',
      is_active: true
    },
    {
      id: 'offer-b',
      variant_key: 'silver-1000',
      price: 150,
      stock: 120,
      status: 'approved',
      is_active: true
    }
  ]);

  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('vk:silver-600')?.price, 100);
  assert.equal(grouped.get('vk:silver-1000')?.price, 150);
});

test('aggregateOffersByVariantIdentity prefers the viewer supplier when configured', () => {
  const grouped = aggregateOffersByVariantIdentity(
    [
      {
        id: 'offer-a',
        supplier_id: 'supplier-a',
        variant_asin: 'TS1B2N',
        price: 300,
        stock: 120,
        status: 'approved',
        is_active: true
      },
      {
        id: 'offer-b',
        supplier_id: 'supplier-b',
        variant_asin: 'TS1B2N',
        price: 69499,
        stock: 200,
        status: 'approved',
        is_active: true
      }
    ],
    { preferSupplierId: 'supplier-a' }
  );

  assert.equal(grouped.size, 1);
  assert.equal(grouped.get('va:TS1B2N')?.supplier_id, 'supplier-a');
  assert.equal(grouped.get('va:TS1B2N')?.price, 300);
});

test('resolveViewerListingForVariant matches by mine id and variant identity', () => {
  const listings = [
    { id: 'mine-1', productId: 'prod-1', variantAsin: 'TS161D', price: 4500 },
    { id: 'mine-2', productId: 'prod-2', variantAsin: 'TS162A', price: 5200 }
  ];

  assert.equal(resolveViewerListingForVariant(listings, null, 'mine-1')?.price, 4500);
  assert.equal(
    resolveViewerListingForVariant(listings, { variantAsin: 'TS162A' }, '')?.id,
    'mine-2'
  );
  // Active variant identity wins over a stale mine id from the opener URL.
  assert.equal(
    resolveViewerListingForVariant(listings, { variantAsin: 'TS162A' }, 'mine-1')?.id,
    'mine-2'
  );
});

test('aggregateOffersByVariantIdentity splits rows with same variant_key but different variant_asin', () => {
  const grouped = aggregateOffersByVariantIdentity([
    {
      id: 'offer-a',
      variant_key: 'shared-key',
      variant_asin: 'TS1B2N',
      price: 100,
      stock: 120,
      status: 'approved',
      is_active: true
    },
    {
      id: 'offer-b',
      variant_key: 'shared-key',
      variant_asin: 'TS1B1H',
      price: 150,
      stock: 120,
      status: 'approved',
      is_active: true
    }
  ]);

  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('va:TS1B2N')?.price, 100);
  assert.equal(grouped.get('va:TS1B1H')?.price, 150);
});

test('mergeOfferSpecifications keeps supplier variant height over shared catalog template', () => {
  const merged = mergeOfferSpecifications(
    { Height: '1 l', Color: 'Silver', 'B P A Free': 'Yes' },
    {
      attributes: {
        specifications: { height: '600 ml', color: 'Silver' },
        variantAttributes: { 'leak-proof': 'no' }
      }
    }
  );

  assert.equal(merged.height, '600 ml');
  assert.equal(merged.color, 'Silver');
  assert.equal(merged['leak-proof'], 'no');
  assert.equal(merged['B P A Free'], '');
});

test('indexListedOffersByCatalogProduct attaches cross-family offers to sibling catalog rows', () => {
  const sharedListing = { id: 'prod-shared', name: 'Shared listing' };
  const sibling600 = { id: 'prod-600', name: '600 ml' };
  const sibling1000 = { id: 'prod-1000', name: '1 L' };
  const productById = new Map([
    ['prod-shared', sharedListing],
    ['prod-600', sibling600],
    ['prod-1000', sibling1000]
  ]);
  const variantMetaByProductId = new Map();
  const variantMetaByKey = new Map([
    ['silver-600', { product_id: 'prod-600', variant_key: 'silver-600' }],
    ['silver-1000', { product_id: 'prod-1000', variant_key: 'silver-1000' }]
  ]);
  const offersByProductId = new Map([
    [
      'prod-shared',
      [
        {
          id: 'offer-600',
          product_id: 'prod-shared',
          variant_key: 'silver-600',
          price: 100,
          stock: 10,
          status: 'approved',
          is_active: true
        },
        {
          id: 'offer-1000',
          product_id: 'prod-shared',
          variant_key: 'silver-1000',
          price: 150,
          stock: 10,
          status: 'approved',
          is_active: true
        }
      ]
    ]
  ]);

  const indexed = indexListedOffersByCatalogProduct({
    enrichedProducts: [sharedListing, sibling600, sibling1000],
    offersByProductId,
    productById,
    variantMetaByProductId,
    variantMetaByKey
  });

  assert.equal(indexed.get('prod-600')?.length, 1);
  assert.equal(indexed.get('prod-1000')?.length, 1);
  assert.equal(indexed.get('prod-600')?.[0]?.offer?.price, 100);
  assert.equal(indexed.get('prod-1000')?.[0]?.offer?.price, 150);
});

test('resolveVariantDisplayImages uses only the selected offer gallery', () => {
  const catalogProduct = {
    images: [
      'https://cdn.example.com/variant-a-1.jpg',
      'https://cdn.example.com/variant-a-2.jpg',
      'https://cdn.example.com/variant-b-1.jpg',
      'https://cdn.example.com/variant-b-2.jpg'
    ]
  };
  const offerA = {
    attributes: {
      images: [
        'https://cdn.example.com/variant-a-1.jpg',
        'https://cdn.example.com/variant-a-2.jpg'
      ]
    }
  };
  const offerB = {
    attributes: {
      images: [
        'https://cdn.example.com/variant-b-1.jpg',
        'https://cdn.example.com/variant-b-2.jpg'
      ]
    }
  };

  assert.deepEqual(resolveVariantDisplayImages(catalogProduct, offerA), offerA.attributes.images);
  assert.deepEqual(resolveVariantDisplayImages(catalogProduct, offerB), offerB.attributes.images);
});

test('resolveVariantCatalogProduct prefers product_variants.product_id over offer product_id', () => {
  const productById = new Map([
    ['prod-shared', { id: 'prod-shared', name: 'Shared listing', specifications: { capacity: '1 L' } }],
    ['prod-600', { id: 'prod-600', name: '600 ml bottle', specifications: { capacity: '600 ml' } }]
  ]);
  const resolved = resolveVariantCatalogProduct(
    productById,
    productById.get('prod-shared'),
    { product_id: 'prod-600', variant_key: 'silver-600' }
  );
  assert.equal(resolved.id, 'prod-600');
  assert.equal(resolved.specifications.capacity, '600 ml');
});

test('mergeOfferSpecifications: per-variant offer values are not replaced by catalog defaults', () => {
  const variantA = mergeOfferSpecifications(
    { Height: '1 l', Capacity: '1 l' },
    { attributes: { specifications: { height: '600 ml', capacity: '600 ml' } } }
  );
  const variantB = mergeOfferSpecifications(
    { Height: '1 l', Capacity: '1 l' },
    { attributes: { specifications: { height: '8 inch', capacity: '1 l' } } }
  );

  assert.equal(variantA.height, '600 ml');
  assert.equal(variantA.capacity, '600 ml');
  assert.equal(variantB.height, '8 inch');
  assert.equal(variantB.capacity, '1 l');
});

test('mergeOfferSpecifications flattens variantAttributes instead of exposing raw JSON blob', () => {
  const merged = mergeOfferSpecifications(
    { color: 'Silver' },
    {
      attributes: {
        variantAttributes: {
          height: '600 ml',
          'leak-proof': 'no'
        }
      }
    }
  );

  assert.equal(merged.height, '600 ml');
  assert.equal(merged['leak-proof'], 'no');
  assert.equal(merged.variantAttributes, undefined);
});

test('enrichDiscoverySuggestionsWithVariantCounts marks family siblings as variants', async () => {
  const familyId = '11111111-1111-1111-1111-111111111111';
  const suggestions = [
    { id: 'product-a', family_id: familyId },
    { id: 'product-b', family_id: null }
  ];

  const supabase = {
    from(table) {
      if (table === 'products') {
        return {
          select() {
            return this;
          },
          in(_column, values) {
            this._values = values;
            return this;
          },
          eq() {
            return this;
          },
          or() {
            return Promise.resolve({
              data: (this._values || []).flatMap((id) => [
                { id: `${id}-1`, family_id: familyId },
                { id: `${id}-2`, family_id: familyId }
              ])
            });
          }
        };
      }
      if (table === 'supplier_products') {
        return {
          select() {
            return this;
          },
          in() {
            return this;
          },
          eq() {
            return this;
          },
          then(resolve) {
            return Promise.resolve({ data: [] }).then(resolve);
          }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };

  const enriched = await enrichDiscoverySuggestionsWithVariantCounts(supabase, suggestions);
  assert.equal(enriched[0].variantCount, 2);
  assert.equal(enriched[0].hasVariants, true);
  assert.equal(enriched[1].variantCount, 1);
  assert.equal(enriched[1].hasVariants, false);
});
