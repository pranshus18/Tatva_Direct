import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidPrimaryOrderStatus,
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

