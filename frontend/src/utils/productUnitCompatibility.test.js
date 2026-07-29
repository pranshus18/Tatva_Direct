import { describe, expect, it } from 'vitest';
import {
  inferProductMeasureClass,
  normalizeProductUnitKey,
  validateProductUnitCompatibility
} from './productUnitCompatibility';

describe('productUnitCompatibility', () => {
  it('classifies wireless mouse under electronics as discrete', () => {
    expect(
      inferProductMeasureClass({
        productName: 'Logitech M185 Wireless Mouse',
        category: 'Electronics / Computer Accessories'
      })
    ).toBe('discrete');
  });

  it('maps bags to bag unit family and piece to count', () => {
    expect(normalizeProductUnitKey('bags')).toBe('bag');
    expect(normalizeProductUnitKey('Piece')).toBe('count');
    expect(normalizeProductUnitKey('Nos')).toBe('count');
  });

  it('blocks bags for a wireless mouse', () => {
    const result = validateProductUnitCompatibility({
      unit: 'bags',
      productName: 'Logitech M185 Wireless Mouse',
      category: 'Electronics / Computer Accessories'
    });
    expect(result.ok).toBe(false);
    expect(result.severity).toBe('error');
    expect(result.code).toBe('unit_incompatible');
    expect(result.message).toMatch(/Piece|Unit|Nos/i);
  });

  it('allows Piece / Unit / Nos for discrete electronics', () => {
    for (const unit of ['Piece', 'Unit', 'Nos', 'pcs', 'Box']) {
      const result = validateProductUnitCompatibility({
        unit,
        productName: 'Logitech M185 Wireless Mouse',
        category: 'Electronics / Computer Accessories'
      });
      expect(result.ok).toBe(true);
      expect(result.severity).toBe('none');
    }
  });

  it('allows bags for cement / construction bulk goods', () => {
    const result = validateProductUnitCompatibility({
      unit: 'bags',
      productName: 'OPC 53 Cement',
      category: 'Construction / Cement'
    });
    expect(result.ok).toBe(true);
  });
});
