import test from 'node:test';
import assert from 'node:assert/strict';
import { isReservationRowStillHoldable } from '../services/phase2CoreService.js';

test('active reservation with future expiry is still holdable (genuine idempotent replay)', () => {
  const row = {
    status: 'active',
    expires_at: new Date(Date.now() + 60 * 1000).toISOString()
  };
  assert.equal(isReservationRowStillHoldable(row), true);
});

test('active reservation past its expiry is NOT holdable, even before the sweep settles it', () => {
  const row = {
    status: 'active',
    expires_at: new Date(Date.now() - 1000).toISOString()
  };
  assert.equal(isReservationRowStillHoldable(row), false);
});

test('released reservation is never resurrected regardless of its stale expires_at', () => {
  const row = {
    status: 'released',
    // Even a future-looking expiry on a settled row must not be trusted — this is exactly the
    // shape of the bug where a just-released row (from a re-reserve) was handed back to the
    // caller as if it were an active hold.
    expires_at: new Date(Date.now() + 60 * 1000).toISOString()
  };
  assert.equal(isReservationRowStillHoldable(row), false);
});

test('expired reservation is never resurrected', () => {
  const row = { status: 'expired', expires_at: new Date(Date.now() + 60 * 1000).toISOString() };
  assert.equal(isReservationRowStillHoldable(row), false);
});

test('consumed reservation is never resurrected', () => {
  const row = { status: 'consumed', expires_at: new Date(Date.now() + 60 * 1000).toISOString() };
  assert.equal(isReservationRowStillHoldable(row), false);
});

test('missing row is not holdable', () => {
  assert.equal(isReservationRowStillHoldable(null), false);
  assert.equal(isReservationRowStillHoldable(undefined), false);
});

test('active reservation with no expires_at is treated as holdable (no known cutoff)', () => {
  assert.equal(isReservationRowStillHoldable({ status: 'active', expires_at: null }), true);
});
