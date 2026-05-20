import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldUpdateLastLogin } from '../utils/lastLoginThrottle.js';

test('shouldUpdateLastLogin returns true when last login is null', () => {
  assert.equal(shouldUpdateLastLogin(null, 600_000, 1_000_000), true);
});

test('shouldUpdateLastLogin returns false inside interval', () => {
  const now = Date.parse('2026-01-01T12:00:00.000Z');
  const last = '2026-01-01T11:55:00.000Z';
  assert.equal(shouldUpdateLastLogin(last, 600_000, now), false);
});

test('shouldUpdateLastLogin returns true after interval elapsed', () => {
  const now = Date.parse('2026-01-01T12:10:01.000Z');
  const last = '2026-01-01T12:00:00.000Z';
  assert.equal(shouldUpdateLastLogin(last, 600_000, now), true);
});
