import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderGstSummary,
  computeLineGst,
  isSameIndianState,
  resolveGstPlaceOfSupplyState
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
