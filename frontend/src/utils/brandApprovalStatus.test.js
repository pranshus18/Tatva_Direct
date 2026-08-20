import { describe, expect, it } from 'vitest';
import {
  getAddProductPrerequisiteWarning,
  getBrandApprovalWarning,
  getSupplierRoleRequiredForProductWarning,
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

  it('warns when a supply-chain role is missing', () => {
    const warning = getSupplierRoleRequiredForProductWarning('REDMI');
    expect(warning.reason).toBe('role_required');
    expect(warning.title).toBe('Supply-chain role required');
    expect(warning.message).toMatch(/REDMI/);
  });

  it('lists brand approval and supplier role together when both are outstanding', () => {
    const warning = getAddProductPrerequisiteWarning({
      status: 'pending',
      brandName: 'REDMI',
      hasSelectedRole: false
    });
    expect(warning.title).toBe('Brand approval and supplier role required');
    expect(warning.prerequisites).toHaveLength(2);
    expect(warning.prerequisites[0].ok).toBe(false);
    expect(warning.prerequisites[0].text).toMatch(/Brand approval/i);
    expect(warning.prerequisites[1].ok).toBe(false);
    expect(warning.prerequisites[1].text).toMatch(/Supplier role/i);
    expect(warning.message).toMatch(/brand approval/i);
    expect(warning.message).toMatch(/supplier role/i);
  });

  it('still mentions both prerequisites when only the supplier role is missing', () => {
    const warning = getAddProductPrerequisiteWarning({
      status: 'approved',
      brandName: 'REDMI',
      hasSelectedRole: false
    });
    expect(warning.title).toBe('Supply-chain role required');
    expect(warning.prerequisites[0].ok).toBe(true);
    expect(warning.prerequisites[0].text).toMatch(/Brand approval: complete/i);
    expect(warning.prerequisites[1].ok).toBe(false);
    expect(warning.prerequisites[1].text).toMatch(/Supplier role: required/i);
  });

  it('mentions the supplier role even when brand approval is the current blocker and role status is unknown', () => {
    const warning = getAddProductPrerequisiteWarning({
      status: 'unregistered',
      brandName: 'REDMI',
      hasSelectedRole: null
    });
    expect(warning.title).toBe('Brand approval and supplier role required');
    expect(warning.prerequisites[0].text).toMatch(/Brand approval/i);
    expect(warning.prerequisites[1].text).toMatch(/Supplier role: required/i);
  });

  it('does not show auto-merged duplicate leftovers as brand rejection', () => {
    expect(
      getBrandApprovalWarning(
        'rejected',
        'Philips',
        'Brand "Philips" was rejected: Duplicate of "Philips" — merged automatically.'
      )
    ).toBeNull();
  });

  it('hides brand rejection and duplicate messages once the product is approved', () => {
    expect(
      getBrandApprovalWarning(
        'rejected',
        'Phillips',
        'Brand "Phillips" was rejected: Duplicate of "Philips" — merged automatically.',
        'approved'
      )
    ).toBeNull();
    expect(
      getBrandApprovalWarning('pending', 'Philips', 'Brand approval pending for "Philips".', 'approved')
    ).toBeNull();
    expect(
      getBrandApprovalWarning(
        'rejected',
        'Phillips',
        'Brand "Phillips" was rejected: Duplicate of approved brand "Philips".'
      )
    ).toBeNull();
  });
});
