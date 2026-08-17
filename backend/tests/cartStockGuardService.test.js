import assert from 'node:assert/strict';
import {
  PRODUCT_OUT_OF_STOCK_MESSAGE,
  assertProductHasSellableStock,
  assertCartDraftItemsHaveSellableStock
} from '../services/cartStockGuardService.js';
import { clearAdminBrandTerminalRoleMapCache } from '../utils/adminBrandSupplyChain.js';

async function testAsync(name, fn) {
  try {
    clearAdminBrandTerminalRoleMapCache();
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`fail - ${name}`);
    throw error;
  }
}

function createSupabaseMock({ product, listings }) {
  return {
    from(table) {
      if (table === 'category_supply_chains') {
        return {
          select: async () => ({ data: [], error: null })
        };
      }
      if (table === 'products') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: product, error: null })
                };
              }
            };
          }
        };
      }
      if (table === 'supplier_products') {
        const query = {
          _filters: {},
          select() {
            return query;
          },
          eq(field, value) {
            query._filters[field] = value;
            return query;
          },
          limit() {
            return Promise.resolve({
              data: (listings || []).filter((row) => {
                if (!query._filters.variant_key) return true;
                return String(row.variant_key || '') === String(query._filters.variant_key);
              }),
              error: null
            });
          }
        };
        return query;
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };
}

await testAsync('rejects out of stock products', async () => {
  const supabase = createSupabaseMock({
    product: { id: 'p1', name: 'Printer', status: 'approved', brand: 'HP' },
    listings: [
      { id: 'sp1', stock: 0, supplier: { profile: {} } },
      { id: 'sp2', stock: 0, supplier: { profile: {} } }
    ]
  });

  const result = await assertProductHasSellableStock(supabase, {
    productId: 'p1',
    quantity: 1
  });
  assert.equal(result.ok, false);
  assert.equal(result.message, PRODUCT_OUT_OF_STOCK_MESSAGE);
});

await testAsync('allows in-stock products', async () => {
  const supabase = createSupabaseMock({
    product: { id: 'p2', name: 'Cable', status: 'approved', brand: 'Generic' },
    listings: [{ id: 'sp1', stock: 5, supplier: { profile: {} } }]
  });

  const result = await assertProductHasSellableStock(supabase, {
    productId: 'p2',
    quantity: 2
  });
  assert.equal(result.ok, true);
  assert.equal(result.availableStock, 5);
});

await testAsync('rejects quantity above available stock', async () => {
  const supabase = createSupabaseMock({
    product: { id: 'p2b', name: 'Cable', status: 'approved', brand: 'Generic' },
    listings: [{ id: 'sp1', stock: 2, supplier: { profile: {} } }]
  });

  const result = await assertProductHasSellableStock(supabase, {
    productId: 'p2b',
    quantity: 5
  });
  assert.equal(result.ok, false);
  assert.match(String(result.message), /only 2/i);
});

await testAsync('rejects cart draft containing out of stock product lines', async () => {
  const supabase = createSupabaseMock({
    product: { id: 'p3', name: 'OOS Item', status: 'approved', brand: 'Generic' },
    listings: [{ id: 'sp1', stock: 0, supplier: { profile: {} } }]
  });

  const result = await assertCartDraftItemsHaveSellableStock(supabase, {
    boqGroups: [
      {
        items: [{ productId: 'p3', quantity: 1 }]
      }
    ]
  });
  assert.equal(result.ok, false);
  assert.match(String(result.message), /out of stock/i);
});

await testAsync('ignores the buyer own supplier listing when checking sellable stock', async () => {
  const supabase = createSupabaseMock({
    product: { id: 'p-self', name: 'Own SKU', status: 'approved', brand: 'Generic' },
    listings: [
      {
        id: 'sp-self',
        stock: 40,
        supplier_id: 'buyer-1',
        supplier: { id: 'buyer-1', profile: {} }
      }
    ]
  });

  const result = await assertProductHasSellableStock(supabase, {
    productId: 'p-self',
    quantity: 1,
    excludeSupplierId: 'buyer-1'
  });
  assert.equal(result.ok, false);
  assert.match(String(result.message), /own supplier listing/i);
});

await testAsync('counts only other suppliers stock for a dual-role buyer', async () => {
  const supabase = createSupabaseMock({
    product: { id: 'p-mix', name: 'Shared SKU', status: 'approved', brand: 'Generic' },
    listings: [
      {
        id: 'sp-self',
        stock: 40,
        supplier_id: 'buyer-1',
        supplier: { id: 'buyer-1', profile: {} }
      },
      {
        id: 'sp-other',
        stock: 3,
        supplier_id: 'other-1',
        supplier: { id: 'other-1', profile: {} }
      }
    ]
  });

  const result = await assertProductHasSellableStock(supabase, {
    productId: 'p-mix',
    quantity: 2,
    excludeSupplierId: 'buyer-1'
  });
  assert.equal(result.ok, true);
  assert.equal(result.availableStock, 3);
});
console.log('ok - out of stock message constant is user-facing');
console.log('cartStockGuardService tests passed');
