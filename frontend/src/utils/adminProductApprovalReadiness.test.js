import { describe, expect, it } from 'vitest';
import { getAdminProductApprovalReadiness } from './adminProductApprovalReadiness.js';

describe('getAdminProductApprovalReadiness', () => {
  const readyProduct = {
    description: 'Professional steel bottle for daily hydration.',
    hsnCode: '7323',
    igst_rate: '18',
    cgst_rate: '9',
    sgst_rate: '9',
    specifications: { Brand: '', 'Model Name': '' }
  };

  it('passes when description, GST, and specification keys exist', () => {
    expect(getAdminProductApprovalReadiness(readyProduct).ok).toBe(true);
  });

  it('fails when description is missing', () => {
    const result = getAdminProductApprovalReadiness({ ...readyProduct, description: '' });
    expect(result.ok).toBe(false);
    expect(result.missingRequirements.some((row) => row.id === 'description')).toBe(true);
  });
});
