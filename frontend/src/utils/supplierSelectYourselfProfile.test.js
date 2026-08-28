import { describe, expect, it } from 'vitest';
import {
  buildSupplyChainFormProfile,
  buildSupplyChainSummaryRows,
  buildBrandApprovalDetailsSignature,
  buildSelectYourselfChainFormSignature,
  buildSelectYourselfChainEntryRowsSignature,
  buildSupplierChainSavePayload,
  classifyPathBBrandSaveRows,
  deduplicateCompanyInfoEntriesByBrand,
  findSupplierBrandRequest,
  isBrandApprovedForSupplyChainStep,
  isBrandApprovalSaveBlockedForPendingRequests,
  mergeCompanyInfoEntriesById,
  mergeFormStepProfile,
  matchCompanyInfoEntry,
  shouldBlockProfileSnapshotRefresh,
  mergeSupplierBrandRequestsIntoProfile,
  resolveSelectYourselfBrandStepStatus,
  reconcileBrandSubmissionNotice,
  buildPendingBrandRequestStatusView,
  shouldListBrandsInStatusAlert,
  listPendingChainRoleSubmissions,
  hasPendingChainRoleSubmissionForBrand,
  resolveChainProfileApprovalStatusForBrand,
  entryNeedsChainRoleAdminReview,
  clearSubmittedPathBBrandDrafts,
  dedupeSupplierBrandRequestsByLatest,
  reconcilePendingSupplierBrandRequests,
  preserveLocalPendingBrandRequests,
  listPendingBrandNamesBlockingSave,
  listApprovedBrandNamesBlockingSave,
  profileHasBrandsNeedingApprovalRequest,
  isSelectYourselfBrandAlreadyApproved,
  shouldShowChainProfileRejectionBanner,
  BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE,
  SUPPLY_CHAIN_NOT_DEFINED_MESSAGE
} from './supplierSelectYourselfProfile';
import { resolveRoleVerificationDocumentUrls, entryIncludesDocumentUrl } from './authorizationCertificateUrls';
import { brandKeyForDuplicateCheck } from './supplierChainEntryValidation';

describe('buildSelectYourselfChainFormSignature', () => {
  it('treats profiles as equal when only entry ids differ', () => {
    const baseline = {
      companyInfoEntries: [
        {
          id: 'entry-a',
          brands: 'Samsung',
          role: 'dealer',
          authorizationCertificateUrls: ['https://cdn.example.com/a.pdf']
        }
      ]
    };
    const current = {
      companyInfoEntries: [
        {
          id: 'entry-b',
          brands: 'Samsung',
          role: 'dealer',
          authorizationCertificateUrls: ['https://cdn.example.com/a.pdf']
        }
      ]
    };
    expect(buildSelectYourselfChainFormSignature(baseline)).toBe(
      buildSelectYourselfChainFormSignature(current)
    );
  });

  it('detects a real role change', () => {
    const saved = {
      companyInfoEntries: [{ id: '1', brands: 'Samsung', role: 'dealer' }]
    };
    const edited = {
      companyInfoEntries: [{ id: '1', brands: 'Samsung', role: 'retailer' }]
    };
    expect(buildSelectYourselfChainFormSignature(saved)).not.toBe(
      buildSelectYourselfChainFormSignature(edited)
    );
  });

  it('ignores empty placeholder rows', () => {
    const withPlaceholder = {
      companyInfoEntries: [
        { id: 'empty', brands: '', role: '' },
        { id: 'saved', brands: 'HP', role: 'dealer' }
      ]
    };
    const savedOnly = {
      companyInfoEntries: [{ id: 'saved', brands: 'HP', role: 'dealer' }]
    };
    expect(buildSelectYourselfChainFormSignature(withPlaceholder)).toBe(
      buildSelectYourselfChainFormSignature(savedOnly)
    );
  });
});

describe('classifyPathBBrandSaveRows', () => {
  it('keeps a just-submitted brand pending even if a stale approved request exists', () => {
    const rows = classifyPathBBrandSaveRows({
      brandsBeingSaved: ['srushti'],
      requestSource: [{ name: 'srushti', status: 'approved', submittedAt: '2026-07-31T08:00:00.000Z' }],
      approvalFailureRows: [
        { name: 'srushti', status: 'pending', submittedAt: '2026-07-31T09:00:00.000Z' }
      ],
      approvedCatalogKeys: new Set(),
      adminApprovedKeys: new Set([brandKeyForDuplicateCheck('srushti')]),
      brandAlreadyApproved: false,
      brandApprovalRequested: true,
      brandAlreadyPending: false
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
  });

  it('defaults missing request rows to pending, never approved', () => {
    const rows = classifyPathBBrandSaveRows({
      brandsBeingSaved: ['brand-new'],
      requestSource: [],
      approvalFailureRows: [],
      approvedCatalogKeys: new Set(),
      adminApprovedKeys: new Set(),
      brandAlreadyApproved: false,
      brandApprovalRequested: false,
      brandAlreadyPending: false
    });
    expect(rows[0].status).toBe('pending');
  });

  it('marks approved only when server confirms brandAlreadyApproved and catalog match', () => {
    const key = brandKeyForDuplicateCheck('Hp');
    const rows = classifyPathBBrandSaveRows({
      brandsBeingSaved: ['Hp'],
      requestSource: [{ name: 'Hp', status: 'approved' }],
      approvalFailureRows: [],
      approvedCatalogKeys: new Set([key]),
      adminApprovedKeys: new Set(),
      brandAlreadyApproved: true,
      brandApprovalRequested: false,
      brandAlreadyPending: false
    });
    expect(rows[0].status).toBe('approved');
  });

  it('keeps catalog-approved brands approved when a sibling brand is still pending', () => {
    const philipsKey = brandKeyForDuplicateCheck('Philips');
    const rows = classifyPathBBrandSaveRows({
      brandsBeingSaved: ['Philips', 'Prestige'],
      requestSource: [],
      approvalFailureRows: [
        { name: 'Prestige', status: 'pending', submittedAt: '2026-08-11T10:00:00.000Z' }
      ],
      approvedCatalogKeys: new Set([philipsKey]),
      adminApprovedKeys: new Set(),
      brandAlreadyApproved: false,
      brandApprovalRequested: true,
      brandAlreadyPending: false
    });
    expect(rows.find((row) => row.name === 'Philips')?.status).toBe('approved');
    expect(rows.find((row) => row.name === 'Prestige')?.status).toBe('pending');
  });
});

describe('supply-chain admin-only messaging', () => {
  it('tells suppliers to wait for admin instead of creating roles', () => {
    expect(SUPPLY_CHAIN_NOT_DEFINED_MESSAGE).toMatch(/contact Admin/i);
    expect(SUPPLY_CHAIN_NOT_DEFINED_MESSAGE).not.toMatch(/create/i);
  });
});

describe('findSupplierBrandRequest', () => {
  it('returns pending request with submitted date for matching brand', () => {
    const request = findSupplierBrandRequest('Haier', [
      {
        name: 'Haier',
        status: 'pending',
        requestedAt: '2026-07-28T10:15:00.000Z',
        submittedAt: '2026-07-28T10:15:00.000Z'
      }
    ]);
    expect(request).toEqual({
      name: 'Haier',
      status: 'pending',
      requestedAt: '2026-07-28T10:15:00.000Z',
      submittedAt: '2026-07-28T10:15:00.000Z',
      createdAt: null,
      updatedAt: null,
      rejectionReason: ''
    });
  });

  it('returns null when brand has not been submitted', () => {
    expect(findSupplierBrandRequest('Haier', [{ name: 'HP', status: 'pending' }])).toBeNull();
  });

  it('falls back to createdAt when submittedAt is missing', () => {
    const request = findSupplierBrandRequest('Bosch', [
      {
        name: 'Bosch',
        status: 'pending',
        createdAt: '2026-07-28T09:00:00.000Z'
      }
    ]);
    expect(request?.submittedAt).toBe('2026-07-28T09:00:00.000Z');
    expect(request?.requestedAt).toBe('2026-07-28T09:00:00.000Z');
  });

  it('prefers the latest row when stale pending and newer rejected both exist', () => {
    const match = findSupplierBrandRequest('APPI', [
      { name: 'APPI', status: 'pending', updatedAt: '2026-08-24T10:00:00.000Z' },
      {
        name: 'APPI',
        status: 'rejected',
        rejectionReason: 'Invalid brand',
        updatedAt: '2026-08-24T11:00:00.000Z'
      }
    ]);
    expect(match?.status).toBe('rejected');
    expect(match?.rejectionReason).toBe('Invalid brand');
  });
});

describe('preserveLocalPendingBrandRequests', () => {
  it('keeps a pending request that a profile refresh omitted', () => {
    const previous = {
      supplierBrandRequests: [
        { name: 'samsung', status: 'pending', submittedAt: '2026-07-28T11:29:53.000Z' }
      ]
    };
    const next = preserveLocalPendingBrandRequests({ supplierBrandRequests: [] }, previous);
    expect(findSupplierBrandRequest('samsung', next.supplierBrandRequests)?.status).toBe('pending');
  });

  it('does not restore pending when the refresh already has approved or rejected', () => {
    const previous = {
      supplierBrandRequests: [{ name: 'samsung', status: 'pending' }]
    };
    const approved = preserveLocalPendingBrandRequests(
      { supplierBrandRequests: [{ name: 'samsung', status: 'approved' }] },
      previous
    );
    expect(findSupplierBrandRequest('samsung', approved.supplierBrandRequests)?.status).toBe('approved');

    const rejected = preserveLocalPendingBrandRequests(
      { supplierBrandRequests: [{ name: 'samsung', status: 'rejected' }] },
      previous
    );
    expect(findSupplierBrandRequest('samsung', rejected.supplierBrandRequests)?.status).toBe('rejected');
  });
});

describe('mergeSupplierBrandRequestsIntoProfile', () => {
  it('adds pending requests so Brand status can show submitted state', () => {
    const next = mergeSupplierBrandRequestsIntoProfile(
      { supplierBrandRequests: [] },
      [{ name: 'samsung', status: 'pending', submittedAt: '2026-07-28T11:00:00.000Z' }]
    );
    expect(findSupplierBrandRequest('samsung', next.supplierBrandRequests)?.status).toBe('pending');
    expect(findSupplierBrandRequest('samsung', next.supplierBrandRequests)?.submittedAt).toBe(
      '2026-07-28T11:00:00.000Z'
    );
  });

  it('does not downgrade an approved request to pending', () => {
    const next = mergeSupplierBrandRequestsIntoProfile(
      {
        supplierBrandRequests: [
          { name: 'Samsung', status: 'approved', submittedAt: '2026-07-01T00:00:00.000Z' }
        ]
      },
      [{ name: 'samsung', status: 'pending', submittedAt: '2026-07-28T11:00:00.000Z' }]
    );
    expect(findSupplierBrandRequest('Samsung', next.supplierBrandRequests)?.status).toBe('approved');
  });
});

describe('resolveSelectYourselfBrandStepStatus', () => {
  it('shows Ready to submit only when there is no request and no approved access', () => {
    const status = resolveSelectYourselfBrandStepStatus({
      brandName: 'NOKIA',
      catalogBrandNames: [],
      supplierBrandRequests: [],
      supplierApprovedBrands: []
    });
    expect(status.label).toBe('Ready to submit for approval');
    expect(status.tone).toBe('neutral');
  });

  it('after Path B submit, pending request wins over Ready to submit', () => {
    const status = resolveSelectYourselfBrandStepStatus({
      brandName: 'NOKIA',
      catalogBrandNames: [],
      supplierBrandRequests: [
        { name: 'NOKIA', status: 'pending', submittedAt: '2026-07-30T10:00:00.000Z' }
      ],
      supplierApprovedBrands: []
    });
    expect(status.label).toBe('Pending Admin Approval');
    expect(status.tone).toBe('warning');
    expect(status.detailLines.some((line) => /Submitted:/i.test(line))).toBe(true);
    expect(status.label).not.toBe('Ready to submit for approval');
    expect(status.label).not.toBe('Approved by admin');
  });

  it('treats a just-submitted notice as pending even if profile requests are still empty', () => {
    const status = resolveSelectYourselfBrandStepStatus({
      brandName: 'samsung',
      catalogBrandNames: [],
      supplierBrandRequests: [],
      supplierApprovedBrands: [],
      extraPendingBrandNames: ['samsung']
    });
    expect(status.label).toBe('Pending Admin Approval');
    expect(status.tone).toBe('warning');
    expect(status.label).not.toBe('Ready to submit for approval');
  });

  it('already-approved save outcome never stays on Ready to submit', () => {
    const status = resolveSelectYourselfBrandStepStatus({
      brandName: 'Haier',
      catalogBrandNames: [],
      supplierBrandRequests: [
        { name: 'Haier', status: 'approved', submittedAt: '2026-07-30T10:00:00.000Z' }
      ],
      supplierApprovedBrands: [{ name: 'Haier', status: 'approved' }]
    });
    expect(status.label).toBe('Approved by admin');
    expect(status.tone).toBe('success');
    expect(status.label).not.toBe('Ready to submit for approval');
  });

  it('pending request wins even if a soft catalog match message is present', () => {
    const status = resolveSelectYourselfBrandStepStatus({
      brandName: 'Samsun',
      catalogBrandNames: ['samsung'],
      supplierBrandRequests: [{ name: 'Samsun', status: 'pending' }],
      supplierApprovedBrands: [],
      approvedCatalogMatchMessage: '"Samsun" looks like approved brand "samsung".'
    });
    expect(status.label).toBe('Pending Admin Approval');
  });

  it('approved Layer 2 access beats a stale pending request row after Admin approval', () => {
    const status = resolveSelectYourselfBrandStepStatus({
      brandName: 'NOKIA',
      catalogBrandNames: ['NOKIA'],
      catalogBrands: [{ name: 'NOKIA', status: 'approved' }],
      supplierBrandRequests: [
        { name: 'NOKIA', status: 'pending', submittedAt: '2026-07-30T10:00:00.000Z' }
      ],
      supplierApprovedBrands: [{ name: 'NOKIA', status: 'approved' }]
    });
    expect(status.label).toBe('Approved by admin');
    expect(status.tone).toBe('success');
  });
});

describe('reconcileBrandSubmissionNotice', () => {
  it('upgrades a pending banner to approved when profile request is approved', () => {
    const notice = {
      tone: 'pending',
      title: 'Brand request submitted for "NOKIA"',
      brands: [{ name: 'NOKIA', status: 'pending', submittedAt: '2026-07-30T10:00:00.000Z' }],
      submittedAt: '2026-07-30T10:00:00.000Z',
      message: 'waiting'
    };
    const next = reconcileBrandSubmissionNotice(notice, {
      profile: {
        supplierBrandRequests: [{ name: 'NOKIA', status: 'approved', submittedAt: '2026-07-30T10:00:00.000Z' }],
        adminApprovedBrands: [{ name: 'NOKIA', status: 'approved' }]
      },
      catalogBrands: [{ name: 'NOKIA', status: 'approved' }],
      supplierApprovedBrands: [{ name: 'NOKIA', status: 'approved' }]
    });
    expect(next).not.toBe(notice);
    expect(next.tone).toBe('success');
    expect(next.brands[0].status).toBe('approved');
  });

  it('upgrades mixed pending notices when some brands are already in the catalog', () => {
    const notice = {
      tone: 'pending',
      title: '8 brand requests submitted',
      brands: [
        { name: 'Philips', status: 'pending' },
        { name: 'Prestige', status: 'pending' },
        { name: 'Safari', status: 'pending' }
      ],
      message: 'waiting'
    };
    const next = reconcileBrandSubmissionNotice(notice, {
      profile: {
        supplierBrandRequests: [
          { name: 'Philips', status: 'pending' },
          { name: 'Prestige', status: 'pending' },
          { name: 'Safari', status: 'pending' }
        ]
      },
      catalogBrands: [
        { name: 'Philips', status: 'approved' },
        { name: 'Safari', status: 'approved' }
      ],
      supplierApprovedBrands: []
    });
    expect(next).not.toBe(notice);
    expect(next.tone).toBe('pending');
    expect(next.brands.map((row) => row.name)).toEqual(['Prestige']);
  });

  it('keeps the pending banner when the request is still pending and not in catalog', () => {
    const notice = {
      tone: 'pending',
      title: 'Brand request submitted for "NOKIA"',
      brands: [{ name: 'NOKIA', status: 'pending' }],
      message: 'waiting'
    };
    const next = reconcileBrandSubmissionNotice(notice, {
      profile: {
        supplierBrandRequests: [{ name: 'NOKIA', status: 'pending' }]
      },
      catalogBrands: [],
      supplierApprovedBrands: []
    });
    expect(next).toBe(notice);
  });

  it('drops the pending banner when admin rejected the request', () => {
    const notice = {
      tone: 'pending',
      title: 'Brand request submitted for "APPI"',
      brands: [{ name: 'APPI', status: 'pending', submittedAt: '2026-08-24T10:00:00.000Z' }],
      message: 'waiting'
    };
    const next = reconcileBrandSubmissionNotice(notice, {
      profile: {
        supplierBrandRequests: [
          {
            name: 'APPI',
            status: 'rejected',
            rejectionReason: 'Not a valid brand',
            updatedAt: '2026-08-24T11:00:00.000Z'
          }
        ]
      },
      catalogBrands: [],
      supplierApprovedBrands: []
    });
    expect(next).toBeNull();
  });
});

describe('buildPendingBrandRequestStatusView', () => {
  it('shows a single pending request once as Pending Admin Approval', () => {
    const view = buildPendingBrandRequestStatusView({
      pendingBrandRequests: [
        { name: 'AISHU', submittedAt: '2026-08-24T10:37:00.000Z' }
      ],
      currentPendingBrandNames: ['AISHU']
    });

    expect(view.showAlert).toBe(true);
    expect(view.showSeparateStatusLine).toBe(false);
    expect(view.title).toBe('Pending Admin Approval — "AISHU"');
    expect(view.submittedAt).toBe('2026-08-24T10:37:00.000Z');
    expect(view.groups).toEqual([]);
    expect(view.title).not.toMatch(/Request already submitted/i);
  });

  it('collapses duplicate rows for the same brand into one pending status', () => {
    const view = buildPendingBrandRequestStatusView({
      pendingBrandRequests: [
        { name: 'AISHU', submittedAt: '2026-08-24T10:37:00.000Z' },
        { name: 'aishu', submittedAt: '2026-08-24T10:37:00.000Z' }
      ]
    });

    expect(view.title).toBe('Pending Admin Approval — "AISHU"');
    expect(view.groups).toEqual([]);
    expect(view.showSeparateStatusLine).toBe(false);
  });

  it('groups other pending requests without repeating a separate already-submitted line', () => {
    const view = buildPendingBrandRequestStatusView({
      pendingBrandRequests: [
        { name: 'AISHU', submittedAt: '2026-08-19T00:00:00.000Z' },
        { name: 'Aishwarya', submittedAt: '2026-08-10T00:00:00.000Z' },
        { name: 'H', submittedAt: '2026-08-03T00:00:00.000Z' }
      ],
      currentPendingBrandNames: ['H']
    });

    expect(view.showSeparateStatusLine).toBe(false);
    expect(view.title).toBe('3 brand requests pending admin approval');
    expect(view.groups).toHaveLength(2);
    expect(view.groups[0].heading).toBe('Already submitted request');
    expect(view.groups[0].rows.map((row) => row.name)).toEqual(['H']);
    expect(view.groups[1].heading).toBe('Other pending requests');
    expect(view.groups[1].rows.map((row) => row.name)).toEqual(['AISHU', 'Aishwarya']);
  });

  it('does not list brands again when the alert title already names the only request', () => {
    expect(shouldListBrandsInStatusAlert([{ name: 'AISHU' }])).toBe(false);
    expect(shouldListBrandsInStatusAlert([{ name: 'AISHU' }, { name: 'H' }])).toBe(true);
  });
});

describe('reconcilePendingSupplierBrandRequests', () => {
  it('flips pending request rows to approved when the brand is in the approved catalog', () => {
    const profile = {
      supplierBrandRequests: [{ name: 'NOKIA', status: 'pending', submittedAt: '2026-07-30T10:00:00.000Z' }],
      adminApprovedBrands: []
    };
    const next = reconcilePendingSupplierBrandRequests(profile, {
      catalogBrands: [{ name: 'NOKIA', status: 'approved' }],
      supplierApprovedBrands: [{ name: 'NOKIA', status: 'approved' }]
    });
    expect(next).not.toBe(profile);
    expect(findSupplierBrandRequest('NOKIA', next.supplierBrandRequests)?.status).toBe('approved');
  });
});

describe('isBrandApprovedForSupplyChainStep', () => {
  it('treats supplierApprovedBrands as approved even when brandMeta is still pending', () => {
    expect(
      isBrandApprovedForSupplyChainStep(
        'samsung',
        [{ name: 'samsung', status: 'approved' }],
        { status: 'pending', brand: 'samsung' },
        [{ name: 'samsung', status: 'pending' }]
      )
    ).toBe(true);
  });

  it('does not let duplicate-of-approved rejection block the canonical brand', () => {
    expect(
      isBrandApprovedForSupplyChainStep(
        'Samsung',
        [{ name: 'Samsung', status: 'approved' }],
        { status: 'approved', brand: 'Samsung' },
        [
          {
            name: 'samsung',
            status: 'rejected',
            rejectionReason: 'Duplicate of approved brand "Samsung".'
          }
        ]
      )
    ).toBe(true);
  });

  it('still blocks genuinely rejected brands', () => {
    expect(
      isBrandApprovedForSupplyChainStep(
        'MysteryBrand',
        [],
        { status: 'rejected' },
        [{ name: 'MysteryBrand', status: 'rejected', rejectionReason: 'Incomplete documents' }]
      )
    ).toBe(false);
  });
});

describe('isBrandApprovalSaveBlockedForPendingRequests', () => {
  it('blocks Save brand when the pending request details are unchanged', () => {
    const profile = {
      companyInfoEntries: [{ id: '1', brands: 'samsung', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: [{ name: 'samsung', status: 'pending' }]
    };
    const signature = buildBrandApprovalDetailsSignature(profile, []);
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands: [],
        submittedSignature: signature
      })
    ).toBe(true);
  });

  it('blocks duplicate Save brand even after document edits while request is pending', () => {
    const submitted = {
      companyInfoEntries: [{ id: '1', brands: 'samsung', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: [{ name: 'samsung', status: 'pending' }]
    };
    const edited = {
      ...submitted,
      companyInfoEntries: [
        {
          id: '1',
          brands: 'samsung',
          brandApprovalDocumentUrls: ['https://example.com/doc.pdf']
        }
      ]
    };
    const signature = buildBrandApprovalDetailsSignature(submitted, []);
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile: edited,
        catalogBrands: [],
        submittedSignature: signature
      })
    ).toBe(true);
    expect(
      listPendingBrandNamesBlockingSave({ profile: edited })
    ).toEqual(['samsung']);
  });

  it('blocks Save brand for pending request even without a stored signature', () => {
    const profile = {
      companyInfoEntries: [{ id: '1', brands: 'NOKIA', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: [{ name: 'NOKIA', status: 'pending' }]
    };
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands: [],
        submittedSignature: ''
      })
    ).toBe(true);
  });

  it('blocks duplicate Save brand from a pending notice even when request rows are missing', () => {
    const profile = {
      companyInfoEntries: [{ id: '1', brands: 'samsung', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: []
    };
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands: [],
        extraPendingBrandNames: ['samsung'],
        submittedSignature: ''
      })
    ).toBe(true);
    expect(
      listPendingBrandNamesBlockingSave({
        profile,
        extraPendingBrandNames: ['samsung']
      })
    ).toEqual(['samsung']);
  });

  it('blocks Save brand after a successful Path A save with no further edits', () => {
    const catalog = [{ name: 'acc', status: 'approved' }];
    const profile = {
      companyInfoEntries: [{ id: '1', brands: 'acc', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: []
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

  it('blocks Save brand when there is no brand configured', () => {
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile: { companyInfoEntries: [{ id: '1', brands: '' }] },
        catalogBrands: [],
        submittedSignature: ''
      })
    ).toBe(true);
  });

  it('blocks Save brand when a catalog brand is already approved (Path B must not re-submit)', () => {
    const catalog = [{ name: 'HP', status: 'approved' }];
    const profile = {
      companyInfoEntries: [{ id: '1', brands: 'Hp', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: []
    };
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands: catalog,
        submittedSignature: ''
      })
    ).toBe(true);
    expect(
      listApprovedBrandNamesBlockingSave({ profile, catalogBrands: catalog })
    ).toEqual(['Hp']);
  });

  it('blocks Save brand when brand is approved via supplierApprovedBrands even if catalog prop is empty', () => {
    const profile = {
      companyInfoEntries: [{ id: '1', brands: 'Hp', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: []
    };
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands: [],
        supplierApprovedBrands: [{ name: 'Hp', status: 'approved' }],
        submittedSignature: ''
      })
    ).toBe(true);
    expect(
      listApprovedBrandNamesBlockingSave({
        profile,
        catalogBrands: [],
        supplierApprovedBrands: [{ name: 'HP', status: 'approved' }]
      })
    ).toEqual(['Hp']);
  });

  it('blocks Save brand when request status is already approved', () => {
    const profile = {
      companyInfoEntries: [{ id: '1', brands: 'Haier', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: [{ name: 'Haier', status: 'approved' }]
    };
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands: [],
        submittedSignature: ''
      })
    ).toBe(true);
  });

  it('isSelectYourselfBrandAlreadyApproved matches catalog and supplier access checks', () => {
    const catalog = [{ name: 'HP', status: 'approved' }];
    expect(isSelectYourselfBrandAlreadyApproved('Hp', { catalogBrands: catalog })).toBe(true);
    expect(isSelectYourselfBrandAlreadyApproved('FreshBrand', { catalogBrands: catalog })).toBe(false);
    expect(
      isSelectYourselfBrandAlreadyApproved('Hp', {
        catalogBrands: [],
        supplierApprovedBrands: [{ name: 'HP', status: 'approved' }]
      })
    ).toBe(true);
  });

  it('re-enables Save brand when switching to a different new brand name', () => {
    const profile = {
      companyInfoEntries: [{ id: '1', brands: 'FreshBrand', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: [{ name: 'samsung', status: 'pending' }]
    };
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands: [],
        submittedSignature: 'old-signature'
      })
    ).toBe(false);
  });

  it('re-enables Save brand when the request was rejected', () => {
    const profile = {
      companyInfoEntries: [{ id: '1', brands: 'samsung', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: [{ name: 'samsung', status: 'rejected' }]
    };
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands: [],
        submittedSignature: ''
      })
    ).toBe(false);
  });

  it('does not block Save brand for a longer distinct name when a shorter approved brand exists', () => {
    const catalog = [{ name: 'pran', status: 'approved' }];
    const profile = {
      companyInfoEntries: [{ id: '1', brands: 'pransh', brandApprovalDocumentUrls: [] }],
      supplierBrandRequests: []
    };
    expect(
      isBrandApprovalSaveBlockedForPendingRequests({
        profile,
        catalogBrands: catalog,
        submittedSignature: ''
      })
    ).toBe(false);
    expect(
      listApprovedBrandNamesBlockingSave({ profile, catalogBrands: catalog })
    ).toEqual([]);
  });

  it('still allows brand approval request when one entry is approved and another is new', () => {
    const catalog = [{ name: 'acc', status: 'approved' }];
    const profile = {
      companyInfoEntries: [
        { id: '1', brands: 'acc', brandApprovalDocumentUrls: [] },
        { id: '2', brands: 'Milton', brandApprovalDocumentUrls: ['https://cdn.example.com/doc.png'] }
      ],
      supplierBrandRequests: []
    };
    expect(
      profileHasBrandsNeedingApprovalRequest({ profile, catalogBrands: catalog, submittedSignature: '' })
    ).toBe(true);
    expect(
      listApprovedBrandNamesBlockingSave({ profile, catalogBrands: catalog })
    ).toEqual(['acc']);
  });

  it('blocks Save brand when switching between already-approved catalog brands', () => {
    const catalog = [
      { name: 'acc', status: 'approved' },
      { name: 'Dell', status: 'approved' }
    ];
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
});

describe('buildSupplyChainFormProfile', () => {
  it('keeps a draft role when approved baseline role is empty', () => {
    const entryId = 'entry-samsung';
    const profile = {
      companyInfoEntries: [
        {
          id: entryId,
          brands: 'Samsung',
          role: 'retailer',
          authorizationCertificateUrls: []
        }
      ]
    };
    const baselineEntries = [
      {
        id: entryId,
        brands: 'Samsung',
        role: ''
      }
    ];

    const formProfile = buildSupplyChainFormProfile(profile, baselineEntries);
    expect(formProfile.companyInfoEntries).toHaveLength(1);
    expect(formProfile.companyInfoEntries[0].role).toBe('retailer');
  });

  it('prefers draft role change over previously approved role', () => {
    const entryId = 'entry-philips';
    const profile = {
      companyInfoEntries: [
        {
          id: entryId,
          brands: 'Philips',
          role: 'retailer'
        }
      ]
    };
    const baselineEntries = [
      {
        id: entryId,
        brands: 'Philips',
        role: 'dealer'
      }
    ];

    const formProfile = buildSupplyChainFormProfile(profile, baselineEntries);
    expect(formProfile.companyInfoEntries[0].role).toBe('retailer');
  });

  it('does not show Step 1 brand documents in Step 2 role document fields', () => {
    const brandDoc = 'https://example.com/fossil-brand.png';
    const profile = {
      companyInfoEntries: [
        {
          id: 'entry-fossil',
          brands: 'Fossil',
          role: '',
          brandApprovalDocumentUrls: [brandDoc],
          brandApprovalDocumentUrl: brandDoc,
          authorizationCertificateUrls: [brandDoc],
          authorizationCertificateUrl: brandDoc
        }
      ]
    };

    const formProfile = buildSupplyChainFormProfile(profile, []);
    const entry = formProfile.companyInfoEntries[0];
    expect(resolveRoleVerificationDocumentUrls(entry)).toEqual([]);
    expect(entry.authorizationCertificateUrls).toEqual([]);
    expect(entry.authorizationCertificateUrl).toBe('');
  });

  it('hides legacy brand-approval storage URLs from Step 2 role documents', () => {
    const legacyBrandDoc =
      'https://cdn.example.com/user-1/brand-approval-documents/1234567890-fossil.png';
    const entry = {
      brands: 'Fossil',
      authorizationCertificateUrls: [legacyBrandDoc],
      authorizationCertificateUrl: legacyBrandDoc
    };

    expect(resolveRoleVerificationDocumentUrls(entry)).toEqual([]);
  });

  it('does not restore approved role documents after the current row removed them', () => {
    const formProfile = buildSupplyChainFormProfile(
      {
        companyInfoEntries: [
          {
            id: 'draft',
            brands: 'Samsung',
            role: 'dealer',
            authorizationCertificateUrls: []
          }
        ]
      },
      [
        {
          id: 'approved',
          brands: 'Samsung',
          role: 'dealer',
          authorizationCertificateUrls: ['https://cdn.example.com/old.pdf']
        }
      ]
    );

    expect(formProfile.companyInfoEntries).toHaveLength(1);
    expect(formProfile.companyInfoEntries[0].authorizationCertificateUrls).toEqual([]);
  });
});

describe('buildSelectYourselfChainEntryRowsSignature', () => {
  it('detects a newly added blank Path B row that the semantic signature ignores', () => {
    const saved = {
      companyInfoEntries: [{ id: 'entry-1', brands: 'Acc', role: 'dealer' }]
    };
    const withBlankRow = {
      companyInfoEntries: [
        { id: 'entry-1', brands: 'Acc', role: 'dealer' },
        { id: 'entry-2', brands: '', role: '' }
      ]
    };

    expect(buildSelectYourselfChainFormSignature(withBlankRow)).toBe(
      buildSelectYourselfChainFormSignature(saved)
    );
    expect(buildSelectYourselfChainEntryRowsSignature(withBlankRow)).not.toBe(
      buildSelectYourselfChainEntryRowsSignature(saved)
    );
  });

  it('stays stable when nothing structural changed', () => {
    const profile = { companyInfoEntries: [{ id: 'entry-1', brands: 'Acc', role: 'dealer' }] };
    expect(buildSelectYourselfChainEntryRowsSignature(profile)).toBe(
      buildSelectYourselfChainEntryRowsSignature({
        companyInfoEntries: [{ id: 'entry-1', brands: 'Acc', role: 'retailer' }]
      })
    );
  });
});

describe('entryIncludesDocumentUrl', () => {
  it('detects role and brand documents on an entry', () => {
    const roleDoc = 'https://cdn.example.com/role.pdf';
    const brandDoc = 'https://cdn.example.com/brand.pdf';
    const entry = {
      authorizationCertificateUrls: [roleDoc],
      brandApprovalDocumentUrls: [brandDoc]
    };
    expect(entryIncludesDocumentUrl(entry, roleDoc, 'role_authorization')).toBe(true);
    expect(entryIncludesDocumentUrl(entry, brandDoc, 'brand_approval')).toBe(true);
    expect(entryIncludesDocumentUrl(entry, brandDoc, 'role_authorization')).toBe(false);
  });
});

describe('shouldBlockProfileSnapshotRefresh', () => {
  it('blocks when local drafts exist or a protection window is active', () => {
    expect(
      shouldBlockProfileSnapshotRefresh({
        hasUnsavedChanges: true,
        blockUntilMs: 0,
        now: 1000
      })
    ).toBe(true);
    expect(
      shouldBlockProfileSnapshotRefresh({
        hasUnsavedChanges: false,
        blockUntilMs: 2000,
        now: 1000
      })
    ).toBe(true);
    expect(
      shouldBlockProfileSnapshotRefresh({
        hasUnsavedChanges: false,
        blockUntilMs: 500,
        now: 1000
      })
    ).toBe(false);
  });
});

describe('mergeFormStepProfile', () => {
  it('keeps an existing draft role when a stale form snapshot only adds documents', () => {
    const fullProfile = {
      companyInfoEntries: [
        {
          id: 'entry-1',
          brands: 'Samsung',
          role: 'dealer',
          authorizationCertificateUrls: [],
          supplyChainRegistrationStarted: true
        }
      ]
    };
    const staleFormProfile = {
      companyInfoEntries: [
        {
          id: 'entry-1',
          brands: 'Samsung',
          role: '',
          authorizationCertificateUrls: ['https://cdn.example.com/role-doc.pdf'],
          supplyChainRegistrationStarted: true
        }
      ]
    };

    const merged = mergeFormStepProfile(fullProfile, staleFormProfile);
    expect(merged.companyInfoEntries[0].role).toBe('dealer');
    expect(merged.companyInfoEntries[0].authorizationCertificateUrls).toEqual([
      'https://cdn.example.com/role-doc.pdf'
    ]);
  });

  it('keeps the newer form role when both sides have values', () => {
    const fullProfile = {
      companyInfoEntries: [{ id: 'entry-1', brands: 'Samsung', role: 'dealer' }]
    };
    const formProfile = {
      companyInfoEntries: [{ id: 'entry-1', brands: 'Samsung', role: 'retailer' }]
    };

    const merged = mergeFormStepProfile(fullProfile, formProfile);
    expect(merged.companyInfoEntries[0].role).toBe('retailer');
  });

  it('keeps a document removal from a stamped form snapshot', () => {
    const kept = 'https://cdn.example.com/keep.pdf';
    const removed = 'https://cdn.example.com/remove.pdf';
    const fullProfile = {
      companyInfoEntries: [
        {
          id: 'entry-1',
          brands: 'Samsung',
          role: 'dealer',
          authorizationCertificateUrls: [kept, removed]
        }
      ]
    };
    const formProfile = {
      companyInfoEntries: [
        {
          id: 'entry-1',
          brands: 'Samsung',
          role: 'dealer',
          authorizationCertificateUrls: [kept],
          roleDocsUpdatedAt: 2
        }
      ]
    };

    const merged = mergeFormStepProfile(fullProfile, formProfile);
    expect(merged.companyInfoEntries[0].authorizationCertificateUrls).toEqual([kept]);
  });

  it('keeps an empty list when the last role document is removed', () => {
    const fullProfile = {
      companyInfoEntries: [
        {
          id: 'entry-1',
          brands: 'Samsung',
          role: 'dealer',
          authorizationCertificateUrls: ['https://cdn.example.com/only.pdf']
        }
      ]
    };
    const formProfile = {
      companyInfoEntries: [
        {
          id: 'entry-1',
          brands: 'Samsung',
          role: 'dealer',
          authorizationCertificateUrls: [],
          roleDocsUpdatedAt: 5
        }
      ]
    };

    const merged = mergeFormStepProfile(fullProfile, formProfile);
    expect(merged.companyInfoEntries[0].authorizationCertificateUrls).toEqual([]);
    expect(merged.companyInfoEntries[0].authorizationCertificateUrl).toBe('');
  });

  it('does not restore removed documents from a stale unstamped form snapshot', () => {
    const fullProfile = {
      companyInfoEntries: [
        {
          id: 'entry-1',
          brands: 'Samsung',
          role: 'dealer',
          authorizationCertificateUrls: [],
          roleDocsUpdatedAt: 10
        }
      ]
    };
    const staleFormProfile = {
      companyInfoEntries: [
        {
          id: 'entry-1',
          brands: 'Samsung',
          role: 'dealer',
          authorizationCertificateUrls: ['https://cdn.example.com/old.pdf']
        }
      ]
    };

    const merged = mergeFormStepProfile(fullProfile, staleFormProfile);
    expect(merged.companyInfoEntries[0].authorizationCertificateUrls).toEqual([]);
  });
});

describe('deduplicateCompanyInfoEntriesByBrand', () => {
  it('strips brand approval docs from role fields after merge', () => {
    const brandDoc = 'https://example.com/fossil-brand.png';
    const merged = deduplicateCompanyInfoEntriesByBrand([
      {
        id: 'baseline',
        brands: 'Fossil',
        authorizationCertificateUrl: brandDoc,
        authorizationCertificateUrls: []
      },
      {
        id: 'draft',
        brands: 'Fossil',
        brandApprovalDocumentUrls: [brandDoc],
        brandApprovalDocumentUrl: brandDoc
      }
    ]);

    expect(merged).toHaveLength(1);
    expect(resolveRoleVerificationDocumentUrls(merged[0])).toEqual([]);
  });

  it('lets a later empty document list replace earlier brand-row documents', () => {
    const merged = deduplicateCompanyInfoEntriesByBrand([
      {
        id: 'approved',
        brands: 'Samsung',
        authorizationCertificateUrls: ['https://cdn.example.com/old.pdf']
      },
      {
        id: 'draft',
        brands: 'Samsung',
        authorizationCertificateUrls: []
      }
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].authorizationCertificateUrls).toEqual([]);
  });
});

describe('isBrandApprovedForSupplyChainStep', () => {
  it('returns false for pending brand status from API meta', () => {
    expect(
      isBrandApprovedForSupplyChainStep('Titan', [], { status: 'pending', brand: 'Titan' })
    ).toBe(false);
  });

  it('returns true when API meta status is approved', () => {
    expect(
      isBrandApprovedForSupplyChainStep('Fossil', [], { status: 'approved', brand: 'Fossil' })
    ).toBe(true);
  });

  it('returns false when brand request was rejected by admin', () => {
    expect(
      isBrandApprovedForSupplyChainStep(
        'Sonata',
        [{ name: 'Sonata', status: 'approved' }],
        { status: 'approved', brand: 'Sonata' },
        [{ name: 'Sonata', status: 'rejected' }]
      )
    ).toBe(false);
  });

  it('returns true when brand is in supplier adminApprovedBrands', () => {
    expect(
      isBrandApprovedForSupplyChainStep('Titan', [{ name: 'Titan', status: 'approved' }], {
        status: 'missing'
      })
    ).toBe(true);
  });
});

describe('buildSupplyChainSummaryRows', () => {
  it('shows draft role in summary instead of empty approved role', () => {
    const rows = buildSupplyChainSummaryRows(
      [{ name: 'Samsung', status: 'approved', hasAdminSupplyChain: true }],
      [{ id: 'e1', brands: 'Samsung', role: 'retailer' }],
      [{ id: 'e1', brands: 'Samsung', role: '' }],
      [{ name: 'Samsung', status: 'approved' }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('retailer');
    expect(rows[0].roleLabel).toBe('Retailer');
  });

  it('keeps a stable brand-* row id before and after the supplier selects the catalog brand', () => {
    const before = buildSupplyChainSummaryRows(
      [{ name: 'Samsung', status: 'approved', hasAdminSupplyChain: true }],
      [],
      [],
      []
    );
    const after = buildSupplyChainSummaryRows(
      [{ name: 'Samsung', status: 'approved', hasAdminSupplyChain: true }],
      [{ id: 'entry-uuid-1', brands: 'Samsung', role: '' }],
      [],
      []
    );

    expect(before[0].id).toBe(after[0].id);
    expect(before[0].id).toMatch(/^brand-/);
    expect(after[0].entryId).toBe('entry-uuid-1');
  });

  it('shows all admin-approved catalog brands, not only chain-ready ones', () => {
    const rows = buildSupplyChainSummaryRows(
      [
        { name: 'Titan', status: 'approved' },
        { name: 'Fossil', status: 'approved', hasAdminSupplyChain: true },
        { name: 'hp', status: 'approved' }
      ],
      [{ id: 'e1', brands: 'Titan', role: '' }],
      [],
      []
    );

    expect(rows.map((row) => row.brand).sort()).toEqual(['Fossil', 'Titan', 'hp']);
    expect(rows.find((row) => row.brand === 'Fossil')?.hasAdminSupplyChain).toBe(true);
    expect(rows.find((row) => row.brand === 'hp')?.hasAdminSupplyChain).toBe(false);
  });

  it('lists every approved catalog brand even when none are selected and some lack a supply chain', () => {
    const rows = buildSupplyChainSummaryRows(
      [
        { name: 'Titan', status: 'approved' },
        { name: 'Fossil', status: 'approved', hasAdminSupplyChain: true },
        { name: 'hp', status: 'approved' }
      ],
      [],
      [],
      []
    );

    expect(rows.map((row) => row.brand).sort()).toEqual(['Fossil', 'Titan', 'hp']);
  });

  it('shows supplier-approved brands even without admin supply chain', () => {
    const rows = buildSupplyChainSummaryRows(
      [{ name: 'Titan', status: 'approved' }],
      [{ id: 'e1', brands: 'Titan', role: '' }],
      [],
      [{ name: 'Titan', status: 'approved' }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].brand).toBe('Titan');
  });

  it('still shows catalog-approved selected brands when a stale pending approved-list row exists', () => {
    const rows = buildSupplyChainSummaryRows(
      [{ name: 'Titan', status: 'approved' }],
      [{ id: 'e1', brands: 'Titan', role: '' }],
      [],
      [{ name: 'Titan', status: 'pending' }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].brand).toBe('Titan');
  });

  it('hides brands that only appear as pending and are not catalog-approved', () => {
    const rows = buildSupplyChainSummaryRows(
      [],
      [{ id: 'e1', brands: 'NewCo', role: '' }],
      [],
      [{ name: 'NewCo', status: 'pending' }]
    );

    expect(rows).toHaveLength(0);
  });

  it('hides rejected brands even when globally approved and supplier-approved', () => {
    const rows = buildSupplyChainSummaryRows(
      [{ name: 'Sonata', status: 'approved' }],
      [{ id: 'e1', brands: 'Sonata', role: '' }],
      [],
      [{ name: 'Sonata', status: 'approved' }],
      [{ name: 'Sonata', status: 'rejected' }]
    );

    expect(rows).toHaveLength(0);
  });
});

describe('listPendingChainRoleSubmissions', () => {
  it('returns empty when profile is not pending', () => {
    expect(listPendingChainRoleSubmissions({ chainProfileApprovalStatus: 'approved' })).toEqual([]);
  });

  it('returns only brands with a submitted role awaiting review', () => {
    const profile = {
      chainProfileApprovalStatus: 'pending',
      chainProfilePendingSubmittedAt: '2026-08-24T09:14:26.000Z',
      approvedChainProfile: {
        companyInfoEntries: [{ id: '1', brands: 'acc', role: '' }]
      },
      companyInfoEntries: [
        { id: '1', brands: 'acc', role: '' },
        { id: '2', brands: 'samsung', role: 'dealer' }
      ]
    };

    expect(listPendingChainRoleSubmissions(profile)).toEqual([
      {
        brand: 'samsung',
        role: 'dealer',
        roleLabel: 'Dealer',
        submittedAt: '2026-08-24T09:14:26.000Z'
      }
    ]);
  });

  it('scopes pending status to brands that actually submitted a role', () => {
    const profile = {
      chainProfileApprovalStatus: 'pending',
      approvedChainProfile: {
        companyInfoEntries: [{ id: '1', brands: 'acc', role: '' }]
      },
      companyInfoEntries: [
        { id: '1', brands: 'acc', role: '' },
        { id: '2', brands: 'samsung', role: 'dealer' }
      ]
    };

    expect(hasPendingChainRoleSubmissionForBrand(profile, 'acc')).toBe(false);
    expect(hasPendingChainRoleSubmissionForBrand(profile, 'samsung')).toBe(true);
    expect(resolveChainProfileApprovalStatusForBrand(profile, 'acc')).toBe('');
    expect(resolveChainProfileApprovalStatusForBrand(profile, 'samsung')).toBe('pending');
  });
});

describe('entryNeedsChainRoleAdminReview', () => {
  it('requires a pending role and brand', () => {
    expect(entryNeedsChainRoleAdminReview(null, { brands: 'acc', role: '' })).toBe(false);
    expect(entryNeedsChainRoleAdminReview(null, { brands: 'acc', role: 'dealer' })).toBe(true);
  });

  it('treats new verification documents as needing admin review', () => {
    expect(
      entryNeedsChainRoleAdminReview(
        { brands: 'acc', role: 'retailer', authorizationCertificateUrls: ['https://cdn.example.com/a.png'] },
        { brands: 'acc', role: 'retailer', authorizationCertificateUrls: ['https://cdn.example.com/b.png'] }
      )
    ).toBe(true);
    expect(
      entryNeedsChainRoleAdminReview(
        { brands: 'acc', role: 'retailer', authorizationCertificateUrls: ['https://cdn.example.com/a.png'] },
        { brands: 'acc', role: 'retailer', authorizationCertificateUrls: ['https://cdn.example.com/a.png'] }
      )
    ).toBe(false);
  });
});

describe('dedupeSupplierBrandRequestsByLatest', () => {
  it('keeps the newest status per brand key', () => {
    const rows = dedupeSupplierBrandRequestsByLatest([
      { name: 'APPI', status: 'pending', updatedAt: '2026-08-24T10:00:00.000Z' },
      { name: 'APPI', status: 'rejected', updatedAt: '2026-08-24T11:00:00.000Z' }
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('rejected');
  });
});

describe('clearSubmittedPathBBrandDrafts', () => {
  it('removes submitted Path B brand drafts and leaves an empty row', () => {
    const profile = {
      companyInfoEntries: [
        { id: '1', brands: 'acc', role: 'dealer' },
        { id: '2', brands: 'APPI', role: '' }
      ]
    };
    const cleared = clearSubmittedPathBBrandDrafts(profile, ['APPI']);
    expect(cleared.companyInfoEntries.some((entry) => entry.brands === 'APPI')).toBe(false);
    expect(cleared.companyInfoEntries.some((entry) => entry.brands === 'acc')).toBe(true);
    expect(cleared.companyInfoEntries.some((entry) => !String(entry?.brands || '').trim())).toBe(true);
  });
});

describe('mergeCompanyInfoEntriesById', () => {
  it('lets later lists overwrite earlier lists for the same id', () => {
    const merged = mergeCompanyInfoEntriesById(
      [{ id: 'a', brands: 'X', role: '' }],
      [{ id: 'a', brands: 'X', role: 'retailer' }]
    );
    expect(merged[0].role).toBe('retailer');
  });
});

describe('buildSupplierChainSavePayload', () => {
  it('preserves profile top-level role/brands when saving a single entry', () => {
    const profile = {
      supplierRole: 'dealer',
      brands: 'Milton',
      gstin: 'GST-1',
      companyName: 'Acme',
      companyInfoEntries: [
        { id: 'e1', role: 'dealer', brands: 'Milton', minimumOrderValue: 2500 },
        { id: 'e2', role: 'retailer', brands: 'HP', minimumOrderValue: 1000 }
      ]
    };
    const entries = [
      { id: 'e1', role: 'dealer', brands: 'Milton', minimumOrderValue: 2500 },
      { id: 'e2', role: 'retailer', brands: 'HP', minimumOrderValue: 4500 }
    ];

    const payload = buildSupplierChainSavePayload(profile, entries, {
      forApi: true,
      saveSupplyChainEntryId: 'e2'
    });

    expect(payload.supplierRole).toBe('dealer');
    expect(payload.brands).toBe('Milton');
    expect(payload.gstin).toBe('GST-1');
    expect(payload.companyName).toBe('Acme');
    expect(payload.minimumOrderValue).toBe(4500);
    expect(payload.companyInfoEntries.find((entry) => entry.id === 'e2')?.minimumOrderValue).toBe(4500);
  });

  it('keeps a Path B draft that momentarily matches an approved brand while typing', () => {
    const profile = {
      companyInfoEntries: [
        { id: 'approved-safari', brands: 'Safari', role: 'dealer' },
        { id: 'path-b-draft', brands: 'safari', role: '' }
      ]
    };
    const live = buildSupplierChainSavePayload(profile, null, { dedupeByBrand: false });
    expect(live.companyInfoEntries).toHaveLength(2);
    expect(live.companyInfoEntries.map((row) => row.id)).toEqual(['approved-safari', 'path-b-draft']);

    const saved = buildSupplierChainSavePayload(profile);
    expect(saved.companyInfoEntries).toHaveLength(1);
  });

  it('does not send legacy top-level brands when entries have no configured brand', () => {
    const profile = {
      brands: 'StaleLegacyBrand',
      supplierRole: 'dealer',
      companyInfoEntries: [{ id: 'e1', role: '', brands: '' }]
    };
    const payload = buildSupplierChainSavePayload(profile, null, {
      forApi: true,
      saveBrandApprovalOnly: true
    });
    expect(payload.brands).toBe('');
    expect(payload.saveBrandApprovalOnly).toBe(true);
  });

  it('strips local document-update stamps from API payloads', () => {
    const profile = {
      companyInfoEntries: [
        {
          id: 'e1',
          role: 'dealer',
          brands: 'Milton',
          authorizationCertificateUrls: ['https://cdn.example.com/a.pdf'],
          roleDocsUpdatedAt: 99,
          brandDocsUpdatedAt: 12
        }
      ]
    };
    const payload = buildSupplierChainSavePayload(profile, null, { forApi: true });
    expect(payload.companyInfoEntries[0].roleDocsUpdatedAt).toBeUndefined();
    expect(payload.companyInfoEntries[0].brandDocsUpdatedAt).toBeUndefined();
    expect(payload.companyInfoEntries[0].authorizationCertificateUrls).toEqual([
      'https://cdn.example.com/a.pdf'
    ]);
  });
});

describe('matchCompanyInfoEntry', () => {
  it('does not treat a Path B draft as the existing approved brand row', () => {
    const approved = { id: 'approved-safari', brands: 'Safari' };
    const draft = { id: 'path-b-draft', brands: 'safari' };
    expect(matchCompanyInfoEntry(approved, { entryId: draft.id, brand: draft.brands })).toBe(false);
    expect(matchCompanyInfoEntry(draft, { entryId: draft.id, brand: draft.brands })).toBe(true);
  });
});

describe('shouldShowChainProfileRejectionBanner', () => {
  const rejection = {
    id: 'req-1',
    reason: 'no need',
    reviewedAt: '2026-08-21T12:00:00.000Z'
  };

  it('hides the banner on an approved profile after admin rejection', () => {
    expect(
      shouldShowChainProfileRejectionBanner({
        rejection,
        approvalStatus: 'approved',
        acknowledgedKey: ''
      })
    ).toBe(false);
  });

  it('hides the banner after it was already seen this session', () => {
    expect(
      shouldShowChainProfileRejectionBanner({
        rejection,
        approvalStatus: 'draft',
        acknowledgedKey: 'req-1'
      })
    ).toBe(false);
  });

  it('shows the banner for a new rejection while a draft is in progress', () => {
    expect(
      shouldShowChainProfileRejectionBanner({
        rejection,
        approvalStatus: 'draft',
        acknowledgedKey: ''
      })
    ).toBe(true);
  });
});
