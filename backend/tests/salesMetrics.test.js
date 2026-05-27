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

test('computePayLaterOffered: threshold and party rules match checkout', () => {
  const below = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 1200415,
    priorNetRevenue: 1200410,
    hasCreditParty: true
  });
  assert.equal(below.payLaterOffered, false);

  const met = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 1200415,
    priorNetRevenue: 1200415,
    hasCreditParty: true
  });
  assert.equal(met.payLaterOffered, true);

  const noPhone = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 50000,
    priorNetRevenue: 60000,
    hasCreditParty: false
  });
  assert.equal(noPhone.payLaterOffered, false);

  const optional = computePayLaterOffered({
    hasAccount: true,
    creditLimit: 100000,
    paylaterThreshold: 0,
    priorNetRevenue: 0,
    hasCreditParty: true
  });
  assert.equal(optional.payLaterOffered, true);
});

test('computePayLaterEligibleForSales: aligns with offered when account configured', () => {
  const { payLaterEligible } = computePayLaterEligibleForSales({
    creditLimit: 100000,
    paylaterThreshold: 1200415,
    priorNetRevenue: 1200410,
    hasCreditParty: true,
    buyerType: 'unified'
  });
  assert.equal(payLaterEligible, false);
  assert.equal(isPayLaterThresholdMet(0, 1200415, 1200410), false);
});
