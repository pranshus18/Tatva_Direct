import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderGstSummary,
  buildPoGroupsCheckoutSummary,
  computeLineGst,
  isSameIndianState,
  resolveGstPlaceOfSupplyState,
  resolveSupplierProductTaxRates,
  resolveSupplierStateForGst
} from '../services/gstService.js';

test('resolveGstPlaceOfSupplyState prefers billing address when GSTIN is registered', () => {
  const state = resolveGstPlaceOfSupplyState({
    hasGstin: true,
    deliveryDestination: 'shipping',
    billingAddress: { state: 'Maharashtra' },
    shippingAddress: { state: 'Karnataka' }
  });
  assert.equal(state, 'Maharashtra');
});

test('computeLineGst uses IGST when supplier and customer are in different states', () => {
  assert.equal(isSameIndianState('Maharashtra', 'Karnataka'), false);
  const line = computeLineGst({
    taxableAmount: 1000,
    igstRate: 18,
    cgstRate: 9,
    sgstRate: 9,
    intraState: false
  });
  assert.equal(line.taxType, 'IGST');
  assert.equal(line.igstAmount, 180);
  assert.equal(line.totalAmount, 1180);
});

test('computeLineGst uses CGST+SGST when supplier and customer share the same state', () => {
  assert.equal(isSameIndianState('MH', 'Maharashtra'), true);
  const line = computeLineGst({
    taxableAmount: 1000,
    igstRate: 18,
    cgstRate: 9,
    sgstRate: 9,
    intraState: true
  });
  assert.equal(line.taxType, 'CGST_SGST');
  assert.equal(line.cgstAmount, 90);
  assert.equal(line.sgstAmount, 90);
  assert.equal(line.totalAmount, 1180);
});

test('buildOrderGstSummary stores supplier and place-of-supply states per order', () => {
  const summary = buildOrderGstSummary({
    lineTaxBreakdown: [
      computeLineGst({
        taxableAmount: 500,
        igstRate: 5,
        cgstRate: 2.5,
        sgstRate: 2.5,
        intraState: false
      })
    ],
    supplierState: 'Gujarat',
    billingState: 'Maharashtra',
    placeOfSupplyState: 'Maharashtra',
    intraStateTax: false
  });
  assert.equal(summary.taxType, 'IGST');
  assert.equal(summary.supplierState, 'gujarat');
  assert.equal(summary.placeOfSupplyState, 'maharashtra');
  assert.equal(summary.intraStateTax, false);
  assert.equal(summary.igstAmount, 25);
});

test('resolveSupplierProductTaxRates reads tax rates from offer attributes when columns are empty', () => {
  const rates = resolveSupplierProductTaxRates({
    attributes: { igstRate: 18, cgstRate: 9, sgstRate: 9 }
  });
  assert.equal(rates.igstRate, 18);
  assert.equal(rates.cgstRate, 9);
  assert.equal(rates.sgstRate, 9);
});

test('computeLineGst rounds per-line tax and keeps product total + GST = total incl GST', () => {
  const mouse = computeLineGst({
    taxableAmount: 1899,
    intraState: false,
    supplierProduct: { igst_rate: 12, cgst_rate: 6, sgst_rate: 6 }
  });
  const backpack = computeLineGst({
    taxableAmount: 300,
    intraState: false,
    supplierProduct: { igst_rate: 18, cgst_rate: 9, sgst_rate: 9 }
  });
  assert.equal(mouse.taxAmount, 227.88);
  assert.equal(backpack.taxAmount, 54);
  assert.equal(mouse.totalAmount, 2126.88);
  assert.equal(backpack.totalAmount, 354);

  const summary = buildPoGroupsCheckoutSummary([
    {
      subtotal: 2199,
      gstAmount: mouse.taxAmount + backpack.taxAmount,
      totalInclGst: mouse.totalAmount + backpack.totalAmount,
      gstSummary: buildOrderGstSummary({
        lineTaxBreakdown: [mouse, backpack],
        supplierState: 'delhi',
        billingState: 'karnataka',
        placeOfSupplyState: 'karnataka',
        intraStateTax: false
      })
    }
  ]);
  assert.equal(summary.productSubtotal, 2199);
  assert.equal(summary.gstAmount, 281.88);
  assert.equal(summary.productsInclGst, 2480.88);
});

test('resolveSupplierStateForGst falls back to offer location state', () => {
  const state = resolveSupplierStateForGst({
    supplierUser: { address: {} },
    supplierProduct: { location: 'Bengaluru, Karnataka, 560102, India' }
  });
  assert.equal(state, 'karnataka');
});
