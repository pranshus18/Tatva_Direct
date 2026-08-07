import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveOrderChargeBreakdown,
  sumPoGroupsProductSubtotal,
  sumPoGroupsProductsInclGst
} from '../utils/orderChargeBreakdown.js';

test('resolveOrderChargeBreakdown adds GST when total_amount stored as subtotal only', () => {
  const breakdown = resolveOrderChargeBreakdown({
    total_amount: 1125,
    delivery_address: {
      gstSummary: {
        priceIncludesGst: false,
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

test('resolveOrderChargeBreakdown includes transport in combined total but not buyer vault debit', () => {
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
  assert.equal(breakdown.buyerVaultDebit, 1181.25);
  assert.equal(breakdown.logisticsVaultDebit, 200);
});

test('sumPoGroupsProductsInclGst uses MRP total and does not add GST again', () => {
  const total = sumPoGroupsProductsInclGst([
    { total: 1180, gstAmount: 180, totalInclGst: 1180 },
    { subtotal: 590, gstAmount: 90, totalInclGst: 590 }
  ]);
  assert.equal(total, 1770);
});

test('sumPoGroupsProductSubtotal returns taxable value extracted from MRP', () => {
  const taxable = sumPoGroupsProductSubtotal([
    {
      total: 1180,
      gstAmount: 180,
      totalInclGst: 1180,
      gstSummary: { subtotalAmount: 1000, taxAmount: 180, totalAmount: 1180 }
    }
  ]);
  assert.equal(taxable, 1000);
});
