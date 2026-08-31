import test from 'node:test';
import assert from 'node:assert/strict';
import { SUPPLIER_CANNOT_DELETE_PRODUCT_MESSAGE } from '../controllers/supplier/productWrite/deleteProductRoute.js';

test('suppliers are told only admin can delete a product after it is added', () => {
  assert.match(SUPPLIER_CANNOT_DELETE_PRODUCT_MESSAGE, /only an admin can delete/i);
  assert.match(SUPPLIER_CANNOT_DELETE_PRODUCT_MESSAGE, /contact admin/i);
});
