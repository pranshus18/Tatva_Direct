import { describe, expect, it } from 'vitest';
import {
  normalizeSupplierProductFromApi,
  getSupplierOfferApprovalStatus,
  normalizeSupplierProductKey,
  isSupplierProductEligibleForUpstream,
  filterSupplierProductsForUpstream
} from './supplierProductRow';

describe('normalizeSupplierProductFromApi approval status', () => {
  it('keeps pending status and maps rejection reason fields', () => {
    const row = normalizeSupplierProductFromApi({
      id: 'p1',
      supplier_product_id: 'sp1',
      status: 'pending',
      rejection_reason: 'Needs clearer photos',
      stock: '4'
    });
    expect(row.status).toBe('pending');
    expect(row.rejectionReason).toBe('Needs clearer photos');
    expect(row.rejection_reason).toBe('Needs clearer photos');
  });

  it('normalizes rejected and approved statuses', () => {
    expect(normalizeSupplierProductFromApi({ status: 'rejected' }).status).toBe('rejected');
    expect(normalizeSupplierProductFromApi({ status: 'active' }).status).toBe('approved');
    expect(normalizeSupplierProductFromApi({ status: 'approved' }).status).toBe('approved');
  });

  it('does not treat is_active alone as admin approval', () => {
    const row = normalizeSupplierProductFromApi({
      status: 'pending',
      is_active: true,
      supplier_product_id: 'sp2'
    });
    expect(row.status).toBe('pending');
    expect(row.is_active).toBe(false);
  });

  it('keeps approved offers active', () => {
    const row = normalizeSupplierProductFromApi({
      status: 'approved',
      is_active: true,
      supplier_product_id: 'sp2b'
    });
    expect(row.status).toBe('approved');
    expect(row.is_active).toBe(true);
  });

  it('normalizes configured price and stock for catalog display', () => {
    const row = normalizeSupplierProductFromApi({
      supplier_product_id: 'sp3',
      price: '1,250.50',
      stock: '8',
      location: 'Pune'
    });
    expect(row.price).toBe(1250.5);
    expect(row.stock).toBe(8);
    expect(row.location).toBe('Pune');
  });

  it('does not borrow shared catalog price for a different variant offer row', () => {
    const row = normalizeSupplierProductFromApi({
      id: 'catalog-product-1',
      supplier_product_id: 'sp-variant-b',
      price: 150
    });
    expect(row.price).toBe(150);
  });

  it('keeps offer price unset instead of fabricating zero when price is unparseable', () => {
    const row = normalizeSupplierProductFromApi({
      supplier_product_id: 'sp-bad-price',
      price: 'not-a-price'
    });
    expect(row.price).toBeNull();
  });
});

describe('upstream sourcing eligibility', () => {
  it('excludes rejected and pending products', () => {
    expect(isSupplierProductEligibleForUpstream({ status: 'rejected', is_active: false })).toBe(false);
    expect(isSupplierProductEligibleForUpstream({ status: 'pending', is_active: true })).toBe(false);
    expect(isSupplierProductEligibleForUpstream({ status: 'approved', is_active: true })).toBe(true);
  });

  it('filterSupplierProductsForUpstream keeps approved offers only', () => {
    const filtered = filterSupplierProductsForUpstream([
      { status: 'approved', is_active: true, supplier_product_id: 'a' },
      { status: 'rejected', is_active: false, supplier_product_id: 'b' },
      { status: 'pending', is_active: false, supplier_product_id: 'c' }
    ]);
    expect(filtered.map((p) => p.supplier_product_id)).toEqual(['a']);
  });
});

describe('getSupplierOfferApprovalStatus', () => {
  it('delegates to normalizeSupplierProductFromApi status', () => {
    expect(getSupplierOfferApprovalStatus({ status: 'pending' })).toBe('pending');
    expect(getSupplierOfferApprovalStatus({ status: 'active' })).toBe('approved');
    expect(getSupplierOfferApprovalStatus({ status: 'rejected' })).toBe('rejected');
  });
});

describe('normalizeSupplierProductKey', () => {
  it('trims string ids and coerces nullish to empty string', () => {
    expect(normalizeSupplierProductKey('  offer-1  ')).toBe('offer-1');
    expect(normalizeSupplierProductKey(null)).toBe('');
    expect(normalizeSupplierProductKey(undefined)).toBe('');
  });
});
