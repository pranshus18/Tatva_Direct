import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_SUPPLIER_PRODUCT_PHOTOS,
  countSupplierProductPhotos,
  validateMinSupplierProductPhotos
} from '../utils/supplierProductPhotos.js';

test('countSupplierProductPhotos counts unique http(s) urls only', () => {
  assert.equal(
    countSupplierProductPhotos([
      'https://cdn.example.com/a.jpg',
      'https://cdn.example.com/a.jpg',
      'blob:http://localhost/1',
      'not-a-url',
      'http://cdn.example.com/b.jpg',
      ''
    ]),
    2
  );
});

test('validateMinSupplierProductPhotos rejects zero photos', () => {
  const result = validateMinSupplierProductPhotos([]);
  assert.equal(result.ok, false);
  assert.equal(result.count, 0);
  assert.deepEqual(result.missingFields, ['images']);
  assert.match(result.message, /at least 1 product photo/i);
});

test('validateMinSupplierProductPhotos accepts 1 or more photos', () => {
  const result = validateMinSupplierProductPhotos(['https://cdn.example.com/a.jpg']);
  assert.equal(result.ok, true);
  assert.equal(result.count, MIN_SUPPLIER_PRODUCT_PHOTOS);
  assert.equal(result.message, '');
});

test('validateMinSupplierProductPhotos uses a clear zero-photo message', () => {
  const result = validateMinSupplierProductPhotos([]);
  assert.equal(result.ok, false);
  assert.match(result.message, /upload a product photo/i);
});
