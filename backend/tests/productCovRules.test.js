import test from 'node:test';
import assert from 'node:assert/strict';
import { composeBcovNotes } from '../services/supplierCatalogHelpersService.js';
import {
  validateAndNormalizeBcovLevels,
  deleteSupplierBcovLevelsIfNoRemainingOffer,
  isBcovLevelOwnedByOffer,
  evaluateProductCovInventoryGate,
  INVENTORY_REQUIRED_FOR_PRODUCT_COV_MESSAGE
} from '../services/supplierBcovService.js';
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

test('resolveBcovPriceForBuyerMetrics: ignores zero/unconfigured unit prices', () => {
  const levels = [
    makeLevel({
      id: 'empty-price',
      brandCovThreshold: 0,
      platformCovThreshold: 0,
      supplierCovThreshold: 0,
      price: 0
    })
  ];
  assert.equal(
    resolveBcovPriceForBuyerMetrics({
      levels,
      supplierCov: 100,
      platformCov: 100,
      brandCov: 100
    }),
    null
  );
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

test('validateAndNormalizeBcovLevels: empty levels can clear Product_COV without catalog MRP', () => {
  const cleared = validateAndNormalizeBcovLevels([], { requireCatalogMrp: true });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.levels.length, 0);
});

test('validateAndNormalizeBcovLevels: brand COV must be below supplier and platform COV', () => {
  const base = {
    variantKey: 'vk-1',
    levelName: 'L1',
    buyerCov: 100,
    buyerPcov: 500,
    price: 90,
    buyerBcov: '200'
  };

  const valid = validateAndNormalizeBcovLevels([base], { catalogMrp: 100, requireCatalogMrp: true });
  assert.equal(valid.ok, true);

  const equalPlatform = validateAndNormalizeBcovLevels(
    [{ ...base, buyerCov: 500, buyerPcov: 500, buyerBcov: '1000' }],
    { catalogMrp: 100, requireCatalogMrp: true }
  );
  assert.equal(equalPlatform.ok, false);
  assert.match(equalPlatform.message, /must not be equal to Platform_COV/i);

  const abovePlatform = validateAndNormalizeBcovLevels(
    [{ ...base, buyerCov: 450, buyerPcov: 400, buyerBcov: '1000' }],
    { catalogMrp: 100, requireCatalogMrp: true }
  );
  assert.equal(abovePlatform.ok, false);
  assert.match(abovePlatform.message, /less than Platform_COV/i);

  const equalSupplier = validateAndNormalizeBcovLevels(
    [{ ...base, buyerCov: 200, buyerPcov: 500, buyerBcov: '200' }],
    { catalogMrp: 100, requireCatalogMrp: true }
  );
  assert.equal(equalSupplier.ok, false);
  assert.match(equalSupplier.message, /less than Supplier_COV/i);

  const belowSupplier = validateAndNormalizeBcovLevels(
    [{ ...base, buyerBcov: '1000', buyerPcov: 500 }],
    { catalogMrp: 100, requireCatalogMrp: true }
  );
  assert.equal(belowSupplier.ok, false);
  assert.match(belowSupplier.message, /greater than or equal to Supplier_purchase_total/i);
});

test('deleteSupplierBcovLevelsIfNoRemainingOffer deletes only when offer is gone', async () => {
  const calls = [];
  const makeClient = (remainingOffers) => ({
    from(table) {
      const state = { table, action: null, filters: [], head: false };
      const finalize = () => {
        calls.push({ ...state, filters: [...state.filters] });
        if (table === 'supplier_products' && state.head) {
          return { data: null, error: null, count: remainingOffers };
        }
        return { data: null, error: null, count: null };
      };
      const builder = {
        select(...args) {
          state.action = 'select';
          if (args[1]?.head) state.head = true;
          return builder;
        },
        delete() {
          state.action = 'delete';
          return builder;
        },
        eq(column, value) {
          state.filters.push({ column, value });
          return builder;
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
  });

  const kept = await deleteSupplierBcovLevelsIfNoRemainingOffer(makeClient(1), {
    supplierId: 'sup-1',
    variantKey: 'vk-1'
  });
  assert.equal(kept.deleted, false);
  assert.equal(kept.reason, 'offer_still_present');

  const cleared = await deleteSupplierBcovLevelsIfNoRemainingOffer(makeClient(0), {
    supplierId: 'sup-1',
    variantKey: 'vk-1'
  });
  assert.equal(cleared.deleted, true);
  assert.ok(
    calls.some(
      (c) =>
        c.table === 'supplier_bcov_levels' &&
        c.action === 'delete' &&
        c.filters.some((f) => f.column === 'variant_key' && f.value === 'vk-1')
    )
  );
});

test('isBcovLevelOwnedByOffer hides leftover Product_COV from deleted listings', () => {
  const offer = {
    id: 'offer-new',
    created_at: '2026-08-13T10:00:00.000Z'
  };

  assert.equal(
    isBcovLevelOwnedByOffer(
      {
        id: 'legacy',
        notes: JSON.stringify({ levelName: 'Level 1', buyerBcov: '20' }),
        created_at: '2026-08-01T10:00:00.000Z',
        updated_at: '2026-08-01T10:00:00.000Z'
      },
      offer,
      { siblingOfferCount: 1 }
    ),
    false
  );

  assert.equal(
    isBcovLevelOwnedByOffer(
      {
        id: 'tagged-other',
        notes: JSON.stringify({
          levelName: 'Level 1',
          buyerBcov: '20',
          supplierProductId: 'offer-old'
        }),
        created_at: '2026-08-13T11:00:00.000Z',
        updated_at: '2026-08-13T11:00:00.000Z'
      },
      offer,
      { siblingOfferCount: 1 }
    ),
    false
  );

  assert.equal(
    isBcovLevelOwnedByOffer(
      {
        id: 'owned',
        notes: JSON.stringify({
          levelName: 'Level 1',
          buyerBcov: '20',
          supplierProductId: 'offer-new'
        }),
        created_at: '2026-08-13T11:00:00.000Z',
        updated_at: '2026-08-13T11:00:00.000Z'
      },
      offer,
      { siblingOfferCount: 1 }
    ),
    true
  );
});

test('evaluateProductCovInventoryGate blocks Product_COV until inventory is complete', () => {
  const incomplete = evaluateProductCovInventoryGate({
    price: 0,
    stock: 0,
    location: '',
    igst_rate: null,
    cgst_rate: null,
    sgst_rate: null
  });
  assert.equal(incomplete.ok, false);
  assert.match(incomplete.message, /Inventory completion is required before Product COV/);
  assert.ok(incomplete.missingFields.includes('MRP (incl. GST)'));
  assert.ok(incomplete.missingFields.includes('Location'));

  const catalogOnly = evaluateProductCovInventoryGate({
    price: 0,
    stock: 0,
    location: 'Pune warehouse',
    igst_rate: 18,
    cgst_rate: 9,
    sgst_rate: 9
  });
  assert.equal(catalogOnly.ok, false);
  assert.match(catalogOnly.message, /MRP/);

  const gstInheritedNoLocation = evaluateProductCovInventoryGate({
    price: 0,
    stock: 0,
    location: '',
    igst_rate: 18,
    cgst_rate: 9,
    sgst_rate: 9
  });
  assert.equal(gstInheritedNoLocation.ok, false);
  assert.ok(gstInheritedNoLocation.missingFields.includes('MRP (incl. GST)'));
  assert.ok(gstInheritedNoLocation.missingFields.includes('Location'));

  const complete = evaluateProductCovInventoryGate({
    price: 120,
    stock: 0,
    location: 'Pune warehouse',
    igst_rate: 18,
    cgst_rate: 9,
    sgst_rate: 9
  });
  assert.equal(complete.ok, true);
});
