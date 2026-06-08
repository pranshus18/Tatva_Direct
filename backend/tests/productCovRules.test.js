import test from 'node:test';
import assert from 'node:assert/strict';
import { composeBcovNotes } from '../services/supplierCatalogHelpersService.js';
import { validateAndNormalizeBcovLevels } from '../services/supplierBcovService.js';
import {
  extractBcovScopeKeys,
  extractBrandForBcov,
  parseCovThresholdNumber,
  resolveBcovPriceForBuyerMetrics
} from '../services/procurementSharedService.js';

function makeLevel({
  id,
  brandCovThreshold,
  platformCovThreshold = null,
  supplierCovThreshold,
  price,
  levelName = 'Level'
}) {
  return {
    id,
    min_purchase_qty: brandCovThreshold,
    max_purchase_qty: platformCovThreshold,
    unit_price: price,
    notes: composeBcovNotes({
      levelName,
      buyerBcov: String(supplierCovThreshold)
    })
  };
}

test('parseCovThresholdNumber parses plain and formatted INR strings', () => {
  assert.equal(parseCovThresholdNumber(5000), 5000);
  assert.equal(parseCovThresholdNumber('5,000'), 5000);
  assert.equal(parseCovThresholdNumber('INR 12,500.50'), 12500.5);
  assert.equal(parseCovThresholdNumber(''), null);
  assert.equal(parseCovThresholdNumber(null), null);
});

test('resolveBcovPriceForBuyerMetrics: no slab when none of three COV thresholds crossed', () => {
  const levels = [
    makeLevel({
      id: 'a',
      brandCovThreshold: 10000,
      platformCovThreshold: 50000,
      supplierCovThreshold: 5000,
      price: 90
    })
  ];
  assert.equal(
    resolveBcovPriceForBuyerMetrics({
      levels,
      supplierCov: 1000,
      platformCov: 2000,
      brandCov: 3000
    }),
    null
  );
});

test('resolveBcovPriceForBuyerMetrics: matches when supplier COV alone crosses', () => {
  const levels = [
    makeLevel({
      id: 'supplier-only',
      brandCovThreshold: 999999,
      platformCovThreshold: 999999,
      supplierCovThreshold: 5000,
      price: 88
    })
  ];
  const result = resolveBcovPriceForBuyerMetrics({
    levels,
    supplierCov: 5000,
    platformCov: 0,
    brandCov: 0
  });
  assert.deepEqual(result, { levelId: 'supplier-only', price: 88 });
});

test('resolveBcovPriceForBuyerMetrics: matches when brand COV alone crosses', () => {
  const levels = [
    makeLevel({
      id: 'brand-only',
      brandCovThreshold: 10000,
      platformCovThreshold: 999999,
      supplierCovThreshold: 999999,
      price: 85
    })
  ];
  const result = resolveBcovPriceForBuyerMetrics({
    levels,
    supplierCov: 0,
    platformCov: 0,
    brandCov: 10000
  });
  assert.deepEqual(result, { levelId: 'brand-only', price: 85 });
});

test('resolveBcovPriceForBuyerMetrics: matches when platform COV alone crosses', () => {
  const levels = [
    makeLevel({
      id: 'platform-only',
      brandCovThreshold: 999999,
      platformCovThreshold: 50000,
      supplierCovThreshold: 999999,
      price: 82
    })
  ];
  const result = resolveBcovPriceForBuyerMetrics({
    levels,
    supplierCov: 0,
    platformCov: 50000,
    brandCov: 0
  });
  assert.deepEqual(result, { levelId: 'platform-only', price: 82 });
});

test('resolveBcovPriceForBuyerMetrics: OR logic — any one of three conditions unlocks slab', () => {
  const levels = [
    makeLevel({
      id: 'multi',
      brandCovThreshold: 10000,
      platformCovThreshold: 50000,
      supplierCovThreshold: 5000,
      price: 90
    })
  ];
  assert.deepEqual(
    resolveBcovPriceForBuyerMetrics({ levels, supplierCov: 5000, platformCov: 0, brandCov: 0 }),
    { levelId: 'multi', price: 90 }
  );
  assert.deepEqual(
    resolveBcovPriceForBuyerMetrics({ levels, supplierCov: 0, platformCov: 0, brandCov: 10000 }),
    { levelId: 'multi', price: 90 }
  );
  assert.deepEqual(
    resolveBcovPriceForBuyerMetrics({ levels, supplierCov: 0, platformCov: 50000, brandCov: 0 }),
    { levelId: 'multi', price: 90 }
  );
});

test('resolveBcovPriceForBuyerMetrics: multiple slabs match — picks lowest unit price', () => {
  const levels = [
    makeLevel({
      id: 'high-tier',
      brandCovThreshold: 10000,
      platformCovThreshold: 50000,
      supplierCovThreshold: 5000,
      price: 90
    }),
    makeLevel({
      id: 'low-tier',
      brandCovThreshold: 50000,
      platformCovThreshold: null,
      supplierCovThreshold: 20000,
      price: 80
    })
  ];
  const result = resolveBcovPriceForBuyerMetrics({
    levels,
    supplierCov: 25000,
    platformCov: 60000,
    brandCov: 60000
  });
  assert.deepEqual(result, { levelId: 'low-tier', price: 80 });
});

test('resolveBcovPriceForBuyerMetrics: null platform threshold never satisfies platform COV', () => {
  const levels = [
    makeLevel({
      id: 'no-platform-threshold',
      brandCovThreshold: 999999,
      platformCovThreshold: null,
      supplierCovThreshold: 999999,
      price: 75
    })
  ];
  assert.equal(
    resolveBcovPriceForBuyerMetrics({
      levels,
      supplierCov: 0,
      platformCov: 1_000_000,
      brandCov: 0
    }),
    null
  );
});

test('resolveBcovPriceForBuyerMetrics: supplier threshold supports comma-formatted notes', () => {
  const levels = [
    {
      id: 'fmt',
      min_purchase_qty: 999999,
      max_purchase_qty: 999999,
      unit_price: 77,
      notes: composeBcovNotes({ levelName: 'Gold', buyerBcov: '12,500' })
    }
  ];
  assert.deepEqual(
    resolveBcovPriceForBuyerMetrics({ levels, supplierCov: 12500, platformCov: 0, brandCov: 0 }),
    { levelId: 'fmt', price: 77 }
  );
  assert.equal(
    resolveBcovPriceForBuyerMetrics({ levels, supplierCov: 12499, platformCov: 0, brandCov: 0 }),
    null
  );
});

test('extractBrandForBcov and extractBcovScopeKeys resolve product scope', () => {
  const supplierProduct = {
    id: 'sp-1',
    variant_asin: 'ASIN-9',
    variant_key: 'vk-1',
    attributes: { brandModel: 'Acme Widget' },
    product: { brand: 'IgnoredWhenAttrsPresent', specifications: {} }
  };
  assert.equal(extractBrandForBcov({ supplierProduct, item: {} }), 'acme widget');
  const keys = extractBcovScopeKeys({ supplierProduct, item: { variantAsin: 'ASIN-9' } });
  assert.ok(keys.includes('vk-1'));
  assert.ok(keys.includes('ASIN-9'));
});

test('validateAndNormalizeBcovLevels requires variantKey and threshold fields per row', () => {
  const bad = validateAndNormalizeBcovLevels([
    { variantKey: 'vk-1', levelName: 'L1', buyerCov: 100, buyerPcov: 500, price: 90, buyerBcov: '' }
  ]);
  assert.equal(bad.ok, false);

  const noVariant = validateAndNormalizeBcovLevels([
    { levelName: 'L1', buyerCov: 100, buyerPcov: 500, price: 90, buyerBcov: '200' }
  ]);
  assert.equal(noVariant.ok, false);

  const good = validateAndNormalizeBcovLevels(
    [{ variantKey: 'vk-1', levelName: 'L1', buyerCov: 100, buyerPcov: 500, price: 90, buyerBcov: '200' }],
    { catalogMrp: 100, requireCatalogMrp: true }
  );
  assert.equal(good.ok, true);

  const aboveMrp = validateAndNormalizeBcovLevels(
    [{ variantKey: 'vk-1', levelName: 'L1', buyerCov: 100, buyerPcov: 500, price: 150, buyerBcov: '200' }],
    { catalogMrp: 100, requireCatalogMrp: true }
  );
  assert.equal(aboveMrp.ok, false);
  assert.match(aboveMrp.message, /cannot be higher than catalog MRP/i);
  assert.equal(good.levels[0].variantKey, 'vk-1');
  assert.equal(good.levels[0].minPurchaseQty, 100);
  assert.equal(good.levels[0].maxPurchaseQty, 500);
  assert.equal(good.levels[0].buyerBcov, '200');
});

test('validateAndNormalizeBcovLevels: platform COV must be >= brand and supplier COV', () => {
  const base = {
    variantKey: 'vk-1',
    levelName: 'L1',
    buyerCov: 100,
    buyerPcov: 500,
    price: 90,
    buyerBcov: '200'
  };

  const equalThresholds = validateAndNormalizeBcovLevels(
    [{ ...base, buyerCov: 200, buyerPcov: 200, buyerBcov: '200' }],
    { catalogMrp: 100, requireCatalogMrp: true }
  );
  assert.equal(equalThresholds.ok, true);

  const belowBrand = validateAndNormalizeBcovLevels(
    [{ ...base, buyerCov: 500, buyerPcov: 400 }],
    { catalogMrp: 100, requireCatalogMrp: true }
  );
  assert.equal(belowBrand.ok, false);
  assert.match(belowBrand.message, /greater than or equal to Brand_cov/i);

  const belowSupplier = validateAndNormalizeBcovLevels(
    [{ ...base, buyerBcov: '1000', buyerPcov: 500 }],
    { catalogMrp: 100, requireCatalogMrp: true }
  );
  assert.equal(belowSupplier.ok, false);
  assert.match(belowSupplier.message, /greater than or equal to Supplier_purchase_total/i);
});
