import test from 'node:test';
import assert from 'node:assert/strict';
import {
  areSpecificationsEqual,
  shouldMoveToPendingForSpecChange
} from '../utils/supplierProductApproval.js';

test('areSpecificationsEqual treats same spec object with different key order as equal', () => {
  const currentSpecs = {
    ram: '8gb',
    dimensions: { width: 10, height: 20 },
    tags: ['a', 'b']
  };
  const nextSpecs = {
    tags: ['a', 'b'],
    dimensions: { height: 20, width: 10 },
    ram: '8gb'
  };

  assert.equal(areSpecificationsEqual(currentSpecs, nextSpecs), true);
});

test('shouldMoveToPendingForSpecChange returns false when specifications are not provided', () => {
  const result = shouldMoveToPendingForSpecChange({
    specificationsProvided: false,
    currentSpecs: { color: 'red' },
    nextSpecs: { color: 'blue' }
  });

  assert.equal(result, false);
});

test('shouldMoveToPendingForSpecChange returns true when supplier changes specifications', () => {
  const result = shouldMoveToPendingForSpecChange({
    specificationsProvided: true,
    currentSpecs: { color: 'red', size: 'm' },
    nextSpecs: { color: 'blue', size: 'm' }
  });

  assert.equal(result, true);
});
