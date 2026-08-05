import {
  SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL,
  formatSupplierStockAvailability,
  getSupplierStockHealth,
  isSupplierInventoryConfigured,
  isSupplierMrpLocked,
  parseSupplierLsaThreshold
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

describe('isSupplierMrpLocked', () => {
  it('locks MRP after a saved amount greater than zero', () => {
    expect(isSupplierMrpLocked({ price: 250 })).toBe(true);
    expect(isSupplierMrpLocked({ price: 0 })).toBe(false);
    expect(isSupplierMrpLocked(null)).toBe(false);
  });
});

describe('parseSupplierLsaThreshold', () => {
  it('accepts positive whole numbers', () => {
    expect(parseSupplierLsaThreshold('1')).toBe(1);
    expect(parseSupplierLsaThreshold(10)).toBe(10);
  });

  it('rejects missing or invalid values', () => {
    expect(parseSupplierLsaThreshold('')).toBe(null);
    expect(parseSupplierLsaThreshold(0)).toBe(null);
    expect(parseSupplierLsaThreshold('abc')).toBe(null);
    expect(parseSupplierLsaThreshold(null)).toBe(null);
  });
});

describe('getSupplierStockHealth', () => {
  it('marks out of stock at zero or below', () => {
    expect(getSupplierStockHealth({ stock: 0, lsa: 10 })).toBe('out');
    expect(getSupplierStockHealth({ stock: null, lsa: 10 })).toBe('out');
  });

  it('uses supplier LSA instead of a fixed threshold', () => {
    expect(getSupplierStockHealth({ stock: 10, lsa: 1 })).toBe('ok');
    expect(getSupplierStockHealth({ stock: 1, lsa: 1 })).toBe('low');
    expect(getSupplierStockHealth({ stock: 10, lsa: 10 })).toBe('low');
    expect(getSupplierStockHealth({ stock: 9, lsa: 10 })).toBe('low');
  });

  it('does not flag low stock when LSA is unset', () => {
    expect(getSupplierStockHealth({ stock: 3 })).toBe('ok');
    expect(getSupplierStockHealth({ stock: 3, lsa: '' })).toBe('ok');
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
