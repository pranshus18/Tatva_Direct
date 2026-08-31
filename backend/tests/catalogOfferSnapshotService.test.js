import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateListedSupplierOffers,
  buildCatalogSnapshotPatch,
  syncCatalogProductSnapshotFromOffers,
  isExcludedBuyerSupplierOffer,
  isOfferEligibleForDiscoveryAudience,
  aggregateEligibleDiscoveryOffers,
  collectBuyerOwnedListingIndex,
  offerMatchesBuyerOwnedListing,
  assertBuyerDoesNotOwnDiscoveryListing,
  BUYER_OWNED_DISCOVERY_PURCHASE_MESSAGE
} from '../services/catalogOfferSnapshotService.js';

test('syncCatalogProductSnapshotFromOffers writes summed stock to products table', async () => {
  const updates = [];
  const supabase = {
    from(table) {
      if (table === 'supplier_products') {
        return {
          select() {
            return {
              eq() {
                return {
                  neq() {
                    return Promise.resolve({
                      data: [
                        {
                          product_id: 'product-1',
                          price: 299,
                          stock: 64,
                          min_order_quantity: 1,
                          location: 'Pune',
                          status: 'approved',
                          is_active: true
                        },
                        {
                          product_id: 'product-1',
                          price: 310,
                          stock: 12,
                          status: 'approved',
                          is_active: true
                        }
                      ],
                      error: null
                    });
                  }
                };
              }
            };
          }
        };
      }
      if (table === 'products') {
        return {
          update(patch) {
            updates.push(patch);
            return {
              eq() {
                return Promise.resolve({ error: null });
              }
            };
          }
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }
  };

  const result = await syncCatalogProductSnapshotFromOffers(supabase, 'product-1');

  assert.equal(result.ok, true);
  assert.equal(result.stock, 76);
  assert.equal(updates[0].stock, 76);
  assert.equal(updates[0].price, undefined);
});

test('buildCatalogSnapshotPatch returns zero stock when no listed offers remain', () => {
  const aggregates = aggregateListedSupplierOffers([
    {
      product_id: 'product-1',
      price: 299,
      stock: 64,
      status: 'pending',
      is_active: true
    }
  ]);

  assert.deepEqual(buildCatalogSnapshotPatch(aggregates.byProduct.get('product-1')), {
    stock: 0,
    min_order_quantity: null,
    location: null
  });
});

test('isExcludedBuyerSupplierOffer matches supplier_id or nested supplier.id', () => {
  assert.equal(
    isExcludedBuyerSupplierOffer({ supplier_id: 'buyer-1' }, 'buyer-1'),
    true
  );
  assert.equal(
    isExcludedBuyerSupplierOffer({ supplier: { id: 'buyer-1' } }, 'buyer-1'),
    true
  );
  assert.equal(
    isExcludedBuyerSupplierOffer({ supplier_id: 'other' }, 'buyer-1'),
    false
  );
  assert.equal(isExcludedBuyerSupplierOffer({ supplier_id: 'buyer-1' }, ''), false);
});

test('isExcludedBuyerSupplierOffer matches UUID casing and nested supplier arrays', () => {
  const uuid = '54e4ec86-5de6-44fa-b8a8-2468e3af9df4';
  assert.equal(
    isExcludedBuyerSupplierOffer({ supplier_id: uuid.toUpperCase() }, uuid),
    true
  );
  assert.equal(
    isExcludedBuyerSupplierOffer({ supplier: [{ id: uuid }] }, uuid.toUpperCase()),
    true
  );
});

test('discovery eligibility drops every seller of a SKU the buyer already lists', () => {
  const ownOffer = {
    product_id: 'product-1',
    supplier_id: 'buyer-1',
    price: 100,
    stock: 10,
    status: 'approved',
    is_active: true,
    supplier: { id: 'buyer-1', profile: {} }
  };
  const otherOffer = {
    product_id: 'product-1',
    supplier_id: 'other-1',
    price: 120,
    stock: 8,
    status: 'approved',
    is_active: true,
    supplier: { id: 'other-1', profile: {} }
  };

  assert.equal(
    isOfferEligibleForDiscoveryAudience({
      offer: ownOffer,
      excludeSupplierId: 'buyer-1'
    }),
    false
  );
  assert.equal(
    isOfferEligibleForDiscoveryAudience({
      offer: otherOffer,
      excludeSupplierId: 'buyer-1',
      ownedListingIndex: collectBuyerOwnedListingIndex([ownOffer, otherOffer], 'buyer-1')
    }),
    false
  );

  const aggregates = aggregateEligibleDiscoveryOffers({
    offerRows: [ownOffer, otherOffer],
    productById: new Map([['product-1', { id: 'product-1' }]]),
    detectDiscoveryBrand: () => '',
    terminalRoleByBrandMap: new Map(),
    supplierMatchesBrandTerminalRoleFn: () => true,
    excludeSupplierId: 'buyer-1'
  });

  assert.equal(aggregates.eligibleSupplierCountByProduct.get('product-1') || 0, 0);
});

test('discovery eligibility keeps a sibling variant the buyer does not sell', () => {
  const ownBlue = {
    product_id: 'product-1',
    supplier_id: 'buyer-1',
    variant_key: 'blue',
    price: 100,
    stock: 10,
    status: 'approved',
    is_active: true,
    supplier: { id: 'buyer-1', profile: {} }
  };
  const otherBlue = {
    ...ownBlue,
    supplier_id: 'other-1',
    supplier: { id: 'other-1', profile: {} }
  };
  const otherRed = {
    ...ownBlue,
    supplier_id: 'other-1',
    variant_key: 'red',
    supplier: { id: 'other-1', profile: {} }
  };

  const aggregates = aggregateEligibleDiscoveryOffers({
    offerRows: [ownBlue, otherBlue, otherRed],
    productById: new Map([['product-1', { id: 'product-1' }]]),
    detectDiscoveryBrand: () => '',
    terminalRoleByBrandMap: new Map(),
    supplierMatchesBrandTerminalRoleFn: () => true,
    excludeSupplierId: 'buyer-1'
  });

  assert.equal(aggregates.eligibleSupplierCountByProduct.get('product-1'), 1);
  assert.equal(aggregates.bestOfferByProduct.get('product-1')?.variant_key, 'red');
});

test('unkeyed own listing does not hide a different keyed variant of the same product', () => {
  const ownUnkeyed = {
    product_id: 'product-1',
    supplier_id: 'buyer-1',
    variant_key: '',
    price: 100,
    stock: 10,
    status: 'approved',
    is_active: true,
    supplier: { id: 'buyer-1', profile: {} }
  };
  const otherRed = {
    product_id: 'product-1',
    supplier_id: 'other-1',
    variant_key: 'red',
    variant_asin: 'TSRED',
    price: 120,
    stock: 8,
    status: 'approved',
    is_active: true,
    supplier: { id: 'other-1', profile: {} }
  };

  const aggregates = aggregateEligibleDiscoveryOffers({
    offerRows: [ownUnkeyed, otherRed],
    productById: new Map([['product-1', { id: 'product-1' }]]),
    detectDiscoveryBrand: () => '',
    terminalRoleByBrandMap: new Map(),
    supplierMatchesBrandTerminalRoleFn: () => true,
    excludeSupplierId: 'buyer-1'
  });

  assert.equal(aggregates.eligibleSupplierCountByProduct.get('product-1'), 1);
  assert.equal(aggregates.bestOfferByProduct.get('product-1')?.variant_key, 'red');
});

test('offerMatchesBuyerOwnedListing ignores upstream when buyer id is absent', () => {
  const ownOffer = {
    product_id: 'product-1',
    supplier_id: 'buyer-1',
    status: 'approved',
    is_active: true
  };
  assert.equal(
    offerMatchesBuyerOwnedListing(ownOffer, collectBuyerOwnedListingIndex([ownOffer], null)),
    false
  );
});

test('assertBuyerDoesNotOwnDiscoveryListing blocks cart add for an owned catalog row', async () => {
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        neq() {
          return this;
        },
        limit() {
          return Promise.resolve({
            data: [
              {
                id: 'sp-own',
                product_id: 'product-1',
                supplier_id: 'buyer-1',
                variant_key: 'blue',
                variant_asin: '',
                status: 'approved'
              }
            ],
            error: null
          });
        }
      };
    }
  };

  const blocked = await assertBuyerDoesNotOwnDiscoveryListing(supabase, {
    productId: 'product-1',
    buyerUserId: 'buyer-1'
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.message, BUYER_OWNED_DISCOVERY_PURCHASE_MESSAGE);

  const blockedBlue = await assertBuyerDoesNotOwnDiscoveryListing(supabase, {
    productId: 'product-1',
    variantKey: 'blue',
    buyerUserId: 'buyer-1'
  });
  assert.equal(blockedBlue.ok, false);

  const allowedRed = await assertBuyerDoesNotOwnDiscoveryListing(supabase, {
    productId: 'product-1',
    variantKey: 'red',
    buyerUserId: 'buyer-1'
  });
  assert.equal(allowedRed.ok, true);
});

test('assertBuyerDoesNotOwnDiscoveryListing allows a different live variant of the same product', async () => {
  const supabase = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        neq() {
          return this;
        },
        limit() {
          return Promise.resolve({
            data: [
              {
                id: 'sp-own',
                product_id: 'product-1',
                supplier_id: 'buyer-1',
                variant_key: 'blue',
                variant_asin: '',
                status: 'approved',
                is_active: true
              },
              {
                id: 'sp-red',
                product_id: 'product-1',
                supplier_id: 'other-1',
                variant_key: 'red',
                variant_asin: 'TSRED',
                status: 'approved',
                is_active: true
              }
            ],
            error: null
          });
        }
      };
    }
  };

  const allowedProduct = await assertBuyerDoesNotOwnDiscoveryListing(supabase, {
    productId: 'product-1',
    buyerUserId: 'buyer-1'
  });
  assert.equal(allowedProduct.ok, true);

  const allowedRed = await assertBuyerDoesNotOwnDiscoveryListing(supabase, {
    productId: 'product-1',
    variantKey: 'red',
    buyerUserId: 'buyer-1'
  });
  assert.equal(allowedRed.ok, true);

  const blockedBlue = await assertBuyerDoesNotOwnDiscoveryListing(supabase, {
    productId: 'product-1',
    variantKey: 'blue',
    buyerUserId: 'buyer-1'
  });
  assert.equal(blockedBlue.ok, false);
});
