import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateListedSupplierOffers,
  buildCatalogSnapshotPatch,
  syncCatalogProductSnapshotFromOffers
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
