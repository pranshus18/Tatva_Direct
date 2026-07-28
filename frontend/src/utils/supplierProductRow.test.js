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
});
