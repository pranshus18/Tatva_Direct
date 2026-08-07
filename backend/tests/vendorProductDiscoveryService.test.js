import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileWithSupplierOffers } from '../services/vendorProductDiscoveryService.js';

/**
 * Regression test for: a supplier's offer with no location of its own was silently showing
 * the SHARED catalog product's `location` field instead — which belongs to whichever supplier
 * originally created that catalog listing, not the seller on this particular offer. That made
 * a Pune-based seller's blank-location offer look like it ships from the catalog creator's
 * Bengaluru address, producing a wrong (and misleadingly short) "distance from your project
 * site" on the vendor selection screen.
 */

function makeFakeSupabase({ offerRows = [], catalogProducts = [], familyVariantRows = [] } = {}) {
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
                    return Promise.resolve({
                      data: catalogProducts.map(({ id }) => ({ id })),
                      error: null
                    });
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

test('reconcileWithSupplierOffers excludes pending or inactive supplier offers', async () => {
  const catalogProduct = {
    id: 'product-1',
    name: 'Mac Air M2',
    description: 'A laptop',
    category: 'laptop',
    unit: 'nos',
    asin: 'TS22',
    images: [],
    average_rating: 0,
    status: 'approved',
    location: 'HSR Layout, Bengaluru, Karnataka, 560102, India',
    specifications: {}
  };

  const offerRows = [
    {
      id: 'offer-pune',
      product_id: 'product-1',
      price: 85,
      stock: 50,
      min_order_quantity: 1,
      location: '',
      outlet_id: null,
      variant_key: null,
      variant_asin: null,
      attributes: {},
      status: 'pending',
      is_active: false,
      supplier: { id: 'karthik-id', name: 'karthik', company: 'Tatva', address: {}, profile: {} }
    }
  ];

  const supabase = makeFakeSupabase({ offerRows, catalogProducts: [catalogProduct] });

  const result = await reconcileWithSupplierOffers({
    supabase,
    products: [catalogProduct],
    item: { productId: 'product-1' },
    itemId: 'item-1',
    itemName: 'Mac Air M2',
    referenceProduct: catalogProduct,
    includeAllVariants: false,
    targetBrand: null,
    detectProductBrandKey: () => null,
    fuzzyNameCompatible: () => true,
    hasModelTokenConflict: () => false
  });

  assert.equal(result.length, 0);
});

test('reconcileWithSupplierOffers never fills a blank offer location from the shared catalog product location', async () => {
  const catalogProduct = {
    id: 'product-1',
    name: 'Mac Air M2',
    description: 'A laptop',
    category: 'laptop',
    unit: 'nos',
    asin: 'TS22',
    images: [],
    average_rating: 0,
    status: 'approved',
    location: 'HSR Layout, Bengaluru, Karnataka, 560102, India',
    specifications: {}
  };

  const offerRows = [
    {
      id: 'offer-pune',
      product_id: 'product-1',
      price: 85,
      stock: 50,
      min_order_quantity: 1,
      location: '',
      outlet_id: null,
      variant_key: null,
      variant_asin: null,
      attributes: {},
      status: 'approved',
      is_active: true,
      supplier: { id: 'karthik-id', name: 'karthik', company: 'Tatva', address: {}, profile: {} }
    }
  ];

  const supabase = makeFakeSupabase({ offerRows, catalogProducts: [catalogProduct] });

  const result = await reconcileWithSupplierOffers({
    supabase,
    products: [catalogProduct],
    item: { productId: 'product-1' },
    itemId: 'item-1',
    itemName: 'Mac Air M2',
    referenceProduct: catalogProduct,
    includeAllVariants: false,
    targetBrand: null,
    detectProductBrandKey: () => null,
    fuzzyNameCompatible: () => true,
    hasModelTokenConflict: () => false
  });

  assert.equal(result.length, 1);
  assert.equal(
    result[0].location,
    '',
    'a blank offer location must stay blank, never inherit the shared catalog product location'
  );
});

test('reconcileWithSupplierOffers keeps only offers matching the cart line variantKey', async () => {
  const catalogProduct = {
    id: 'product-1',
    name: 'Mac Air M2',
    description: 'A laptop',
    category: 'laptop',
    unit: 'nos',
    asin: 'TS22',
    images: [],
    average_rating: 0,
    status: 'approved',
    location: 'Bengaluru',
    specifications: {}
  };

  const offerRows = [
    {
      id: 'offer-red',
      product_id: 'product-1',
      price: 85,
      stock: 50,
      min_order_quantity: 1,
      location: 'Pune',
      outlet_id: null,
      variant_key: 'vk-red',
      variant_asin: 'TS22R',
      attributes: {},
      status: 'approved',
      is_active: true,
      supplier: { id: 'supplier-a', name: 'Supplier A', company: 'A', address: {}, profile: {} }
    },
    {
      id: 'offer-blue',
      product_id: 'product-1',
      price: 90,
      stock: 40,
      min_order_quantity: 1,
      location: 'Mumbai',
      outlet_id: null,
      variant_key: 'vk-blue',
      variant_asin: 'TS22B',
      attributes: {},
      status: 'approved',
      is_active: true,
      supplier: { id: 'supplier-b', name: 'Supplier B', company: 'B', address: {}, profile: {} }
    }
  ];

  const supabase = makeFakeSupabase({ offerRows, catalogProducts: [catalogProduct] });

  const result = await reconcileWithSupplierOffers({
    supabase,
    products: [catalogProduct],
    item: { productId: 'product-1', variantKey: 'vk-red' },
    itemId: 'item-1',
    itemName: 'Mac Air M2',
    referenceProduct: catalogProduct,
    includeAllVariants: false,
    targetBrand: null,
    detectProductBrandKey: () => null,
    fuzzyNameCompatible: () => true,
    hasModelTokenConflict: () => false
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].variant_key, 'vk-red');
  assert.equal(result[0].supplierProductId, 'offer-red');
});

test('reconcileWithSupplierOffers drops name-incompatible live offers such as laptop backpacks for a Dell laptop request', async () => {
  const dellCatalog = {
    id: 'product-dell',
    name: 'Dell Latitude 5420 Laptop',
    description: 'Business laptop',
    category: 'laptop',
    unit: 'nos',
    asin: 'TS2N',
    images: [],
    average_rating: 0,
    status: 'approved',
    location: 'Bengaluru',
    specifications: {}
  };
  const backpackCatalog = {
    id: 'product-backpack',
    name: 'Safari Omega 30L Laptop Backpack',
    description: 'Backpack',
    category: 'laptop',
    unit: 'piece',
    asin: 'TSSDT',
    images: [],
    average_rating: 0,
    status: 'approved',
    location: 'Delhi',
    specifications: {}
  };

  const offerRows = [
    {
      id: 'offer-dell',
      product_id: 'product-dell',
      price: 88440,
      stock: 95,
      min_order_quantity: 1,
      location: '560072, India',
      outlet_id: null,
      variant_key: null,
      variant_asin: null,
      attributes: { listingName: 'Dell Latitude 5420 Laptop' },
      status: 'approved',
      is_active: true,
      supplier: { id: 'supplier-dell', name: 'Raghavi', company: 'Wipro', address: {}, profile: {} }
    },
    {
      id: 'offer-backpack',
      product_id: 'product-backpack',
      price: 0,
      stock: 367,
      min_order_quantity: 1,
      location: '000000, India',
      outlet_id: null,
      variant_key: null,
      variant_asin: null,
      attributes: { listingName: 'Safari Omega 30L Laptop Backpack' },
      status: 'approved',
      is_active: true,
      supplier: { id: 'supplier-backpack', name: 'Sparsha', company: 'HP', address: {}, profile: {} }
    }
  ];

  const {
    fuzzyNameCompatible,
    hasModelTokenConflict
  } = await import('../services/vendorRankingHelpersService.js');

  const supabase = makeFakeSupabase({
    offerRows,
    catalogProducts: [dellCatalog, backpackCatalog]
  });

  const result = await reconcileWithSupplierOffers({
    supabase,
    products: [dellCatalog, backpackCatalog],
    item: {},
    itemId: 'item-dell',
    itemName: 'Dell Latitude 5420 Laptop',
    referenceProduct: dellCatalog,
    includeAllVariants: false,
    targetBrand: null,
    detectProductBrandKey: () => null,
    fuzzyNameCompatible,
    hasModelTokenConflict
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].supplierProductId, 'offer-dell');
  assert.equal(result[0].name, 'Dell Latitude 5420 Laptop');
});

test('reconcileWithSupplierOffers returns all live suppliers for the anchored productId', async () => {
  const dellCatalog = {
    id: 'product-dell',
    name: 'Dell Latitude 5420 Laptop',
    description: 'Business laptop',
    category: 'laptop',
    unit: 'nos',
    asin: 'TS2N',
    images: [],
    average_rating: 0,
    status: 'approved',
    location: 'Bengaluru',
    specifications: {}
  };

  const offerRows = [
    {
      id: 'offer-a',
      product_id: 'product-dell',
      price: 88440,
      stock: 95,
      min_order_quantity: 1,
      location: '560072, India',
      outlet_id: null,
      variant_key: null,
      variant_asin: null,
      attributes: { listingName: 'Dell Latitude 5420' },
      status: 'approved',
      is_active: true,
      supplier: { id: 'supplier-a', name: 'Raghavi', company: 'Wipro', address: {}, profile: {} }
    },
    {
      id: 'offer-b',
      product_id: 'product-dell',
      price: 89999,
      stock: 12,
      min_order_quantity: 1,
      location: '560001, India',
      outlet_id: null,
      variant_key: null,
      variant_asin: null,
      attributes: { listingName: 'Latitude 5420 Dell Laptop' },
      status: 'approved',
      is_active: true,
      supplier: { id: 'supplier-b', name: 'Asha', company: 'Infosys', address: {}, profile: {} }
    }
  ];

  const {
    fuzzyNameCompatible,
    hasModelTokenConflict
  } = await import('../services/vendorRankingHelpersService.js');

  const supabase = makeFakeSupabase({
    offerRows,
    catalogProducts: [dellCatalog]
  });

  const result = await reconcileWithSupplierOffers({
    supabase,
    products: [dellCatalog],
    item: { productId: 'product-dell' },
    itemId: 'item-dell',
    itemName: 'Dell Latitude 5420 Laptop',
    referenceProduct: dellCatalog,
    includeAllVariants: false,
    targetBrand: null,
    detectProductBrandKey: () => null,
    fuzzyNameCompatible,
    hasModelTokenConflict
  });

  assert.equal(result.length, 2);
  assert.deepEqual(
    new Set(result.map((row) => row.supplierProductId)),
    new Set(['offer-a', 'offer-b'])
  );
});
