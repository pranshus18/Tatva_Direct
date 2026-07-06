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

function makeFakeSupabase({ offerRows = [] } = {}) {
  return {
    from(table) {
      if (table === 'supplier_products') {
        return {
          select() {
            return {
              in() {
                return {
                  in() {
                    return Promise.resolve({ data: offerRows, error: null });
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
    // Registered by a DIFFERENT supplier than the offer below — this must never leak into
    // another supplier's offer just because that offer left its own location blank.
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
      location: '', // seller left this blank on their own listing
      outlet_id: null,
      variant_key: null,
      variant_asin: null,
      attributes: {},
      status: 'pending',
      is_active: false,
      supplier: { id: 'karthik-id', name: 'karthik', company: 'Tatva', address: {}, profile: {} }
    }
  ];

  const supabase = makeFakeSupabase({ offerRows });

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
