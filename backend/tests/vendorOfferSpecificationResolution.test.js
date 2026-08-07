import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeOfferSpecifications,
  parseSupplierOfferAttributes,
  resolveOfferCatalogProductId,
  buildVariantMetaByKey
} from '../services/supplierCatalogHelpersService.js';
import { reconcileWithSupplierOffers } from '../services/vendorProductDiscoveryService.js';

test('parseSupplierOfferAttributes parses legacy JSON string payloads', () => {
  const parsed = parseSupplierOfferAttributes(
    JSON.stringify({
      specifications: { Color: 'black', Capacity: '500ML' }
    })
  );
  assert.equal(parsed.specifications.Color, 'black');
  assert.equal(parsed.specifications.Capacity, '500ML');
});

test('resolveOfferCatalogProductId prefers product_variants.product_id', () => {
  const variantMetaByKey = buildVariantMetaByKey([
    { product_id: 'prod-600', variant_key: 'silver-600', variant_asin: 'TS1B2N' },
    { product_id: 'prod-500', variant_key: 'black-500', variant_asin: 'TS1B1D' }
  ]);
  assert.equal(
    resolveOfferCatalogProductId(
      { product_id: 'prod-shared', variant_asin: 'TS1B1D' },
      variantMetaByKey
    ),
    'prod-500'
  );
});

test('mergeOfferSpecifications: saved specifications win over stale variantAttributes', () => {
  const merged = mergeOfferSpecifications(
    { Color: 'Silver', Capacity: '1 L' },
    {
      attributes: {
        specifications: { Color: 'black', Capacity: '500ML' },
        variantAttributes: { color: 'silver', capacity: '1 l' }
      }
    }
  );
  assert.equal(merged.Color, 'black');
  assert.equal(merged.Capacity, '500ML');
});

test('mergeOfferSpecifications applies product_variants canonical_attributes as fallback', () => {
  const merged = mergeOfferSpecifications(
    { Color: 'Silver', Capacity: '1 l' },
    { attributes: { specifications: { Color: 'Silver' } } },
    { canonical_attributes: { Capacity: '500ML', Finish: 'matte' } }
  );
  assert.equal(merged.Color, 'Silver');
  assert.equal(merged.Capacity, '500ML');
  assert.equal(merged.Finish, 'matte');
});

test('mergeOfferSpecifications keeps distinct values for two offers on the same catalog product', () => {
  const sharedCatalog = {
    'BPA Free': 'Yes',
    Capacity: '1 l',
    Color: 'silver',
    Height: '8 inch'
  };
  const offerLow = mergeOfferSpecifications(sharedCatalog, {
    attributes: JSON.parse(
      JSON.stringify({
        specifications: {
          Capacity: '600 ml',
          Color: 'silver'
        }
      })
    )
  });
  const offerHigh = mergeOfferSpecifications(sharedCatalog, {
    attributes: {
      specifications: {
        Capacity: '500ML',
        Color: 'black'
      }
    }
  });

  assert.equal(offerLow.Capacity, '600 ml');
  assert.equal(offerLow.Color, 'silver');
  assert.equal(offerHigh.Capacity, '500ML');
  assert.equal(offerHigh.Color, 'black');
});

function makeReconcileSupabase({
  catalogProducts = [],
  offerRows = [],
  familyVariantRows = []
} = {}) {
  return {
    from(table) {
      if (table === 'products') {
        return {
          select() {
            return {
              in() {
                return Promise.resolve({ data: catalogProducts, error: null });
              },
              eq() {
                return {
                  in() {
                    return Promise.resolve({ data: catalogProducts.map(({ id }) => ({ id })), error: null });
                  }
                };
              }
            };
          }
        };
      }
      if (table === 'product_variants') {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: familyVariantRows, error: null });
              },
              in() {
                return Promise.resolve({ data: familyVariantRows, error: null });
              }
            };
          }
        };
      }
      if (table === 'supplier_products') {
        return {
          select() {
            return {
              in() {
                return {
                  eq() {
                    return {
                      eq() {
                        return Promise.resolve({ data: offerRows, error: null });
                      }
                    };
                  }
                };
              }
            };
          }
        };
      }
      throw new Error(`Unexpected table in test stub: ${table}`);
    }
  };
}

test('reconcileWithSupplierOffers preserves per-offer specifications on the same catalog product', async () => {
  const sharedCatalog = {
    id: 'prod-shared',
    name: 'STEEL TAURUS 600',
    description: '',
    category: 'other',
    unit: '600 ml',
    asin: 'TS1B',
    images: [],
    average_rating: 0,
    status: 'approved',
    location: '110075, India',
    specifications: {
      'BPA Free': 'Yes',
      Capacity: '1 l',
      Color: 'silver',
      Height: '8 inch'
    },
    family_id: 'family-1'
  };

  const offerRows = [
    {
      id: 'offer-a',
      product_id: 'prod-shared',
      price: 15,
      stock: 200,
      min_order_quantity: 1,
      location: '110075, India',
      outlet_id: null,
      variant_key: 'variant-a',
      variant_asin: 'TS1B2D',
      attributes: JSON.stringify({
        specifications: { Capacity: '600 ml', Color: 'silver' }
      }),
      status: 'approved',
      is_active: true,
      supplier: { id: 'sup-pranshu', name: 'Pranshu Singh', company: 'AIFF', address: {}, profile: {} }
    },
    {
      id: 'offer-b',
      product_id: 'prod-shared',
      price: 140,
      stock: 10,
      min_order_quantity: 1,
      location: '110075, India',
      outlet_id: null,
      variant_key: 'variant-b',
      variant_asin: 'TS1B1D',
      attributes: {
        specifications: { Capacity: '500ML', Color: 'black' }
      },
      status: 'approved',
      is_active: true,
      supplier: { id: 'sup-pranshu', name: 'Pranshu Singh', company: 'AIFF', address: {}, profile: {} }
    }
  ];

  const supabase = makeReconcileSupabase({
    catalogProducts: [sharedCatalog],
    offerRows,
    familyVariantRows: []
  });

  const reconciled = await reconcileWithSupplierOffers({
    supabase,
    products: [sharedCatalog],
    item: { productId: 'prod-shared' },
    itemId: 'item-1',
    itemName: 'STEEL TAURUS 600',
    referenceProduct: sharedCatalog,
    includeAllVariants: true,
    targetBrand: null,
    detectProductBrandKey: () => null,
    fuzzyNameCompatible: () => true,
    hasModelTokenConflict: () => false
  });

  assert.equal(reconciled.length, 2);
  const byVariant = Object.fromEntries(reconciled.map((row) => [row.variant_asin, row.specifications]));
  assert.equal(byVariant.TS1B2D.Capacity, '600 ml');
  assert.equal(byVariant.TS1B1D.Capacity, '500ML');
  assert.equal(byVariant.TS1B1D.Color, 'black');
  assert.equal(reconciled.every((row) => row.offerSpecificationsMerged), true);
});
