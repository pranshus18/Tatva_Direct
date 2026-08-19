import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAllowedPrimaryStatusTransitions,
  getInvalidPrimaryStatusTransitionMessage,
  isValidPrimaryOrderStatus,
  isValidPrimaryStatusTransition,
  toLifecycleStateFromStatus,
  toPrimaryStatusFromLifecycle
} from '../utils/orderLifecycle.js';

test('maps primary statuses to lifecycle states', () => {
  assert.equal(toLifecycleStateFromStatus('pending'), 'draft');
  assert.equal(toLifecycleStateFromStatus('processing'), 'packed');
  assert.equal(toLifecycleStateFromStatus('delivered'), 'delivered');
  assert.equal(toLifecycleStateFromStatus('cancelled'), 'cancelled');
});

test('maps lifecycle states back to primary statuses', () => {
  assert.equal(toPrimaryStatusFromLifecycle('draft'), 'pending');
  assert.equal(toPrimaryStatusFromLifecycle('packed'), 'processing');
  assert.equal(toPrimaryStatusFromLifecycle('settled'), 'delivered');
  assert.equal(toPrimaryStatusFromLifecycle('returned'), 'returned');
});

test('validates only primary order statuses for direct status updates', () => {
  assert.equal(isValidPrimaryOrderStatus('confirmed'), true);
  assert.equal(isValidPrimaryOrderStatus('packed'), false);
  assert.equal(isValidPrimaryOrderStatus(''), false);
});

test('allows only the next sequential status or cancel', () => {
  assert.deepEqual(getAllowedPrimaryStatusTransitions('pending'), ['confirmed', 'cancelled']);
  assert.deepEqual(getAllowedPrimaryStatusTransitions('confirmed'), ['processing', 'cancelled']);
  assert.deepEqual(getAllowedPrimaryStatusTransitions('processing'), ['shipped', 'cancelled']);
  assert.deepEqual(getAllowedPrimaryStatusTransitions('shipped'), ['delivered', 'cancelled']);
  assert.deepEqual(getAllowedPrimaryStatusTransitions('delivered'), []);
  assert.deepEqual(getAllowedPrimaryStatusTransitions('cancelled'), []);
});

test('rejects backward and skipped order status transitions', () => {
  assert.equal(isValidPrimaryStatusTransition('processing', 'processing'), true);
  assert.equal(isValidPrimaryStatusTransition('processing', 'shipped'), true);
  assert.equal(isValidPrimaryStatusTransition('processing', 'cancelled'), true);
  assert.equal(isValidPrimaryStatusTransition('processing', 'confirmed'), false);
  assert.equal(isValidPrimaryStatusTransition('processing', 'pending'), false);
  assert.equal(isValidPrimaryStatusTransition('processing', 'delivered'), false);
  assert.equal(isValidPrimaryStatusTransition('delivered', 'shipped'), false);
  assert.equal(isValidPrimaryStatusTransition('cancelled', 'pending'), false);
});

test('rejects every status change once an order is cancelled', () => {
  assert.equal(isValidPrimaryStatusTransition('cancelled', 'cancelled'), false);
  assert.equal(isValidPrimaryStatusTransition('cancelled', 'pending'), false);
  assert.equal(isValidPrimaryStatusTransition('cancelled', 'confirmed'), false);
  assert.equal(isValidPrimaryStatusTransition('canceled', 'processing'), false);
  assert.deepEqual(getAllowedPrimaryStatusTransitions('cancelled'), []);
  assert.match(
    getInvalidPrimaryStatusTransitionMessage('cancelled', 'confirmed'),
    /cancelled and the status cannot be changed/i
  );
});

