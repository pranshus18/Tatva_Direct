import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOVERY_DETAIL_AUDIENCES,
  getProductDiscoveryDetail
} from '../services/productDiscoveryDetailService.js';

const APPROVED_PRODUCT = {
  id: 'prod-1',
  name: 'Steel Taurus 600',
  description: 'Vacuum insulated steel bottle.',
  category: 'Flasks & Bottles',
  unit: '600 ml',
  brand: 'Milton',
  specifications: { color: 'Silver' },
  images: ['https://cdn.example.com/taurus.jpg'],
  price: 120,
  stock: 0,
  min_order_quantity: 1,
  status: 'approved',
  is_active: true,
  family_id: null,
  variant_id: null,
  asin: 'TSIN-1'
};

const PENDING_PRODUCT = { ...APPROVED_PRODUCT, status: 'pending' };

/** Offer from a supplier that is not the brand's retailer-facing terminal tier. */
const UPSTREAM_OFFER = {
  id: 'sp-1',
  product_id: 'prod-1',
  price: 118,
  stock: 40,
  min_order_quantity: 5,
  location: 'Pune',
  variant_key: null,
  variant_asin: null,
  product_variant_id: null,
  attributes: {},
  status: 'approved',
  is_active: true,
  supplier: { profile: { supplyChainRole: 'distributor' } }
};

function makeSupabaseStub({ product, ownershipRows = [], offerRows = [] }) {
  const tablesQueried = [];

  const from = (table) => {
    tablesQueried.push(table);
    const filters = {};
    const resolveRows = () => {
      if (table === 'products') return product ? [product] : [];
      if (table === 'supplier_products') {
        return filters.supplier_id ? ownershipRows : offerRows;
      }
      throw new Error(`Unexpected table ${table}`);
    };

    const api = {
      select() {
        return api;
      },
      eq(column, value) {
        filters[column] = value;
        return api;
      },
      neq() {
        return api;
      },
      in() {
        return api;
      },
      gt() {
        return api;
      },
      or() {
        return api;
      },
      limit() {
        return api;
      },
      order() {
        return api;
      },
      maybeSingle() {
        return Promise.resolve({ data: resolveRows()[0] ?? null, error: null });
      },
      then(onFulfilled, onRejected) {
        let payload;
        try {
          payload = { data: resolveRows(), error: null };
        } catch (error) {
          return Promise.reject(error).then(onFulfilled, onRejected);
        }
        return Promise.resolve(payload).then(onFulfilled, onRejected);
      }
    };

    return api;
  };

  return { supabase: { from }, tablesQueried };
}

test('upstream detail counts offers from tiers above the buyer, not only the terminal tier', async () => {
  // The stub throws on any table it does not know, so reaching a result also proves the
  // admin terminal-role lookup is skipped for suppliers.
  const { supabase } = makeSupabaseStub({
    product: APPROVED_PRODUCT,
    offerRows: [UPSTREAM_OFFER]
  });

  const result = await getProductDiscoveryDetail(supabase, {
    productId: 'prod-1',
    audience: DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM,
    viewerSupplierId: 'supplier-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.audience, DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM);
  assert.equal(result.product.id, 'prod-1');
  assert.equal(result.product.supplierCount, 1);
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].stock, 40);
});

test('upstream detail still renders a product that has no upstream offers yet', async () => {
  const { supabase } = makeSupabaseStub({ product: APPROVED_PRODUCT, offerRows: [] });

  const result = await getProductDiscoveryDetail(supabase, {
    productId: 'prod-1',
    audience: DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM,
    viewerSupplierId: 'supplier-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.product.supplierCount, 0);
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].name, 'Steel Taurus 600');
});

test('upstream detail opens a listing whose catalog product is still pending approval', async () => {
  const { supabase } = makeSupabaseStub({
    product: PENDING_PRODUCT,
    ownershipRows: [{ id: 'sp-mine' }],
    offerRows: []
  });

  const result = await getProductDiscoveryDetail(supabase, {
    productId: 'prod-1',
    audience: DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM,
    viewerSupplierId: 'supplier-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.product.name, 'Steel Taurus 600');
});

test('upstream detail hides a pending product the supplier does not list', async () => {
  const { supabase } = makeSupabaseStub({
    product: PENDING_PRODUCT,
    ownershipRows: [],
    offerRows: []
  });

  const result = await getProductDiscoveryDetail(supabase, {
    productId: 'prod-1',
    audience: DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM,
    viewerSupplierId: 'supplier-1'
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});

test('service-provider detail never exposes unapproved catalog products', async () => {
  const { supabase } = makeSupabaseStub({
    product: PENDING_PRODUCT,
    ownershipRows: [{ id: 'sp-mine' }],
    offerRows: []
  });

  const result = await getProductDiscoveryDetail(supabase, {
    productId: 'prod-1',
    viewerSupplierId: 'supplier-1'
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
});
