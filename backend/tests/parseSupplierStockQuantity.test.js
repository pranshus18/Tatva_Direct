import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity.js';

test('parseSupplierStockQuantity: integers and grouped digits', () => {
  assert.equal(parseSupplierStockQuantity(250), 250);
  assert.equal(parseSupplierStockQuantity('250'), 250);
  assert.equal(parseSupplierStockQuantity('1,000'), 1000);
  assert.equal(parseSupplierStockQuantity('1,00,000'), 100000);
  assert.equal(parseSupplierStockQuantity('  42  '), 42);
});

test('parseSupplierStockQuantity: rejects invalid', () => {
  assert.equal(parseSupplierStockQuantity(''), null);
  assert.equal(parseSupplierStockQuantity('abc'), null);
  assert.equal(parseSupplierStockQuantity(-1), null);
});
