import { describe, expect, it } from 'vitest';
import {
  buildSupplyChainFormProfile,
  buildSupplyChainSummaryRows,
  deduplicateCompanyInfoEntriesByBrand,
  isBrandApprovedForSupplyChainStep,
  mergeCompanyInfoEntriesById,
  BRAND_NOT_APPROVED_SUPPLY_CHAIN_MESSAGE
} from './supplierSelectYourselfProfile';
import { resolveRoleVerificationDocumentUrls } from './authorizationCertificateUrls';

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

  it('hides catalog brands without admin supply chain unless supplier-approved', () => {
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

    expect(rows.map((row) => row.brand)).toEqual(['Fossil']);
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

  it('skips pending supplier-approved brands', () => {
    const rows = buildSupplyChainSummaryRows(
      [{ name: 'Titan', status: 'approved' }],
      [{ id: 'e1', brands: 'Titan', role: '' }],
      [],
      [{ name: 'Titan', status: 'pending' }]
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
