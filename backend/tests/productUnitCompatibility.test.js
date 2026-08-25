import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  inferProductMeasureClass,
  validateProductUnitCompatibility
} from '../utils/productUnitCompatibility.js';

describe('productUnitCompatibility', () => {
  it('does not block bags for wireless mouse', () => {
    const result = validateProductUnitCompatibility({
      unit: 'bags',
      productName: 'Logitech M185 Wireless Mouse',
      category: 'Electronics / Computer Accessories'
    });
    assert.equal(result.ok, true);
    assert.equal(result.severity, 'warning');
    assert.equal(result.code, 'unit_unusual');
  });

  it('allows piece for discrete electronics', () => {
    const result = validateProductUnitCompatibility({
      unit: 'piece',
      productName: 'Logitech M185 Wireless Mouse',
      category: 'Electronics / Computer Accessories'
    });
    assert.equal(result.ok, true);
  });

  it('infers bulk for cement category', () => {
    assert.equal(
      inferProductMeasureClass({ productName: 'OPC Cement', category: 'Building Materials / Cement' }),
      'bulk'
    );
  });

  it('allows bag for ACC-branded cement instead of treating ACC as an air conditioner', () => {
    assert.equal(
      inferProductMeasureClass({
        productName: 'Adani ACC Suraksha Power PPC Cement, 50 Kg Bag',
        category: 'Building Materials'
      }),
      'bulk'
    );
    const result = validateProductUnitCompatibility({
      unit: 'bag',
      productName: 'Adani ACC Suraksha Power PPC Cement, 50 Kg Bag',
      category: 'Building Materials'
    });
    assert.equal(result.ok, true);
    assert.equal(result.severity, 'none');
    assert.equal(result.unitKey, 'bag');
  });

  it('classifies truncated ACC PPC cement names as bulk and allows bag', () => {
    assert.equal(
      inferProductMeasureClass({
        productName: 'Adani ACC Suraksha Power PPC Cer',
        category: ''
      }),
      'bulk'
    );
    const result = validateProductUnitCompatibility({
      unit: 'bag',
      productName: 'Adani ACC Suraksha Power PPC Cer',
      category: ''
    });
    assert.equal(result.ok, true);
    assert.equal(result.severity, 'none');
  });
});
