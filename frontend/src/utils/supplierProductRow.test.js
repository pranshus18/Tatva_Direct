import { describe, expect, it } from 'vitest';
import { normalizeSupplierProductFromApi } from './supplierProductRow';

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

  it('treats is_active offers as approved/active for catalog counters', () => {
    const row = normalizeSupplierProductFromApi({
      status: 'pending',
      is_active: true,
      supplier_product_id: 'sp2'
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
