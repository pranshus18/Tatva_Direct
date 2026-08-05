import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearCatalogProductReferences,
  deleteRejectedCatalogProduct
} from '../services/adminProductDeleteService.js';

function createSupabaseMock({ offerIds = [] } = {}) {
  const calls = [];

  const from = (table) => {
    const state = { table, action: null, filters: [], payload: undefined, inFilters: [] };

    const builder = {
      select() {
        state.action = state.action || 'select';
        return builder;
      },
      delete() {
        state.action = 'delete';
        return builder;
      },
      update(payload) {
        state.action = 'update';
        state.payload = payload;
        return builder;
      },
      eq(column, value) {
        state.filters.push({ column, value });
        return builder;
      },
      in(column, values) {
        state.inFilters.push({ column, values });
        return builder;
      },
      then(resolve, reject) {
        calls.push(state);
        if (state.table === 'supplier_products' && state.action === 'select') {
          resolve({
            data: offerIds.map((id) => ({ id })),
            error: null
          });
          return;
        }
        resolve({ error: null, data: null });
      }
    };

    return builder;
  };

  return { from, calls };
}

test('clearCatalogProductReferences clears dependency tables before product delete', async () => {
  const supabase = createSupabaseMock({ offerIds: ['offer-1'] });

  await clearCatalogProductReferences(supabase, 'product-1');

  const summary = supabase.calls.map((call) => ({
    table: call.table,
    action: call.action,
    payload: call.payload,
    filters: call.filters
  }));

  assert.deepEqual(summary.slice(0, 4), [
    {
      table: 'notifications',
      action: 'delete',
      payload: undefined,
      filters: [{ column: 'related_product_id', value: 'product-1' }]
    },
    {
      table: 'boq_items',
      action: 'delete',
      payload: undefined,
      filters: [{ column: 'normalized_product_id', value: 'product-1' }]
    },
    {
      table: 'product_requests',
      action: 'update',
      payload: { resolved_product_id: null },
      filters: [{ column: 'resolved_product_id', value: 'product-1' }]
    },
    {
      table: 'order_items',
      action: 'update',
      payload: { product_id: null },
      filters: [{ column: 'product_id', value: 'product-1' }]
    }
  ]);

  assert.ok(summary.some((c) => c.table === 'supplier_products' && c.action === 'delete'));
  assert.ok(summary.some((c) => c.table === 'product_variants' && c.action === 'delete'));
  assert.ok(
    summary.some(
      (c) =>
        c.table === 'products' &&
        c.action === 'update' &&
        c.payload?.duplicate_of_product_id === null
    )
  );
});

test('deleteRejectedCatalogProduct clears references then deletes catalog row', async () => {
  const supabase = createSupabaseMock();

  await deleteRejectedCatalogProduct(supabase, 'product-2');

  assert.equal(supabase.calls.at(-1)?.table, 'products');
  assert.equal(supabase.calls.at(-1)?.action, 'delete');
  assert.deepEqual(supabase.calls.at(-1)?.filters, [{ column: 'id', value: 'product-2' }]);
});
