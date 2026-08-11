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

test('isPayLaterThresholdMet: lifetime net revenue unlock (not per-order minimum)', () => {
  // Prior revenue below threshold — blocked even if this order is large.
  assert.equal(isPayLaterThresholdMet(100000, 1200, 1125), false);
  assert.equal(isPayLaterThresholdMet(50000, 50000, 49999), false);
  // Prior revenue at/above threshold — any later order size is fine.
  assert.equal(isPayLaterThresholdMet(1125, 1200, 1200), true);
  assert.equal(isPayLaterThresholdMet(1, 1200, 5000), true);
  assert.equal(isPayLaterThresholdMet(0, 0, 0), true);
});

test('computePayLaterOffered: once lifetime threshold is crossed, small orders can use pay later', () => {
  const notYet = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 1200,
    orderAmount: 1125,
    priorNetRevenue: 1125,
    hasCreditParty: true
  });
  assert.equal(notYet.payLaterOffered, false);

  const unlocked = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 1200,
    orderAmount: 1125,
    priorNetRevenue: 1200,
    hasCreditParty: true
  });
  assert.equal(unlocked.payLaterOffered, true);

  // Large current order does not unlock by itself.
  const bigOrderOnly = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 50000,
    orderAmount: 60000,
    priorNetRevenue: 0,
    hasCreditParty: true
  });
  assert.equal(bigOrderOnly.payLaterOffered, false);

  // Account alone is enough identity (SP or supplier buyer).
  const accountWithoutPartyFlag = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 0,
    orderAmount: 100,
    priorNetRevenue: 0,
    hasCreditParty: false
  });
  assert.equal(accountWithoutPartyFlag.payLaterOffered, true);

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

test('computePayLaterEligibleForSales: requires lifetime threshold when configured', () => {
  const locked = computePayLaterEligibleForSales({
    creditLimit: 100000,
    paylaterThreshold: 50000,
    priorNetRevenue: 10000,
    hasCreditParty: true,
    buyerType: 'unified'
  });
  assert.equal(locked.payLaterEligible, false);

  const ready = computePayLaterEligibleForSales({
    creditLimit: 100000,
    paylaterThreshold: 50000,
    priorNetRevenue: 50000,
    hasCreditParty: true,
    buyerType: 'unified'
  });
  assert.equal(ready.payLaterEligible, true);
});
