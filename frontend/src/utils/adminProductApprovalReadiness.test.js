import { describe, expect, it } from 'vitest';
import { getAdminProductApprovalReadiness } from './adminProductApprovalReadiness.js';

describe('getAdminProductApprovalReadiness', () => {
  const readyPendingProduct = {
    status: 'pending',
    supplierDescription: 'Raw supplier submission.',
    publishedDescription: 'Professional steel bottle for daily hydration.',
    description: 'Professional steel bottle for daily hydration.',
    hsnCode: '7323',
    igst_rate: '18',
    cgst_rate: '9',
    sgst_rate: '9',
    specifications: { Brand: '', 'Model Name': '' }
  };

  it('passes when saved buyer-facing description, GST, and specification keys exist', () => {
    expect(getAdminProductApprovalReadiness(readyPendingProduct).ok).toBe(true);
  });

  it('parses string and snapshot-wrapped specifications like the backend', () => {
    expect(
      getAdminProductApprovalReadiness({
        ...readyPendingProduct,
        specifications: JSON.stringify({ Brand: '', Capacity: '' })
      }).ok
    ).toBe(true);
    expect(
      getAdminProductApprovalReadiness({
        ...readyPendingProduct,
        specifications: { snapshot: { Brand: '', Capacity: '' } }
      }).ok
    ).toBe(true);
  });

  it('fails when only stale catalog description exists without admin publish', () => {
    const result = getAdminProductApprovalReadiness({
      ...readyPendingProduct,
      publishedDescription: '',
      description: 'Stale polished catalog copy.',
      supplierDescription: 'Raw supplier submission.'
    });
    expect(result.ok).toBe(false);
    expect(result.missingRequirements.some((row) => row.id === 'description')).toBe(true);
  });

  it('passes for approved products using catalog description', () => {
    const result = getAdminProductApprovalReadiness({
      status: 'approved',
      description: 'Published buyer-facing copy.',
      supplierDescription: 'Older supplier draft.',
      hsnCode: '7323',
      igst_rate: '18',
      cgst_rate: '9',
      sgst_rate: '9',
      specifications: { Brand: 'Milton' }
    });
    expect(result.ok).toBe(true);
  });
});
