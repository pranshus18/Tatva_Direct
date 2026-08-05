import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateEligibleDiscoveryOffers,
  aggregateListedSupplierOffers,
  buildCatalogSnapshotPatch,
  pickBetterListedOffer,
  reconcileDiscoveryProductFields
} from '../services/catalogOfferSnapshotService.js';

test('aggregateListedSupplierOffers totals stock from approved active offers', () => {
  const aggregates = aggregateListedSupplierOffers([
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
    },
    {
      product_id: 'product-1',
      price: 250,
      stock: 99,
      status: 'pending',
      is_active: true
    }
  ]);

  const aggregate = aggregates.byProduct.get('product-1');
  assert.equal(aggregate.listedOfferCount, 2);
  assert.equal(aggregate.totalStock, 76);
  assert.deepEqual(buildCatalogSnapshotPatch(aggregate), {
    stock: 76,
    min_order_quantity: 1,
    location: 'Pune'
  });
});

test('aggregateEligibleDiscoveryOffers sums stock from eligible supplier offers', () => {
  const productById = new Map([
    [
      'product-1',
      {
        id: 'product-1',
        name: 'Nykaa Liquid Matte To Last Lipstick',
        brand: 'nyka',
        stock: 0,
        price: 0
      }
    ]
  ]);

  const aggregates = aggregateEligibleDiscoveryOffers({
    offerRows: [
      {
        product_id: 'product-1',
        price: 299,
        stock: 64,
        min_order_quantity: 1,
        location: 'Pune, Maharashtra',
        status: 'approved',
        is_active: true,
        supplier: { profile: { supplierRole: 'stockist' } }
      },
      {
        product_id: 'product-1',
        price: 310,
        stock: 12,
        status: 'approved',
        is_active: true,
        supplier: { profile: { supplierRole: 'stockist' } }
      },
      {
        product_id: 'product-1',
        price: 250,
        stock: 99,
        status: 'pending',
        is_active: true,
        supplier: { profile: { supplierRole: 'stockist' } }
      }
    ],
    productById,
    detectDiscoveryBrand: (product) => product?.brand || '',
    terminalRoleByBrandMap: new Map(),
    supplierMatchesBrandTerminalRoleFn: () => true
  });

  const reconciled = reconcileDiscoveryProductFields(productById.get('product-1'), aggregates);

  assert.equal(reconciled.supplierCount, 2);
  assert.equal(reconciled.stock, 76);
  assert.equal(reconciled.canAddToCart, true);
  assert.equal(reconciled.price, 299);
  assert.equal(reconciled.location, 'Pune, Maharashtra');
});

test('reconcileDiscoveryProductFields ignores legacy catalog stock when offers exist', () => {
  const product = {
    id: 'product-2',
    stock: 0,
    price: 0,
    location: ''
  };
  const aggregates = {
    eligibleSupplierCountByProduct: new Map([['product-2', 1]]),
    totalStockByProduct: new Map([['product-2', 42]]),
    bestOfferByProduct: new Map([
      [
        'product-2',
        {
          price: 199,
          stock: 42,
          location: 'Mumbai',
          min_order_quantity: 2,
          _stock: 42,
          _price: 199
        }
      ]
    ])
  };

  const reconciled = reconcileDiscoveryProductFields(product, aggregates);

  assert.equal(reconciled.stock, 42);
  assert.equal(reconciled.canAddToCart, true);
  assert.equal(reconciled.price, 199);
  assert.equal(reconciled.min_order_quantity, 2);
  assert.equal(reconciled.location, 'Mumbai');
});

test('reconcileDiscoveryProductFields disables cart when eligible stock is zero', () => {
  const product = {
    id: 'product-oos',
    stock: 999,
    price: 10,
    location: 'Legacy'
  };
  const aggregates = {
    eligibleSupplierCountByProduct: new Map([['product-oos', 1]]),
    totalStockByProduct: new Map([['product-oos', 0]]),
    bestOfferByProduct: new Map([
      [
        'product-oos',
        {
          price: 10,
          stock: 0,
          location: 'Pune',
          min_order_quantity: 1,
          _stock: 0,
          _price: 10
        }
      ]
    ])
  };

  const reconciled = reconcileDiscoveryProductFields(product, aggregates);
  assert.equal(reconciled.supplierCount, 1);
  assert.equal(reconciled.stock, 0);
  assert.equal(reconciled.canAddToCart, false);
});

test('reconcileDiscoveryProductFields prefers live offer price over stale catalog price', () => {
  const product = {
    id: 'product-stale-price',
    stock: 0,
    price: 999,
    location: ''
  };
  const aggregates = {
    eligibleSupplierCountByProduct: new Map([['product-stale-price', 1]]),
    totalStockByProduct: new Map([['product-stale-price', 12]]),
    bestOfferByProduct: new Map([
      [
        'product-stale-price',
        {
          price: 150,
          stock: 12,
          location: 'Pune',
          min_order_quantity: 1,
          _stock: 12,
          _price: 150
        }
      ]
    ])
  };

  const reconciled = reconcileDiscoveryProductFields(product, aggregates);
  assert.equal(reconciled.price, 150);
});

test('pickBetterListedOffer prefers higher stock then lower price', () => {
  const lowStock = { _stock: 10, _price: 80 };
  const highStock = { _stock: 50, _price: 120 };
  assert.deepEqual(pickBetterListedOffer(lowStock, highStock), highStock);
  assert.deepEqual(
    pickBetterListedOffer(
      { _stock: 50, _price: 120 },
      { _stock: 50, _price: 90 }
    ),
    { _stock: 50, _price: 90 }
  );
});
