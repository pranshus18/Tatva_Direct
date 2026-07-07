import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTodayDateInputValue,
  validateRequiredDateNotPast
} from '../utils/dateTime.js';

test('validateRequiredDateNotPast rejects past dates', () => {
  const now = new Date('2026-07-07T10:00:00.000Z');
  const result = validateRequiredDateNotPast('2026-07-06', now);
  assert.equal(result.value, null);
  assert.match(result.error, /past/i);
});

test('validateRequiredDateNotPast accepts today and future dates', () => {
  const now = new Date('2026-07-07T10:00:00.000Z');
  const today = getTodayDateInputValue(now);
  assert.deepEqual(validateRequiredDateNotPast(today, now), {
    value: today,
    error: null
  });
  assert.deepEqual(validateRequiredDateNotPast('2026-07-08', now), {
    value: '2026-07-08',
    error: null
  });
});
