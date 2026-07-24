import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSupersededIdempotencyKey,
  isIdempotencyKeyUniqueViolation,
  isPgUniqueViolation,
  isReservationRowStillHoldable
} from '../services/phase2CoreService.js';

test('active reservation with future expiry is still holdable (genuine idempotent replay)', () => {
  const row = {
    status: 'active',
    expires_at: new Date(Date.now() + 60 * 1000).toISOString()
  };
  assert.equal(isReservationRowStillHoldable(row), true);
});

test('superseded idempotency key fits VARCHAR(120) even for long checkout keys', () => {
  const reservationId = '3c7e2103-ca03-4964-8fa1-a7e2ea597786';
  const superseded = buildSupersededIdempotencyKey(reservationId);
  assert.equal(superseded, `done:${reservationId}`);
  assert.ok(superseded.length <= 120);

  // Old format overflowed VARCHAR(120) and left the unique key stuck on settled rows.
  const checkoutKey = `sp_po_checkout:11111111-1111-1111-1111-111111111111:22222222-2222-2222-2222-222222222222`;
  const legacySuperseded = `${checkoutKey}::superseded:${reservationId}`;
  assert.ok(legacySuperseded.length > 120);
  assert.ok(superseded.length < legacySuperseded.length);
});

test('detects Postgres unique violations by code or message', () => {
  assert.equal(isPgUniqueViolation({ code: '23505', message: 'duplicate' }), true);
  assert.equal(
    isIdempotencyKeyUniqueViolation({
      code: '23505',
      message: 'duplicate key value violates unique constraint "inventory_reservations_idempotency_key_key"'
    }),
    true
  );
  assert.equal(
    isIdempotencyKeyUniqueViolation({
      message: 'duplicate key value violates unique constraint "inventory_reservations_idempotency_key_key"'
    }),
    true
  );
  assert.equal(
    isIdempotencyKeyUniqueViolation({ code: '23505', message: 'duplicate key on order_number' }),
    false
  );
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
