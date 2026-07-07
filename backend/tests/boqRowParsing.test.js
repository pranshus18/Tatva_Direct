import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractBoqQuantity,
  parseBoqQuantityValue
} from '../utils/boqRowParsing.js';

test('extractBoqQuantity uses quantity column instead of leading numbers in product name', () => {
  const row = {
    'Product name': '112 PIDIFIN 2K ACRYLIC CEMENTITIOUS WATERPROOF COATING',
    quantity: 3
  };
  assert.equal(extractBoqQuantity(row), 3);
});

test('extractBoqQuantity matches quantity headers with surrounding whitespace', () => {
  const row = {
    'Product name': '112 PIDIFIN 2K ACRYLIC CEMENTITIOUS WATERPROOF COATING',
    ' quantity ': 3
  };
  assert.equal(extractBoqQuantity(row), 3);
});

test('parseBoqQuantityValue rejects product names that start with numbers', () => {
  assert.equal(parseBoqQuantityValue('112 PIDIFIN 2K ACRYLIC CEMENTITIOUS WATERPROOF COATING'), null);
});

test('parseBoqQuantityValue accepts plain and unit-suffixed quantities', () => {
  assert.equal(parseBoqQuantityValue('3'), 3);
  assert.equal(parseBoqQuantityValue('3 nos'), 3);
  assert.equal(parseBoqQuantityValue('1,000'), 1000);
});
