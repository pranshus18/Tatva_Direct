import { describe, expect, it } from 'vitest';
import {
  areBrandNamesExactDuplicates,
  findApprovedCatalogBrandMatch,
  findApprovedCatalogBrandSuggestions,
  brandKeyForDuplicateCheck
} from './supplierChainEntryValidation';
import {
  buildBrandApprovalDetailsSignature,
  buildSupplyChainSummaryRows,
  isBrandApprovalSaveBlockedForPendingRequests,
  resolveSelectYourselfBrandStepStatus
} from './supplierSelectYourselfProfile';
import { resolveActiveBrandPath } from './supplierSelectYourselfPaths';

/**
 * Contract tests for Select Yourself Path A / Path B — the five defects from this thread.
 * Keep these green so fixing one flow does not silently reopen another.
 */
describe('Select Yourself brand flow contract', () => {
  const catalog = [
    { name: 'acc', status: 'approved', hasAdminSupplyChain: true },
    { name: 'samsung', status: 'approved', hasAdminSupplyChain: true },
    { name: 'Dell', status: 'approved' }
  ];

  it('1) partial Path B typing is never an approved catalog hit', () => {
    expect(findApprovedCatalogBrandMatch('sam', catalog)).toBeNull();
    expect(findApprovedCatalogBrandMatch('samsun', catalog)).toBeNull();
    expect(findApprovedCatalogBrandMatch('AB', [{ name: 'ABB', status: 'approved' }])).toBeNull();
    expect(findApprovedCatalogBrandMatch('samsung', catalog)?.name).toBe('samsung');
  });

  it('1b) partial typing may soft-suggest only — does not block as exact match', () => {
    const tips = findApprovedCatalogBrandSuggestions('sams', catalog);
    expect(tips.some((row) => row.name === 'samsung')).toBe(true);
    expect(findApprovedCatalogBrandMatch('sams', catalog)).toBeNull();
  });

  it('2) summary row ids stay stable after the supplier selects a catalog brand (no selection loop)', () => {
    const before = buildSupplyChainSummaryRows(catalog, [], [], []);
    const after = buildSupplyChainSummaryRows(
      catalog,
      [{ id: 'entry-uuid-acc', brands: 'acc', role: '' }],
      [],
      []
    );
    const beforeAcc = before.find((row) => row.brand === 'acc');
    const afterAcc = after.find((row) => row.brand === 'acc');
    expect(beforeAcc?.id).toBe(afterAcc?.id);
    expect(beforeAcc?.id).toMatch(/^brand-/);
    expect(afterAcc?.entryId).toBe('entry-uuid-acc');
  });

  it('3) Save brand stays idle after a successful Path A save with no edits', () => {
    const profile = {
      companyInfoEntries: [{ id: '1', brands: 'acc', brandApprovalDocumentUrls: [] }]
    };
    const signature = buildBrandApprovalDetailsSignature(profile, catalog);
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands: catalog,
        submittedSignature: signature
      })
    ).toBe(true);
  });

  it('3b) Save brand stays idle when switching between approved catalog brands', () => {
    const saved = {
      companyInfoEntries: [{ id: '1', brands: 'acc', brandApprovalDocumentUrls: [] }]
    };
    const edited = {
      companyInfoEntries: [{ id: '1', brands: 'Dell', brandApprovalDocumentUrls: [] }]
    };
    const signature = buildBrandApprovalDetailsSignature(saved, catalog);
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile: edited,
        catalogBrands: catalog,
        submittedSignature: signature
      })
    ).toBe(true);
  });

  it('4) short acronyms are not collapsed into longer approved brands', () => {
    expect(areBrandNamesExactDuplicates('AB', 'ABB')).toBe(false);
    expect(brandKeyForDuplicateCheck('AB')).not.toBe(brandKeyForDuplicateCheck('ABB'));
    expect(areBrandNamesExactDuplicates('Philips', 'Phillips')).toBe(true);
  });

  it('5) Path B pending stays blocked even after document edits (no duplicate submit)', () => {
    const pending = {
      companyInfoEntries: [{ id: '1', brands: 'NOKIA', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: [{ name: 'NOKIA', status: 'pending' }]
    };
    const signature = buildBrandApprovalDetailsSignature(pending, []);
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile: pending,
        catalogBrands: [],
        submittedSignature: signature
      })
    ).toBe(true);

    const edited = {
      ...pending,
      companyInfoEntries: [
        {
          id: '1',
          brands: 'NOKIA',
          brandApprovalDocumentUrls: ['https://example.com/auth.pdf']
        }
      ]
    };
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile: edited,
        catalogBrands: [],
        submittedSignature: signature
      })
    ).toBe(true);
  });

  it('6) Path A selection hides Path B (mutual exclusion)', () => {
    // Selecting an approved brand always wins — stale Path B mode must not stay active.
    expect(
      resolveActiveBrandPath({ selectedAssignmentId: 'brand-acc', brandPathMode: 'pathB' })
    ).toBe('pathA');
    expect(
      resolveActiveBrandPath({ selectedAssignmentId: 'brand-acc', brandPathMode: null })
    ).toBe('pathA');
    expect(resolveActiveBrandPath({ selectedAssignmentId: '', brandPathMode: 'pathB' })).toBe('pathB');
    expect(resolveActiveBrandPath({ selectedAssignmentId: '', brandPathMode: 'pathA' })).toBe('pathA');
    expect(resolveActiveBrandPath({ selectedAssignmentId: '', brandPathMode: null })).toBeNull();
  });

  it('7) Brand status never shows Ready to submit after a pending or approved request', () => {
    expect(
      resolveSelectYourselfBrandStepStatus({
        brandName: 'NOKIA',
        supplierBrandRequests: [{ name: 'NOKIA', status: 'pending' }]
      }).label
    ).toBe('Pending Admin Approval');

    expect(
      resolveSelectYourselfBrandStepStatus({
        brandName: 'Haier',
        supplierBrandRequests: [{ name: 'Haier', status: 'approved' }],
        supplierApprovedBrands: [{ name: 'Haier', status: 'approved' }]
      }).label
    ).toBe('Approved by admin');
  });
});
