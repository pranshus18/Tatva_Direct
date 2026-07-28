import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSupplierCatalogUpdateFields,
  validateSupplierInventoryUpdateFields,
  validateSupplierProductUpdateRequest
} from '../services/supplierProductUpdateValidation.js';

test('inventory update rejects missing MRP, stock, and tax rates', () => {
  const result = validateSupplierInventoryUpdateFields({});
  assert.equal(result.ok, false);
  assert.ok(result.missingFields.includes('price'));
  assert.ok(result.missingFields.includes('stock'));
  assert.ok(result.missingFields.includes('igst_rate'));
});

test('inventory update accepts complete mandatory fields', () => {
  const result = validateSupplierInventoryUpdateFields({
    price: 120,
    stock: 10,
    igst_rate: 18,
    cgst_rate: 9,
    sgst_rate: 9
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.missingFields, []);
});

test('inventory update rejects invalid tax combination', () => {
  const result = validateSupplierInventoryUpdateFields({
    price: 120,
    stock: 10,
    igst_rate: 18,
    cgst_rate: 9,
    sgst_rate: 6
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /CGST and SGST/i);
});

test('catalog update rejects empty name/category/brand when provided', () => {
  const result = validateSupplierCatalogUpdateFields({
    name: '  ',
    category: '',
    brand: ''
  });
  assert.equal(result.ok, false);
  assert.ok(result.missingFields.includes('name'));
  assert.ok(result.missingFields.includes('category'));
  assert.ok(result.missingFields.includes('brand'));
});

test('catalog update allows image-only payload', () => {
  const result = validateSupplierCatalogUpdateFields({
    images: ['https://example.com/a.jpg']
  });
  assert.equal(result.ok, true);
});

test('product update request blocks incomplete inventory payload', () => {
  const result = validateSupplierProductUpdateRequest({
    stock: 0,
    location: ''
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'inventory_validation_error');
  assert.ok(result.missingFields.includes('price'));
});
