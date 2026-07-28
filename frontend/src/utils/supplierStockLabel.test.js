import { describe, expect, it } from 'vitest';
import {
  SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL,
  isSupplierInventoryConfigured
} from './supplierStockLabel';

describe('isSupplierInventoryConfigured', () => {
  it('is false when price and location are unset', () => {
    expect(isSupplierInventoryConfigured({ price: 0, stock: 0, location: '' })).toBe(false);
    expect(isSupplierInventoryConfigured({ price: null, stock: 0 })).toBe(false);
    expect(isSupplierInventoryConfigured(null)).toBe(false);
  });

  it('is true when MRP is set', () => {
    expect(isSupplierInventoryConfigured({ price: 120, stock: 0, location: '' })).toBe(true);
  });

  it('is true when location is set', () => {
    expect(isSupplierInventoryConfigured({ price: 0, stock: 0, location: 'Pune warehouse' })).toBe(
      true
    );
  });

  it('exposes the not-configured label', () => {
    expect(SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL).toBe('Inventory Not Configured');
  });
});
