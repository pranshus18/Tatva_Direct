import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCreditCycleFromOrders,
  isPayLaterThresholdMet
} from '../services/creditAccountService.js';

test('computeCreditCycleFromOrders: empty unpaid orders', () => {
  const cycle = computeCreditCycleFromOrders([], 30);
  assert.equal(cycle.outstanding, 0);
  assert.equal(cycle.unpaidOrderCount, 0);
  assert.equal(cycle.isOverdue, false);
  assert.equal(cycle.cycleStartedAt, null);
});

test('computeCreditCycleFromOrders: sums outstanding and sets due from first order', () => {
  const started = '2026-01-01T00:00:00.000Z';
  const cycle = computeCreditCycleFromOrders(
    [
      {
        id: 'a',
        total_amount: 100000,
        status: 'confirmed',
        payment_method: 'credit',
        payment_status: 'pending',
        created_at: started
      },
      {
        id: 'b',
        total_amount: 50000,
        status: 'confirmed',
        payment_method: 'credit',
        payment_status: 'pending',
        created_at: '2026-01-10T00:00:00.000Z'
      }
    ],
    30
  );
  assert.equal(cycle.outstanding, 150000);
  assert.equal(cycle.unpaidOrderCount, 2);
  assert.equal(cycle.cycleStartedAt, started);
  assert.ok(cycle.cycleDueAt);
});

test('isPayLaterThresholdMet: net revenue below minimum by small margin fails', () => {
  assert.equal(isPayLaterThresholdMet(0, 1200415, 1200410), false);
  assert.equal(isPayLaterThresholdMet(100000, 1200415, 1200410), false);
  assert.equal(isPayLaterThresholdMet(0, 1200415, 1200415), true);
});

test('isPayLaterThresholdMet: cumulative net revenue already meet threshold', () => {
  assert.equal(isPayLaterThresholdMet(1000, 50000, 60000), true);
  assert.equal(isPayLaterThresholdMet(1000, 50000, 40000), false);
});

test('isPayLaterThresholdMet: current order does not count toward unlocking pay later', () => {
  assert.equal(isPayLaterThresholdMet(15000, 50000, 40000), false);
  assert.equal(isPayLaterThresholdMet(5000, 50000, 40000), false);
  assert.equal(isPayLaterThresholdMet(15000, 50000, 50000), true);
});

test('isPayLaterThresholdMet: zero threshold means not met (optional path uses limit only)', () => {
  assert.equal(isPayLaterThresholdMet(50000, 0, 0), false);
});

test('computePayLaterCycleLimitGate: overdue outstanding blocks pay later', async () => {
  const { computePayLaterCycleLimitGate } = await import('../utils/salesMetrics.js');
  const gate = computePayLaterCycleLimitGate({
    cycleIsOverdue: true,
    outstanding: 50000,
    creditLimit: 100000,
    orderAmount: 1000
  });
  assert.equal(gate.cycleBlocksPayLater, true);
  assert.equal(gate.blocksPayLater, true);
});

test('computePayLaterCycleLimitGate: within limit and not overdue allows pay later', async () => {
  const { computePayLaterCycleLimitGate } = await import('../utils/salesMetrics.js');
  const gate = computePayLaterCycleLimitGate({
    cycleIsOverdue: false,
    outstanding: 30000,
    creditLimit: 100000,
    orderAmount: 20000
  });
  assert.equal(gate.cycleBlocksPayLater, false);
  assert.equal(gate.exceedsCreditLimit, false);
  assert.equal(gate.blocksPayLater, false);
});

test('isWithinCreditLimit: full limit usable in one order', async () => {
  const { isWithinCreditLimit, computeRemainingCredit } = await import('../utils/salesMetrics.js');
  assert.equal(isWithinCreditLimit(0, 100000, 100000), true);
  assert.equal(computeRemainingCredit(100000, 0), 100000);
  assert.equal(isWithinCreditLimit(60000, 40000, 100000), true);
  assert.equal(computeRemainingCredit(100000, 60000), 40000);
});

test('isWithinCreditLimit: cannot exceed configured limit', async () => {
  const { isWithinCreditLimit } = await import('../utils/salesMetrics.js');
  assert.equal(isWithinCreditLimit(0, 100001, 100000), false);
  assert.equal(isWithinCreditLimit(90000, 15000, 100000), false);
  assert.equal(isWithinCreditLimit(90000, 10000, 100000), true);
});
