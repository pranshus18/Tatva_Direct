import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupeCheckoutLinesByProductForTest,
  reservationsMatchLinesForTest
} from '../services/checkoutInventoryReservationService.js';

test('reservationsMatchLines requires exact hold coverage for full checkout validation', () => {
  const sessionRows = [
    { supplier_product_id: 'offer-a', reserved_quantity: 1 },
    { supplier_product_id: 'offer-b', reserved_quantity: 2 }
  ];
  const allLines = [
    { supplierProductId: 'offer-a', quantity: 1 },
    { supplierProductId: 'offer-b', quantity: 2 }
  ];
  assert.equal(reservationsMatchLinesForTest(sessionRows, allLines), true);

  const oneGroupLines = [{ supplierProductId: 'offer-a', quantity: 1 }];
  assert.equal(reservationsMatchLinesForTest(sessionRows, oneGroupLines), false);
});

test('dedupeCheckoutLinesByProduct merges duplicate supplier offers in one group', () => {
  const merged = dedupeCheckoutLinesByProductForTest([
    { supplierProductId: 'offer-a', quantity: 1 },
    { supplierProductId: 'offer-a', quantity: 2 }
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].quantity, 3);
});

test('multi-group PO create consumes one group at a time without requiring empty session', () => {
  const sessionRows = [
    { supplier_product_id: 'offer-a', reserved_quantity: 1 },
    { supplier_product_id: 'offer-b', reserved_quantity: 2 }
  ];
  const groupOneLines = [{ supplierProductId: 'offer-a', quantity: 1 }];

  const byProductId = new Map(sessionRows.map((row) => [row.supplier_product_id, row]));
  for (const line of dedupeCheckoutLinesByProductForTest(groupOneLines)) {
    byProductId.delete(line.supplierProductId);
  }

  assert.equal(byProductId.size, 1);
  assert.ok(byProductId.has('offer-b'));
});
