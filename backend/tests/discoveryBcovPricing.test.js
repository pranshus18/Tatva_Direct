import test from 'node:test';
import assert from 'node:assert/strict';
import { composeBcovNotes } from '../services/supplierCatalogHelpersService.js';
import {
  annotateDiscoveryOffersWithBcov,
  resolveDiscoveryOfferBcovPricing
} from '../services/discoveryBcovPricingService.js';
import { reconcileDiscoveryProductFields } from '../services/catalogOfferSnapshotService.js';

test('resolveDiscoveryOfferBcovPricing unlocks COV price when any threshold is crossed', () => {
  const levels = [
    {
      id: 'level-1',
      min_purchase_qty: 100,
      max_purchase_qty: 500,
      unit_price: 9000,
      notes: composeBcovNotes({ levelName: 'Level 1', buyerBcov: '200' })
    }
  ];
  const bcovBySupplierVariant = new Map([['sup-1::vk-1', levels]]);

  const unlocked = resolveDiscoveryOfferBcovPricing({
    offer: { supplier_id: 'sup-1', variant_key: 'vk-1', price: 10000 },
    platformCov: 0,
    supplierCovById: new Map([['sup-1', 250]]),
    brandCovByBrand: new Map(),
    bcovBySupplierVariant
  });
  assert.equal(unlocked.bcovApplied, true);
  assert.equal(unlocked.price, 9000);
  assert.equal(unlocked.basePrice, 10000);

  const locked = resolveDiscoveryOfferBcovPricing({
    offer: { supplier_id: 'sup-1', variant_key: 'vk-1', price: 10000 },
    platformCov: 0,
    supplierCovById: new Map([['sup-1', 50]]),
    brandCovByBrand: new Map([['acme', 10]]),
    bcovBySupplierVariant
  });
  assert.equal(locked.bcovApplied, false);
  assert.equal(locked.price, 10000);
});

test('reconcileDiscoveryProductFields exposes strikethrough MRP fields when BCOV applied', () => {
  const product = { id: 'p1', price: 12000, stock: 0 };
  const aggregates = {
    eligibleSupplierCountByProduct: new Map([['p1', 1]]),
    totalStockByProduct: new Map([['p1', 5]]),
    bestOfferByProduct: new Map([
      [
        'p1',
        {
          product_id: 'p1',
          price: 12000,
          _basePrice: 12000,
          _effectivePrice: 9500,
          _bcovApplied: true,
          _bcovLevelId: 'lvl-1',
          _price: 9500,
          min_order_quantity: 1,
          location: 'Pune'
        }
      ]
    ])
  };

  const reconciled = reconcileDiscoveryProductFields(product, aggregates);
  assert.equal(reconciled.price, 9500);
  assert.equal(reconciled.basePrice, 12000);
  assert.equal(reconciled.mrp, 12000);
  assert.equal(reconciled.bcovApplied, true);
  assert.equal(reconciled.bcovLevelId, 'lvl-1');
});

test('resolveDiscoveryOfferBcovPricing uses MRP only when Product_COV is not defined for the variant', () => {
  const otherVariantLevels = [
    {
      id: 'level-other',
      min_purchase_qty: 1,
      max_purchase_qty: 100,
      unit_price: 500,
      notes: composeBcovNotes({ levelName: 'Level 1', buyerBcov: '1' })
    }
  ];
  const bcovBySupplierVariant = new Map([['sup-1::other-vk', otherVariantLevels]]);

  const result = resolveDiscoveryOfferBcovPricing({
    offer: { supplier_id: 'sup-1', variant_key: 'vk-no-cov', price: 1000 },
    product: { brand: 'acc' },
    platformCov: 99999,
    supplierCovById: new Map([['sup-1', 99999]]),
    brandCovByBrand: new Map([['acc', 99999]]),
    bcovBySupplierVariant
  });

  assert.equal(result.bcovApplied, false);
  assert.equal(result.price, 1000);
  assert.equal(result.basePrice, 1000);
});

test('resolveDiscoveryOfferBcovPricing uses MRP when Product_COV unit price is zero', () => {
  const levels = [
    {
      id: 'level-zero',
      min_purchase_qty: 0,
      max_purchase_qty: 0,
      unit_price: 0,
      notes: composeBcovNotes({ levelName: 'Level 1', buyerBcov: '0' })
    }
  ];
  const result = resolveDiscoveryOfferBcovPricing({
    offer: { supplier_id: 'sup-1', variant_key: 'vk-zero', price: 2995 },
    platformCov: 100,
    supplierCovById: new Map([['sup-1', 100]]),
    brandCovByBrand: new Map(),
    bcovBySupplierVariant: new Map([['sup-1::vk-zero', levels]])
  });
  assert.equal(result.bcovApplied, false);
  assert.equal(result.price, 2995);
});

test('resolveDiscoveryOfferBcovPricing never inherits another variant Product_COV via brand', () => {
  const levels = [
    {
      id: 'level-1',
      min_purchase_qty: 1,
      max_purchase_qty: 100,
      unit_price: 800,
      notes: composeBcovNotes({ levelName: 'Level 1', buyerBcov: '1' })
    }
  ];
  // Wrong: brand-keyed map must not unlock for a different variant without its own slabs.
  const bcovBySupplierVariant = new Map([['sup-1::acc', levels]]);

  const result = resolveDiscoveryOfferBcovPricing({
    offer: { supplier_id: 'sup-1', variant_key: 'vk-cement', price: 1000 },
    product: { brand: 'acc' },
    platformCov: 99999,
    supplierCovById: new Map([['sup-1', 99999]]),
    brandCovByBrand: new Map([['acc', 99999]]),
    bcovBySupplierVariant
  });

  assert.equal(result.bcovApplied, false);
  assert.equal(result.price, 1000);
});

test('resolveDiscoveryOfferBcovPricing keeps MRP when COV price is not below list price', () => {
  const levels = [
    {
      id: 'level-high',
      min_purchase_qty: 1,
      max_purchase_qty: 100,
      unit_price: 12000,
      notes: composeBcovNotes({ levelName: 'Level 1', buyerBcov: '1' })
    }
  ];
  const result = resolveDiscoveryOfferBcovPricing({
    offer: { supplier_id: 'sup-1', variant_key: 'vk-1', price: 10000 },
    platformCov: 99999,
    supplierCovById: new Map([['sup-1', 99999]]),
    brandCovByBrand: new Map(),
    bcovBySupplierVariant: new Map([['sup-1::vk-1', levels]])
  });
  assert.equal(result.bcovApplied, false);
  assert.equal(result.price, 10000);
});

test('annotateDiscoveryOffersWithBcov sets effective price for best-offer ranking', () => {
  const levels = [
    {
      id: 'level-1',
      min_purchase_qty: 10,
      max_purchase_qty: null,
      unit_price: 800,
      notes: composeBcovNotes({ levelName: 'Level 1', buyerBcov: '100' })
    }
  ];
  const annotated = annotateDiscoveryOffersWithBcov({
    offerRows: [{ id: 'o1', product_id: 'p1', supplier_id: 'sup-1', variant_key: 'vk-1', price: 1000 }],
    productById: new Map([['p1', { id: 'p1', brand: 'Acme' }]]),
    platformCov: 0,
    supplierCovById: new Map([['sup-1', 150]]),
    brandCovByBrand: new Map(),
    bcovBySupplierVariant: new Map([['sup-1::vk-1', levels]])
  });

  assert.equal(annotated[0]._bcovApplied, true);
  assert.equal(annotated[0]._price, 800);
  assert.equal(annotated[0]._basePrice, 1000);
});
