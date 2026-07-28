import {
  SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL,
  formatSupplierStockAvailability,
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
});

describe('inventory labels', () => {
  it('uses Inventory Setup Pending copy', () => {
    expect(SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL).toBe('Inventory Setup Pending');
  });

  it('formats stock availability for catalog cards', () => {
    expect(formatSupplierStockAvailability(12)).toBe('12 in stock');
    expect(formatSupplierStockAvailability(3)).toBe('3 in stock');
    expect(formatSupplierStockAvailability(0)).toBe('Out of stock');
    expect(formatSupplierStockAvailability(null)).toBe('Out of stock');
  });
});
