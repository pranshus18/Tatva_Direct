import { describe, expect, it } from 'vitest';
import {
  areBrandNamesExactDuplicates,
  findApprovedCatalogBrandMatch,
  findApprovedCatalogBrandSuggestions,
  brandKeyForDuplicateCheck
} from './supplierChainEntryValidation';
import {
  buildBrandApprovalDetailsSignature,
  buildPendingBrandRequestStatusView,
  buildSupplyChainSummaryRows,
  isBrandApprovalSaveBlockedForPendingRequests,
  resolveSelectYourselfBrandStepStatus
} from './supplierSelectYourselfProfile';
import { resolveActiveBrandPath, shouldShowApprovedBrandPathBAlert } from './supplierSelectYourselfPaths';

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
    expect(findApprovedCatalogBrandMatch('AB', [{ name: 'ABB', status: 'approved' }])).toBeNull();
    expect(findApprovedCatalogBrandMatch('samsung', catalog)?.name).toBe('samsung');
  });

  it('1a) spelling mistakes of approved brands are a new brand, not a catalog hit', () => {
    expect(findApprovedCatalogBrandMatch('samsun', catalog)).toBeNull();
    expect(
      findApprovedCatalogBrandMatch('Faststark', [{ name: 'Fastrack', status: 'approved' }])
    ).toBeNull();
    expect(findApprovedCatalogBrandMatch('Phillips', [{ name: 'Philips', status: 'approved' }])).toBeNull();
  });

  it('1b) partial typing may soft-suggest only — does not block as exact match', () => {
    const tips = findApprovedCatalogBrandSuggestions('sams', catalog);
    expect(tips.some((row) => row.name === 'samsung')).toBe(true);
    expect(findApprovedCatalogBrandMatch('sams', catalog)).toBeNull();

    const safariCatalog = [...catalog, { name: 'Safari', status: 'approved' }];
    expect(findApprovedCatalogBrandSuggestions('safa', safariCatalog).some((row) => row.name === 'Safari')).toBe(
      true
    );
    expect(findApprovedCatalogBrandMatch('safa', safariCatalog)).toBeNull();
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
    expect(areBrandNamesExactDuplicates('Philips', 'Phillips')).toBe(false);
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

  it('8) already-approved alert shows only on Path B with a configured brand', () => {
    const approved = ['samsung'];
    expect(
      shouldShowApprovedBrandPathBAlert({
        approvedBrandsBlockingSave: approved,
        hasBrandsNeedingApprovalRequest: false,
        activeBrandPath: null,
        hasConfiguredBrand: true
      })
    ).toBe(false);
    expect(
      shouldShowApprovedBrandPathBAlert({
        approvedBrandsBlockingSave: approved,
        hasBrandsNeedingApprovalRequest: false,
        activeBrandPath: 'pathA',
        hasConfiguredBrand: true
      })
    ).toBe(false);
    expect(
      shouldShowApprovedBrandPathBAlert({
        approvedBrandsBlockingSave: approved,
        hasBrandsNeedingApprovalRequest: false,
        activeBrandPath: 'pathB',
        hasConfiguredBrand: false
      })
    ).toBe(false);
    expect(
      shouldShowApprovedBrandPathBAlert({
        approvedBrandsBlockingSave: approved,
        hasBrandsNeedingApprovalRequest: false,
        activeBrandPath: 'pathB',
        hasConfiguredBrand: true
      })
    ).toBe(true);
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

  it('8) a single pending brand request is shown once as Pending Admin Approval', () => {
    const view = buildPendingBrandRequestStatusView({
      pendingBrandRequests: [{ name: 'AISHU', submittedAt: '2026-08-24T10:37:00.000Z' }],
      currentPendingBrandNames: ['AISHU']
    });
    expect(view.showSeparateStatusLine).toBe(false);
    expect(view.title).toBe('Pending Admin Approval — "AISHU"');
    expect(view.groups).toEqual([]);
    expect(`${view.title} ${view.message}`).not.toMatch(/Request already submitted/i);
  });

  it('9) a submitted brand cannot look Ready to submit or be saved again while pending', () => {
    const status = resolveSelectYourselfBrandStepStatus({
      brandName: 'samsung',
      supplierBrandRequests: [],
      extraPendingBrandNames: ['samsung']
    });
    expect(status.label).toBe('Pending Admin Approval');
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile: {
          companyInfoEntries: [{ id: '1', brands: 'samsung' }],
          supplierBrandRequests: []
        },
        extraPendingBrandNames: ['samsung'],
        submittedSignature: ''
      })
    ).toBe(true);
  });
});
