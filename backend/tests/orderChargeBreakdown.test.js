import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOrderChargeBreakdown,
  sumPoGroupsProductsInclGst
} from '../utils/orderChargeBreakdown.js';

test('resolveOrderChargeBreakdown adds GST when total_amount stored as subtotal only', () => {
  const breakdown = resolveOrderChargeBreakdown({
    total_amount: 1125,
    delivery_address: {
      gstSummary: {
        taxType: 'IGST',
        subtotalAmount: 1125,
        taxAmount: 56.25,
        igstAmount: 56.25,
        totalAmount: 1181.25
      }
    }
  });

  assert.equal(breakdown.productSubtotal, 1125);
  assert.equal(breakdown.gstAmount, 56.25);
  assert.equal(breakdown.productsInclGst, 1181.25);
  assert.equal(breakdown.combinedTotal, 1181.25);
});

test('resolveOrderChargeBreakdown includes transport in combined total', () => {
  const breakdown = resolveOrderChargeBreakdown({
    total_amount: 1125,
    delivery_address: {
      gstSummary: {
        subtotalAmount: 1125,
        taxAmount: 56.25,
        totalAmount: 1181.25
      },
      transportBill: { amount: 200 }
    }
  });

  assert.equal(breakdown.transportAmount, 200);
  assert.equal(breakdown.combinedTotal, 1381.25);
});

test('sumPoGroupsProductsInclGst prefers totalInclGst from grouped PO preview', () => {
  const total = sumPoGroupsProductsInclGst([
    { total: 1000, gstAmount: 180, totalInclGst: 1180 },
    { subtotal: 500, gstAmount: 90, totalInclGst: 590 }
  ]);
  assert.equal(total, 1770);
});
