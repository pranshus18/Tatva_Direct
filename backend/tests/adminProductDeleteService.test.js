import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearCatalogProductReferences,
  deleteCatalogOffer,
  deleteCatalogProduct
} from '../services/adminProductDeleteService.js';

function createSupabaseMock({
  offerIds = [],
  offerById = null,
  remainingOfferCount = 0
} = {}) {
  const calls = [];

  const from = (table) => {
    const state = {
      table,
      action: null,
      filters: [],
      payload: undefined,
      inFilters: [],
      selectArgs: null,
      head: false
    };

    const finalize = () => {
      calls.push(state);

      if (state.table === 'supplier_products' && state.action === 'select') {
        const idFilter = state.filters.find((f) => f.column === 'id');
        if (idFilter && offerById) {
          if (String(offerById.id) === String(idFilter.value)) {
            return { data: offerById, error: null, count: null };
          }
          return { data: null, error: { message: 'not found' }, count: null };
        }

        if (state.head || state.selectArgs?.count === 'exact') {
          return { data: null, error: null, count: remainingOfferCount };
        }

        return {
          data: offerIds.map((id) => ({ id, supplier_id: 'sup-1' })),
          error: null,
          count: offerIds.length
        };
      }

      if (state.table === 'supplier_products' && state.action === 'delete') {
        const idFilter = state.filters.find((f) => f.column === 'id');
        return {
          data: idFilter ? [{ id: idFilter.value }] : [],
          error: null,
          count: null
        };
      }

      return { error: null, data: null, count: null };
    };

    const builder = {
      select(...args) {
        state.action = state.action || 'select';
        state.selectArgs = args[1] || null;
        if (args[1]?.head) state.head = true;
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
      limit() {
        return builder;
      },
      single() {
        const result = finalize();
        return Promise.resolve(result);
      },
      maybeSingle() {
        const result = finalize();
        return Promise.resolve(result);
      },
      then(resolve, reject) {
        try {
          resolve(finalize());
        } catch (error) {
          reject(error);
        }
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

test('deleteCatalogProduct clears references then deletes catalog row', async () => {
  const supabase = createSupabaseMock();

  await deleteCatalogProduct(supabase, 'product-2');

  assert.equal(supabase.calls.at(-1)?.table, 'products');
  assert.equal(supabase.calls.at(-1)?.action, 'delete');
  assert.deepEqual(supabase.calls.at(-1)?.filters, [{ column: 'id', value: 'product-2' }]);
});

test('deleteCatalogOffer removes only the selected offer when siblings remain', async () => {
  const supabase = createSupabaseMock({
    offerById: { id: 'offer-2', product_id: 'product-1', supplier_id: 'sup-1' },
    remainingOfferCount: 2
  });

  const result = await deleteCatalogOffer(supabase, {
    catalogProductId: 'product-1',
    supplierProductId: 'offer-2'
  });

  assert.deepEqual(result, { deletedOfferId: 'offer-2', catalogDeleted: false });

  const offerDeletes = supabase.calls.filter(
    (c) => c.table === 'supplier_products' && c.action === 'delete'
  );
  assert.equal(offerDeletes.length, 1);
  assert.deepEqual(offerDeletes[0].filters, [
    { column: 'id', value: 'offer-2' },
    { column: 'product_id', value: 'product-1' }
  ]);

  const catalogDeletes = supabase.calls.filter(
    (c) => c.table === 'products' && c.action === 'delete'
  );
  assert.equal(catalogDeletes.length, 0);

  const variantDeletes = supabase.calls.filter(
    (c) => c.table === 'product_variants' && c.action === 'delete'
  );
  assert.equal(variantDeletes.length, 0);
});

test('deleteCatalogOffer deletes catalog product when last offer is removed', async () => {
  const supabase = createSupabaseMock({
    offerById: { id: 'offer-only', product_id: 'product-9', supplier_id: 'sup-1' },
    remainingOfferCount: 0
  });

  const result = await deleteCatalogOffer(supabase, {
    catalogProductId: 'product-9',
    supplierProductId: 'offer-only'
  });

  assert.deepEqual(result, { deletedOfferId: 'offer-only', catalogDeleted: true });
  assert.ok(
    supabase.calls.some((c) => c.table === 'products' && c.action === 'delete')
  );
});

test('deleteCatalogOffer rejects offer that belongs to another catalog product', async () => {
  const supabase = createSupabaseMock({
    offerById: { id: 'offer-2', product_id: 'other-product' },
    remainingOfferCount: 1
  });

  await assert.rejects(
    () =>
      deleteCatalogOffer(supabase, {
        catalogProductId: 'product-1',
        supplierProductId: 'offer-2'
      }),
    /does not belong/
  );
});

test('deleteCatalogOffer clears Product_COV when no offer remains for that variant', async () => {
  const calls = [];
  let offerExists = true;
  const supabase = {
    from(table) {
      const state = {
        table,
        action: null,
        filters: [],
        selectArgs: null,
        head: false
      };
      const finalize = () => {
        calls.push({ ...state, filters: [...state.filters] });
        if (table === 'supplier_products' && state.action === 'select') {
          const idFilter = state.filters.find((f) => f.column === 'id');
          if (idFilter && !state.head) {
            return {
              data: {
                id: 'offer-2',
                product_id: 'product-1',
                supplier_id: 'sup-1',
                variant_key: 'vk-old'
              },
              error: null,
              count: null
            };
          }
          if (state.head) {
            const variantFilter = state.filters.find((f) => f.column === 'variant_key');
            if (variantFilter) {
              return { data: null, error: null, count: offerExists ? 1 : 0 };
            }
            // Sibling offers remain on the catalog product.
            return { data: null, error: null, count: 1 };
          }
        }
        if (table === 'supplier_products' && state.action === 'delete') {
          offerExists = false;
          return { data: [{ id: 'offer-2' }], error: null, count: null };
        }
        if (table === 'supplier_bcov_levels' && state.action === 'delete') {
          return { data: null, error: null, count: null };
        }
        return { data: null, error: null, count: null };
      };
      const builder = {
        select(...args) {
          state.action = state.action || 'select';
          state.selectArgs = args[1] || null;
          if (args[1]?.head) state.head = true;
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
        in() {
          return builder;
        },
        limit() {
          return builder;
        },
        single() {
          return Promise.resolve(finalize());
        },
        maybeSingle() {
          return Promise.resolve(finalize());
        },
        then(resolve, reject) {
          try {
            resolve(finalize());
          } catch (error) {
            reject(error);
          }
        }
      };
      return builder;
    }
  };

  const result = await deleteCatalogOffer(supabase, {
    catalogProductId: 'product-1',
    supplierProductId: 'offer-2'
  });

  assert.deepEqual(result, { deletedOfferId: 'offer-2', catalogDeleted: false });
  assert.ok(
    calls.some(
      (c) =>
        c.table === 'supplier_bcov_levels' &&
        c.action === 'delete' &&
        c.filters.some((f) => f.column === 'variant_key' && f.value === 'vk-old')
    )
  );
});
