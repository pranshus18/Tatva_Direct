import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLsaNotificationPayload,
  crossedInventoryBelowMov,
  crossedLsaThreshold,
  isStockBelowLsa,
  parseLsaThreshold,
  resolveLsaThreshold,
  shouldNotifyLsaHit
} from '../services/lowInventoryMovAlertService.js';
import {
  getMaxMinimumOrderValueInrForSupplierProfile,
  getMinimumOrderValueInrForSellerRole
} from '../utils/supplierProfile.js';

test('parseLsaThreshold accepts positive whole units only', () => {
  assert.equal(parseLsaThreshold('12'), 12);
  assert.equal(parseLsaThreshold(8), 8);
  assert.equal(parseLsaThreshold('0'), null);
  assert.equal(parseLsaThreshold(''), null);
  assert.equal(parseLsaThreshold('abc'), null);
  assert.equal(parseLsaThreshold(null), null);
});

test('isStockBelowLsa uses each variant LSA (no hardcoded threshold)', () => {
  assert.equal(isStockBelowLsa({ stock: 8, lsa: 10 }), true);
  assert.equal(isStockBelowLsa({ stock: 8, lsa: 5 }), false);
  assert.equal(isStockBelowLsa({ stock: 5, lsa: 5 }), false);
  assert.equal(isStockBelowLsa({ stock: 4, lsa: 5 }), true);
  assert.equal(isStockBelowLsa({ stock: 0, lsa: 3 }), true);
  assert.equal(isStockBelowLsa({ stock: 0, lsa: null }), false);
  assert.equal(isStockBelowLsa({ stock: 2, lsa: '' }), false);
});

test('crossedLsaThreshold triggers only on above/equal-to-below crossing', () => {
  assert.equal(crossedLsaThreshold({ previousStock: 20, newStock: 10, lsaThreshold: 10 }), false);
  assert.equal(crossedLsaThreshold({ previousStock: 10, newStock: 9, lsaThreshold: 10 }), true);
  assert.equal(crossedLsaThreshold({ previousStock: 25, newStock: 16, lsaThreshold: 10 }), false);
  assert.equal(crossedLsaThreshold({ previousStock: 20, newStock: 10, lsaThreshold: 0 }), false);
});

test('crossedLsaThreshold edge cases', () => {
  // Lands exactly on LSA — not low stock
  assert.equal(crossedLsaThreshold({ previousStock: 11, newStock: 10, lsaThreshold: 10 }), false);
  // Drops from LSA to below it
  assert.equal(crossedLsaThreshold({ previousStock: 10, newStock: 9, lsaThreshold: 10 }), true);
  // Drops through LSA to zero
  assert.equal(crossedLsaThreshold({ previousStock: 5, newStock: 0, lsaThreshold: 3 }), true);
  // Stock increase never counts as a crossing
  assert.equal(crossedLsaThreshold({ previousStock: 5, newStock: 15, lsaThreshold: 10 }), false);
  // Already below LSA, further decrease
  assert.equal(crossedLsaThreshold({ previousStock: 8, newStock: 5, lsaThreshold: 10 }), false);
  // Stays at or above LSA after decrease
  assert.equal(crossedLsaThreshold({ previousStock: 50, newStock: 40, lsaThreshold: 10 }), false);
  // Invalid or missing LSA
  assert.equal(crossedLsaThreshold({ previousStock: 20, newStock: 5, lsaThreshold: 'abc' }), false);
  assert.equal(crossedLsaThreshold({ previousStock: 20, newStock: 5, lsaThreshold: null }), false);
  assert.equal(crossedLsaThreshold({ previousStock: 20, newStock: 5, lsaThreshold: undefined }), false);
  // Coerces numeric strings
  assert.equal(crossedLsaThreshold({ previousStock: '20', newStock: '9', lsaThreshold: '10' }), true);
  // Negative stock inputs clamp to 0
  assert.equal(crossedLsaThreshold({ previousStock: 4, newStock: -2, lsaThreshold: 2 }), true);
});

test('resolveLsaThreshold reads LSA from JSON-string attributes and nested specs', () => {
  assert.equal(resolveLsaThreshold({ lsa: '12' }), 12);
  assert.equal(resolveLsaThreshold('{"lsa":"8"}'), 8);
  assert.equal(resolveLsaThreshold({ LSA: 6 }), 6);
  assert.equal(resolveLsaThreshold({ specifications: { lsa: 4 } }), 4);
  assert.equal(resolveLsaThreshold({}, { lsa: 9 }), 9);
  assert.equal(resolveLsaThreshold({}, { attributes: { lsa: '7' } }), 7);
  assert.equal(resolveLsaThreshold({}), null);
});

test('shouldNotifyLsaHit covers crossing below LSA, already-below decrease, and newly set LSA', () => {
  assert.equal(
    shouldNotifyLsaHit({ previousStock: 20, newStock: 10, lsaThreshold: 10 }),
    false
  );
  assert.equal(
    shouldNotifyLsaHit({ previousStock: 10, newStock: 9, lsaThreshold: 10 }),
    true
  );
  assert.equal(
    shouldNotifyLsaHit({ previousStock: 8, newStock: 5, lsaThreshold: 10 }),
    true
  );
  assert.equal(
    shouldNotifyLsaHit({
      previousStock: 8,
      newStock: 8,
      lsaThreshold: 10,
      previousLsaThreshold: null
    }),
    true
  );
  assert.equal(
    shouldNotifyLsaHit({
      previousStock: 10,
      newStock: 10,
      lsaThreshold: 10,
      previousLsaThreshold: null
    }),
    false
  );
  assert.equal(
    shouldNotifyLsaHit({
      previousStock: 8,
      newStock: 8,
      lsaThreshold: 10,
      previousLsaThreshold: 5
    }),
    true
  );
  assert.equal(
    shouldNotifyLsaHit({
      previousStock: 8,
      newStock: 8,
      lsaThreshold: 10,
      previousLsaThreshold: 10
    }),
    false
  );
  assert.equal(
    shouldNotifyLsaHit({ previousStock: 25, newStock: 16, lsaThreshold: 10 }),
    false
  );
  assert.equal(
    shouldNotifyLsaHit({ previousStock: 8, newStock: 8, lsaThreshold: 10 }),
    false
  );
});

test('buildLsaNotificationPayload is a supplier-visible low-stock alert', () => {
  const payload = buildLsaNotificationPayload({
    supplierId: 'sup-1',
    productId: 'prod-1',
    supplierProductId: 'offer-1',
    productName: 'OPC 53 Cement',
    previousStock: 12,
    newStock: 8,
    lsaThreshold: 10
  });
  assert.equal(payload.user_id, 'sup-1');
  assert.equal(payload.type, 'system');
  assert.match(payload.title.toLowerCase(), /low stock/);
  assert.match(payload.title, /LSA/);
  assert.equal(payload.metadata.source, 'low_inventory');
  assert.equal(payload.metadata.kind, 'inventory_below_lsa');
  assert.equal(payload.metadata.lsa_threshold, 10);
  assert.equal(payload.related_product_id, 'prod-1');
});

test('crossedInventoryBelowMov triggers when inventory value drops under MOV', () => {
  assert.equal(
    crossedInventoryBelowMov({
      previousStock: 11,
      newStock: 9,
      unitPrice: 100,
      movThreshold: 1000
    }),
    true
  );
  assert.equal(
    crossedInventoryBelowMov({
      previousStock: 10,
      newStock: 9,
      unitPrice: 100,
      movThreshold: 1000
    }),
    true
  );
  assert.equal(
    crossedInventoryBelowMov({
      previousStock: 9,
      newStock: 8,
      unitPrice: 100,
      movThreshold: 1000
    }),
    false
  );
});

test('getMinimumOrderValueInrForSellerRole resolves role-specific MOV', () => {
  const profile = {
    supplierRole: 'dealer',
    minimumOrderValue: 1200,
    companyInfoEntries: [
      { role: 'dealer', minimumOrderValue: 1500 },
      { role: 'retailer', minimumOrderValue: 9999 }
    ]
  };
  assert.equal(getMinimumOrderValueInrForSellerRole(profile, 'dealer'), 1500);
  assert.equal(getMinimumOrderValueInrForSellerRole(profile, 'retailer'), 0);
  assert.equal(getMinimumOrderValueInrForSellerRole(profile, 'distributor'), 0);
});

test('getMaxMinimumOrderValueInrForSupplierProfile picks highest non-retailer MOV', () => {
  const profile = {
    supplierRole: 'dealer',
    minimumOrderValue: 1700,
    companyInfoEntries: [
      { role: 'dealer', minimumOrderValue: 1200 },
      { role: 'wholesaler', minimumOrderValue: 2500 },
      { role: 'retailer', minimumOrderValue: 5000 }
    ]
  };
  assert.equal(getMaxMinimumOrderValueInrForSupplierProfile(profile), 2500);
});
