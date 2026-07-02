import test from 'node:test';
import assert from 'node:assert/strict';
import { computeNextStockLevel } from '../services/inventoryService.js';

test('computeNextStockLevel applies positive adjustments', () => {
  assert.equal(computeNextStockLevel(5, 3), 8);
});

test('computeNextStockLevel applies negative adjustments within stock', () => {
  assert.equal(computeNextStockLevel(5, -2), 3);
  assert.equal(computeNextStockLevel(5, -5), 0);
});

test('computeNextStockLevel rejects negative adjustments beyond available stock', () => {
  assert.throws(
    () => computeNextStockLevel(2, -3),
    /Insufficient stock for inventory movement/
  );
});
