import { describe, expect, it } from 'vitest';
import {
  SUPPLIER_INVENTORY_NOT_CONFIGURED_LABEL,
  formatSupplierStockAvailability,
  getSupplierStockHealth,
  isSupplierInventoryConfigured,
  isSupplierMrpLocked,
  isVariantMrpEnforced,
  isSupplierMrpInputDisabled,
  isSupplierHsnLocked,
  isSupplierGstLocked,
  isSupplierGtinLocked,
  isVariantHsnEnforced,
  isVariantGstEnforced,
  getCanonicalHsnCode,
  parseCanonicalGstRates,
  mergeCatalogHsnGstIntoForm,
  formatVariantMrpFixedMessage,
  getCanonicalVariantMrp,
  parseSupplierOfferPrice,
  parseSupplierLsaThreshold
} from './supplierStockLabel';

describe('isSupplierInventoryConfigured', () => {
  it('is false when MRP is unset', () => {
    expect(isSupplierInventoryConfigured({ price: 0, stock: 0, location: '' })).toBe(false);
    expect(isSupplierInventoryConfigured({ price: null, stock: 0 })).toBe(false);
    expect(isSupplierInventoryConfigured(null)).toBe(false);
    expect(isSupplierInventoryConfigured({ price: 0, stock: 0, location: 'Pune warehouse' })).toBe(
      false
    );
  });

  it('is true when MRP is set', () => {
    expect(isSupplierInventoryConfigured({ price: 120, stock: 0, location: '' })).toBe(true);
  });
});

describe('isSupplierMrpLocked', () => {
  it('locks MRP after a saved amount greater than zero', () => {
    expect(isSupplierMrpLocked({ price: 250 })).toBe(true);
    expect(isSupplierMrpLocked({ price: 0 })).toBe(false);
    expect(isSupplierMrpLocked(null)).toBe(false);
  });
});

describe('variant MRP enforcement', () => {
  it('detects canonical MRP set by another supplier', () => {
    expect(isVariantMrpEnforced({ canonicalMrp: 120 })).toBe(true);
    expect(isVariantMrpEnforced({ canonicalMrp: 0 })).toBe(false);
    expect(isVariantMrpEnforced({ price: 120 })).toBe(false);
  });

  it('disables supplier MRP input when locked or variant MRP is fixed', () => {
    expect(isSupplierMrpInputDisabled({ price: 120 })).toBe(true);
    expect(isSupplierMrpInputDisabled({ canonicalMrp: 99, price: 0 })).toBe(true);
    expect(isSupplierMrpInputDisabled({ price: 0 })).toBe(false);
  });

  it('formats fixed variant MRP message', () => {
    expect(formatVariantMrpFixedMessage(250)).toMatch(/250\.00/);
    expect(getCanonicalVariantMrp({ canonicalMrp: '120.5' })).toBe(120.5);
  });
});

describe('approved identity field locks', () => {
  const approved = {
    status: 'approved',
    hsnCode: '8518',
    igst_rate: 18,
    cgst_rate: 9,
    sgst_rate: 9,
    gtin: '00048011628233'
  };

  it('locks HSN, GST, and GTIN after approval when values are set', () => {
    expect(isSupplierHsnLocked(approved)).toBe(true);
    expect(isSupplierGstLocked(approved)).toBe(true);
    expect(isSupplierGtinLocked(approved)).toBe(true);
  });

  it('allows edits while the offer is still pending', () => {
    const pending = { ...approved, status: 'pending' };
    expect(isSupplierHsnLocked(pending)).toBe(false);
    expect(isSupplierGstLocked(pending)).toBe(false);
    expect(isSupplierGtinLocked(pending)).toBe(false);
  });

  it('allows the first fill when an approved offer is still missing the value', () => {
    expect(isSupplierHsnLocked({ status: 'approved', hsnCode: '' })).toBe(false);
    expect(isSupplierGstLocked({ status: 'approved', igst_rate: null })).toBe(false);
    expect(isSupplierGtinLocked({ status: 'approved', gtin: '' })).toBe(false);
  });
});

describe('catalog HSN/GST reuse', () => {
  it('reads canonical HSN/GST from another supplier offer', () => {
    expect(getCanonicalHsnCode({ canonicalHsnCode: '6910' })).toBe('6910');
    expect(parseCanonicalGstRates({ igstRate: 18, cgstRate: 9, sgstRate: 9 })).toEqual({
      igstRate: 18,
      cgstRate: 9,
      sgstRate: 9
    });
    expect(isVariantHsnEnforced({ canonicalHsnCode: '6910' })).toBe(true);
    expect(
      isVariantGstEnforced({ canonicalIgstRate: 18, canonicalCgstRate: 9, canonicalSgstRate: 9 })
    ).toBe(true);
  });

  it('fills empty form HSN and GST from lookup without overwriting typed values', () => {
    expect(
      mergeCatalogHsnGstIntoForm(
        { hsnCode: '', igst_rate: '', cgst_rate: '', sgst_rate: '' },
        { hsnCode: '6910', igstRate: 18, cgstRate: 9, sgstRate: 9 }
      )
    ).toEqual({
      hsnCode: '6910',
      igst_rate: '18',
      cgst_rate: '9',
      sgst_rate: '9'
    });
    expect(
      mergeCatalogHsnGstIntoForm(
        { hsnCode: '7324', igst_rate: '12', cgst_rate: '6', sgst_rate: '6' },
        { hsnCode: '6910', igstRate: 18, cgstRate: 9, sgstRate: 9 }
      )
    ).toEqual({
      hsnCode: '7324',
      igst_rate: '12',
      cgst_rate: '6',
      sgst_rate: '6'
    });
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

  it('does not flag low stock when quantity equals LSA', () => {
    expect(getSupplierStockHealth({ stock: 5, lsa: 5 })).toBe('ok');
    expect(getSupplierStockHealth({ stock: '10', lsa: '10' })).toBe('ok');
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
