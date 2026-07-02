import test from 'node:test';
import assert from 'node:assert/strict';
import { parseServerDate } from '../utils/dateTime.js';
import {
  CHECKOUT_RESERVATION_MINUTES,
  computeAvailableStock,
  dedupeCheckoutLinesByProductForTest
} from '../services/checkoutInventoryReservationService.js';

test('CHECKOUT_RESERVATION_MINUTES uses env or defaults to 15', () => {
  const parsed = parseInt(String(process.env.CHECKOUT_RESERVATION_MINUTES ?? '').trim(), 10);
  const expected = Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
  assert.equal(CHECKOUT_RESERVATION_MINUTES, expected);
});

test('computeAvailableStock returns on-hand stock (holds already deducted physically)', () => {
  assert.equal(computeAvailableStock(10, 3), 10);
  assert.equal(computeAvailableStock(5, 8), 5);
  assert.equal(computeAvailableStock('12', '2'), 12);
  assert.equal(computeAvailableStock(0, 5), 0);
});

test('parseServerDate treats reservation UTC timestamps without Z as UTC', () => {
  const parsed = parseServerDate('2026-06-26T10:30:45.844');
  assert.ok(parsed);
  assert.equal(parsed.toISOString(), '2026-06-26T10:30:45.844Z');
});

test('future reservation expiry parses to roughly 15 minutes ahead', () => {
  const future = new Date(Date.now() + 15 * 60 * 1000).toISOString().replace('Z', '');
  const parsed = parseServerDate(future);
  const seconds = Math.ceil((parsed.getTime() - Date.now()) / 1000);
  assert.ok(seconds > 800);
  assert.ok(seconds <= 900);
});

test('dedupeCheckoutLinesByProduct merges lines without supplierId for order consume', () => {
  const merged = dedupeCheckoutLinesByProductForTest([
    { upstreamSupplierProductId: 'offer-a', quantity: 2 },
    { upstreamSupplierProductId: 'offer-a', quantity: 3 },
    { upstreamSupplierProductId: 'offer-b', quantity: 1 }
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((line) => line.upstreamSupplierProductId === 'offer-a')?.quantity, 5);
  assert.equal(merged.find((line) => line.upstreamSupplierProductId === 'offer-b')?.quantity, 1);
});
