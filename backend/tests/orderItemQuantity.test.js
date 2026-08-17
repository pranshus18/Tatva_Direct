import test from 'node:test';
import assert from 'node:assert/strict';
import { sumOrderItemQuantities } from '../utils/orderItemQuantity.js';

test('sumOrderItemQuantities uses quantity, not product-row count', () => {
  assert.equal(
    sumOrderItemQuantities([{ quantity: 2 }]),
    2,
    'one product with qty 2 is 2 items'
  );
  assert.equal(
    sumOrderItemQuantities([{ quantity: 2 }, { quantity: 3 }]),
    5
  );
});

test('sumOrderItemQuantities ignores invalid and empty rows', () => {
  assert.equal(sumOrderItemQuantities([]), 0);
  assert.equal(sumOrderItemQuantities(null), 0);
  assert.equal(sumOrderItemQuantities([{ quantity: 0 }, { quantity: -1 }, {}]), 0);
});
