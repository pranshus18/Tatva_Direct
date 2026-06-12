import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReturnTrackingId,
  normalizeReturnTrackingId,
  orderItemTrackingToken
} from '../controllers/dashboard/shared/dashboardHelpers.js';

test('buildReturnTrackingId embeds order and line-item tokens', () => {
  const id = buildReturnTrackingId({
    orderNumber: 'ORD-1001',
    orderItemId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    sequence: 1
  });
  assert.equal(id, 'RET-ORD-1001-A1B2C3D4');
});

test('buildReturnTrackingId adds sequence suffix for repeat returns on same line', () => {
  const id = buildReturnTrackingId({
    orderNumber: 'ORD-1001',
    orderItemId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    sequence: 2
  });
  assert.equal(id, 'RET-ORD-1001-A1B2C3D4-R2');
});

test('different order items on the same order get different tracking IDs', () => {
  const itemA = buildReturnTrackingId({
    orderNumber: 'ORD-1001',
    orderItemId: 'aaaaaaaa-1111-2222-3333-444444444444'
  });
  const itemB = buildReturnTrackingId({
    orderNumber: 'ORD-1001',
    orderItemId: 'bbbbbbbb-1111-2222-3333-444444444444'
  });
  assert.notEqual(itemA, itemB);
});

test('normalizeReturnTrackingId uppercases and strips unsafe characters', () => {
  assert.equal(normalizeReturnTrackingId(' ret-abc-123 '), 'RET-ABC-123');
});

test('orderItemTrackingToken is stable and compact', () => {
  assert.equal(orderItemTrackingToken('a1b2c3d4-e5f6-7890-abcd-ef1234567890'), 'A1B2C3D4');
});
