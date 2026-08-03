import { describe, expect, it } from 'vitest';
import {
  normalizeSupplierProductFromApi,
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
