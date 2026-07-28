import { describe, expect, it } from 'vitest';
import {
  getBrandApprovalWarning,
  isBrandApprovedForProductSubmit,
  normalizeBrandApprovalStatus
} from './brandApprovalStatus';

describe('brandApprovalStatus', () => {
  it('normalizes statuses', () => {
    expect(normalizeBrandApprovalStatus('Approved')).toBe('approved');
    expect(normalizeBrandApprovalStatus('pending')).toBe('pending');
    expect(normalizeBrandApprovalStatus('')).toBe('missing');
  });

  it('only approved brands can submit products', () => {
    expect(isBrandApprovedForProductSubmit('approved')).toBe(true);
    expect(isBrandApprovedForProductSubmit('pending')).toBe(false);
    expect(isBrandApprovedForProductSubmit('unregistered')).toBe(false);
  });

  it('builds clear warning copy', () => {
    expect(getBrandApprovalWarning('pending', 'Nykaa')?.title).toBe('Brand approval pending');
    expect(getBrandApprovalWarning('unregistered', 'Nykaa')?.title).toBe('Brand approval required');
    expect(getBrandApprovalWarning('rejected', 'Nykaa')?.tone).toBe('danger');
    expect(getBrandApprovalWarning('approved', 'Nykaa')).toBeNull();
  });
});
