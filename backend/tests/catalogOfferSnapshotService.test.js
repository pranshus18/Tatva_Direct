import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateListedSupplierOffers,
  buildCatalogSnapshotPatch,
  syncCatalogProductSnapshotFromOffers,
  isExcludedBuyerSupplierOffer,
  isOfferEligibleForDiscoveryAudience,
  aggregateEligibleDiscoveryOffers
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

test('discovery eligibility drops the buyer own listed offer', () => {
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
      excludeSupplierId: 'buyer-1'
    }),
    true
  );

  const aggregates = aggregateEligibleDiscoveryOffers({
    offerRows: [ownOffer, otherOffer],
    productById: new Map([['product-1', { id: 'product-1' }]]),
    detectDiscoveryBrand: () => '',
    terminalRoleByBrandMap: new Map(),
    supplierMatchesBrandTerminalRoleFn: () => true,
    excludeSupplierId: 'buyer-1'
  });

  assert.equal(aggregates.eligibleSupplierCountByProduct.get('product-1'), 1);
  assert.equal(aggregates.totalStockByProduct.get('product-1'), 8);
});
