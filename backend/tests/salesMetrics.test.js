import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computePayLaterEligibleForSales,
  computePayLaterOffered,
  isPayLaterThresholdMet,
  isRevenueRecognizedOrder
} from '../utils/salesMetrics.js';

test('isRevenueRecognizedOrder: paid and not cancelled', () => {
  assert.equal(isRevenueRecognizedOrder({ payment_status: 'paid', status: 'confirmed' }), true);
  assert.equal(isRevenueRecognizedOrder({ payment_status: 'pending', status: 'confirmed' }), false);
  assert.equal(isRevenueRecognizedOrder({ payment_status: 'paid', status: 'cancelled' }), false);
});

test('isPayLaterThresholdMet: minimum order amount (not lifetime revenue)', () => {
  assert.equal(isPayLaterThresholdMet(49999, 50000, 0), false);
  assert.equal(isPayLaterThresholdMet(50000, 50000, 0), true);
  assert.equal(isPayLaterThresholdMet(60000, 50000, 0), true);
  // Prior revenue must not unlock a below-minimum order.
  assert.equal(isPayLaterThresholdMet(1000, 50000, 100000), false);
  assert.equal(isPayLaterThresholdMet(0, 0, 0), true);
});

test('computePayLaterOffered: threshold is minimum order amount', () => {
  const below = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 50000,
    orderAmount: 40000,
    priorNetRevenue: 999999,
    hasCreditParty: true
  });
  assert.equal(below.payLaterOffered, false);

  const met = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 50000,
    orderAmount: 50000,
    priorNetRevenue: 0,
    hasCreditParty: true
  });
  assert.equal(met.payLaterOffered, true);

  const noParty = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 50000,
    orderAmount: 60000,
    priorNetRevenue: 0,
    hasCreditParty: false
  });
  assert.equal(noParty.payLaterOffered, false);

  const optional = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 0,
    orderAmount: 100,
    priorNetRevenue: 0,
    hasCreditParty: true
  });
  assert.equal(optional.payLaterOffered, true);
});

test('computePayLaterEligibleForSales: account ready when credit limit is set', () => {
  const { payLaterEligible } = computePayLaterEligibleForSales({
    creditLimit: 100000,
    paylaterThreshold: 50000,
    priorNetRevenue: 0,
    hasCreditParty: true,
    buyerType: 'unified'
  });
  assert.equal(payLaterEligible, true);
});
