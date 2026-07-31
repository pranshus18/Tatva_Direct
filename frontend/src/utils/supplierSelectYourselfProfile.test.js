import { describe, expect, it } from 'vitest';
import {
  buildSupplyChainFormProfile,
  buildSupplyChainSummaryRows,
  buildBrandApprovalDetailsSignature,
  deduplicateCompanyInfoEntriesByBrand,
  findSupplierBrandRequest,
  isBrandApprovedForSupplyChainStep,
  isBrandApprovalSaveBlockedForPendingRequests,
  mergeCompanyInfoEntriesById,
  mergeFormStepProfile,
  mergeSupplierBrandRequestsIntoProfile,
  resolveSelectYourselfBrandStepStatus,
  listPendingBrandNamesBlockingSave,
  listApprovedBrandNamesBlockingSave,
  BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE,
  SUPPLY_CHAIN_NOT_DEFINED_MESSAGE
} from './supplierSelectYourselfProfile';
import { resolveRoleVerificationDocumentUrls } from './authorizationCertificateUrls';

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

describe('mergeCompanyInfoEntriesById', () => {
  it('lets later lists overwrite earlier lists for the same id', () => {
    const merged = mergeCompanyInfoEntriesById(
      [{ id: 'a', brands: 'X', role: '' }],
      [{ id: 'a', brands: 'X', role: 'retailer' }]
    );
    expect(merged[0].role).toBe('retailer');
  });
});
