import test from 'node:test';
import assert from 'node:assert/strict';
import { crossedInventoryBelowMov, crossedLsaThreshold } from '../services/lowInventoryMovAlertService.js';
import {
  getMaxMinimumOrderValueInrForSupplierProfile,
  getMinimumOrderValueInrForSellerRole
} from '../utils/supplierProfile.js';

test('crossedLsaThreshold triggers only on above-to-below/equal crossing', () => {
  assert.equal(crossedLsaThreshold({ previousStock: 20, newStock: 10, lsaThreshold: 10 }), true);
  assert.equal(crossedLsaThreshold({ previousStock: 10, newStock: 9, lsaThreshold: 10 }), false);
  assert.equal(crossedLsaThreshold({ previousStock: 25, newStock: 16, lsaThreshold: 10 }), false);
  assert.equal(crossedLsaThreshold({ previousStock: 20, newStock: 10, lsaThreshold: 0 }), false);
});

test('crossedLsaThreshold edge cases', () => {
  // Lands exactly on LSA
  assert.equal(crossedLsaThreshold({ previousStock: 11, newStock: 10, lsaThreshold: 10 }), true);
  // Drops through LSA to zero
  assert.equal(crossedLsaThreshold({ previousStock: 5, newStock: 0, lsaThreshold: 3 }), true);
  // Stock increase never counts as a crossing
  assert.equal(crossedLsaThreshold({ previousStock: 5, newStock: 15, lsaThreshold: 10 }), false);
  // Already at/below LSA, further decrease
  assert.equal(crossedLsaThreshold({ previousStock: 8, newStock: 5, lsaThreshold: 10 }), false);
  // Stays above LSA after decrease
  assert.equal(crossedLsaThreshold({ previousStock: 50, newStock: 40, lsaThreshold: 10 }), false);
  // Invalid or missing LSA
  assert.equal(crossedLsaThreshold({ previousStock: 20, newStock: 5, lsaThreshold: 'abc' }), false);
  assert.equal(crossedLsaThreshold({ previousStock: 20, newStock: 5, lsaThreshold: null }), false);
  assert.equal(crossedLsaThreshold({ previousStock: 20, newStock: 5, lsaThreshold: undefined }), false);
  // Coerces numeric strings
  assert.equal(crossedLsaThreshold({ previousStock: '20', newStock: '10', lsaThreshold: '10' }), true);
  // Negative stock inputs clamp to 0
  assert.equal(crossedLsaThreshold({ previousStock: 4, newStock: -2, lsaThreshold: 2 }), true);
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
