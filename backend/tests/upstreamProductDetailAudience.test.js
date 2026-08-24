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

function makeSupabaseStub({
  product,
  ownershipRows = [],
  offerRows = [],
  familyProducts = null,
  supplyChains = []
}) {
  const tablesQueried = [];

  const from = (table) => {
    tablesQueried.push(table);
    const filters = {};
    const resolveRows = () => {
      if (table === 'products') {
        if (filters.family_id && Array.isArray(familyProducts)) return familyProducts;
        return product ? [product] : [];
      }
      if (table === 'supplier_products') {
        return filters.supplier_id ? ownershipRows : offerRows;
      }
      if (table === 'category_supply_chains') return supplyChains;
      if (table === 'product_families') return [];
      if (table === 'product_variants') return [];
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

test('upstream detail prefers viewer offer brand/category over mismatched catalog attach', async () => {
  const mismatchedCatalog = {
    ...APPROVED_PRODUCT,
    name: 'Legacy footwear shell',
    brand: 'stella',
    category: 'footwear',
    family_id: 'family-mixed',
    specifications: { color: 'Dark Grey Marl' }
  };
  const footwearSibling = {
    ...mismatchedCatalog,
    id: 'prod-footwear',
    name: 'Stella Sneaker',
    specifications: { color: 'Dark Grey Marl', style: 'Running' }
  };
  const viewerOffer = {
    ...UPSTREAM_OFFER,
    id: 'sp-mine',
    supplier_id: 'supplier-1',
    attributes: {
      brand: 'Milton',
      category: 'Flasks & Bottles',
      listingName: 'Milton Thermosteel Water Bottle',
      specifications: { color: 'Silver' }
    }
  };

  const { supabase } = makeSupabaseStub({
    product: mismatchedCatalog,
    familyProducts: [mismatchedCatalog, footwearSibling],
    ownershipRows: [viewerOffer],
    offerRows: [viewerOffer]
  });

  const result = await getProductDiscoveryDetail(supabase, {
    productId: 'prod-1',
    audience: DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM,
    viewerSupplierId: 'supplier-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.product.brand, 'Milton');
  assert.equal(result.product.category, 'Flasks & Bottles');
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].name, 'Milton Thermosteel Water Bottle');
  assert.equal(
    result.variantOptions.some((option) =>
      (option.values || []).some((value) => /dark grey marl/i.test(String(value)))
    ),
    false
  );
});

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

test('discovery detail exposes per-variant offer prices in compare table data', async () => {
  const product = {
    ...APPROVED_PRODUCT,
    price: 100
  };
  const offerRows = [
    {
      id: 'sp-1',
      product_id: 'prod-1',
      price: 100,
      stock: 120,
      min_order_quantity: 1,
      location: 'Pune',
      variant_key: 'silver-600',
      variant_asin: 'TS1B2N',
      product_variant_id: null,
      attributes: { unit: '600 ml', specifications: { color: 'Silver', CAPACITY: '600 ml' } },
      status: 'approved',
      is_active: true,
      supplier: { profile: { supplyChainRole: 'retailer' } }
    },
    {
      id: 'sp-2',
      product_id: 'prod-1',
      price: 150,
      stock: 120,
      min_order_quantity: 1,
      location: 'Pune',
      variant_key: 'silver-1000',
      variant_asin: 'TS1B1H',
      product_variant_id: null,
      attributes: { unit: '1 L', specifications: { color: 'Silver', CAPACITY: '1 L' } },
      status: 'approved',
      is_active: true,
      supplier: { profile: { supplyChainRole: 'retailer' } }
    }
  ];

  const { supabase } = makeSupabaseStub({ product, offerRows });

  const result = await getProductDiscoveryDetail(supabase, {
    productId: 'prod-1',
    audience: DISCOVERY_DETAIL_AUDIENCES.SUPPLIER_UPSTREAM,
    viewerSupplierId: 'supplier-1'
  });

  assert.equal(result.ok, true);
  assert.equal(result.variants.length, 2);
  const prices = result.variants.map((variant) => Number(variant.price)).sort((a, b) => a - b);
  assert.deepEqual(prices, [100, 150]);
  const units = result.variants.map((variant) => variant.unit).sort();
  assert.deepEqual(units, ['1 L', '600 ml']);
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

test('service-provider detail shows only terminal-tier variants, not upstream offers', async () => {
  const { clearAdminBrandTerminalRoleMapCache } = await import('../utils/adminBrandSupplyChain.js');
  clearAdminBrandTerminalRoleMapCache();

  const cementBlack = {
    ...APPROVED_PRODUCT,
    id: 'cement-black',
    name: 'ACC cement',
    brand: 'acc',
    family_id: 'family-acc',
    specifications: { color: 'black' },
    images: ['https://cdn.example.com/cement-black.jpg']
  };
  const cementGrey = {
    ...cementBlack,
    id: 'cement-grey',
    specifications: { color: 'Grey' },
    images: ['https://cdn.example.com/cement-grey.jpg']
  };
  const upstreamLaptop = {
    ...cementBlack,
    id: 'laptop-upstream',
    name: 'HP Laptop',
    brand: 'acc',
    specifications: { color: 'black' },
    images: ['https://cdn.example.com/laptop.jpg']
  };

  const terminalBlack = {
    id: 'offer-black',
    product_id: 'cement-black',
    price: 375,
    stock: 10,
    min_order_quantity: 1,
    location: 'Delhi',
    variant_key: 'black',
    variant_asin: 'TS2FAXW',
    product_variant_id: null,
    attributes: {
      images: ['https://cdn.example.com/cement-black.jpg'],
      specifications: { color: 'black' }
    },
    status: 'approved',
    is_active: true,
    supplier: {
      profile: {
        companyInfoEntries: [{ role: 'retailer', brands: 'acc' }]
      }
    }
  };
  const terminalGrey = {
    ...terminalBlack,
    id: 'offer-grey',
    product_id: 'cement-grey',
    variant_key: 'grey',
    variant_asin: 'TS2FGREY',
    attributes: {
      images: ['https://cdn.example.com/cement-grey.jpg'],
      specifications: { color: 'Grey' }
    }
  };
  const upstreamOffer = {
    id: 'offer-laptop',
    product_id: 'laptop-upstream',
    price: 45000,
    stock: 5,
    min_order_quantity: 1,
    location: 'Pune',
    variant_key: 'laptop',
    variant_asin: 'TSLAPTOP',
    product_variant_id: null,
    attributes: {
      images: ['https://cdn.example.com/laptop.jpg'],
      specifications: { color: 'black' }
    },
    status: 'approved',
    is_active: true,
    supplier: {
      profile: {
        companyInfoEntries: [{ role: 'distributor', brands: 'acc' }]
      }
    }
  };

  const { supabase } = makeSupabaseStub({
    product: cementBlack,
    familyProducts: [cementBlack, cementGrey, upstreamLaptop],
    offerRows: [terminalBlack, terminalGrey, upstreamOffer],
    supplyChains: [
      {
        category_name: 'acc',
        stages: [{ role: 'manufacturer' }, { role: 'distributor' }, { role: 'retailer' }]
      }
    ]
  });

  const result = await getProductDiscoveryDetail(supabase, {
    productId: 'cement-black',
    audience: DISCOVERY_DETAIL_AUDIENCES.SERVICE_PROVIDER
  });

  assert.equal(result.ok, true);
  assert.equal(result.variants.length, 2);
  const variantIds = result.variants.map((v) => v.productId).sort();
  assert.deepEqual(variantIds, ['cement-black', 'cement-grey']);
  assert.equal(
    result.variants.some((v) => String(v.name || '').toLowerCase().includes('laptop')),
    false
  );
  assert.equal(
    result.variants.some((v) => (v.images || []).some((url) => String(url).includes('laptop'))),
    false
  );
});
