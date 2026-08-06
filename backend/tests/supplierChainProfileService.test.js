import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectDeclaredBrandNamesFromProfiles,
  detectSupplyChainRoleChanges,
  chainRequiresAdminApproval,
  mergeApprovedBrandsIntoChainEntries,
  mergeSupplierEditableEntrySave,
  normalizeCompanyInfoEntries,
  syncLegacyMinimumOrderValue
} from '../services/supplierChainProfileService.js';

test('normalizeCompanyInfoEntries splits multi-brand row into single-brand entries', () => {
  const normalized = normalizeCompanyInfoEntries([
    {
      id: 'entry-1',
      role: 'retailer',
      brands: 'apple, acc',
      gstin: '22AAAAA0000A1Z5',
      companyName: 'Retail Hub',
      authorizationCertificateUrls: ['https://example.com/cert.pdf']
    }
  ]);

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].id, 'entry-1');
  assert.equal(normalized[0].brands, 'apple');
  assert.equal(normalized[1].brands, 'acc');
  assert.equal(normalized[0].role, 'retailer');
  assert.equal(normalized[1].role, 'retailer');
});

test('normalizeCompanyInfoEntries keeps one row for single brand', () => {
  const normalized = normalizeCompanyInfoEntries([
    {
      id: 'entry-2',
      role: 'dealer',
      brands: 'apple',
      gstin: '22AAAAA0000A1Z5',
      companyName: 'Dealer Hub',
      minimumOrderValue: 1200
    }
  ]);

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].id, 'entry-2');
  assert.equal(normalized[0].brands, 'apple');
  assert.equal(normalized[0].minimumOrderValue, 1200);
});

test('normalizeCompanyInfoEntries accepts object payload and splits its brands', () => {
  const normalized = normalizeCompanyInfoEntries({
    id: 'entry-3',
    role: 'retailer',
    brands: 'apple, acc',
    gstin: '22AAAAA0000A1Z5',
    companyName: 'Retail Hub'
  });

  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].id, 'entry-3');
  assert.equal(normalized[0].brands, 'apple');
  assert.equal(normalized[1].brands, 'acc');
});

test('mergeApprovedBrandsIntoChainEntries adds stub rows for missing approved brands', () => {
  const merged = mergeApprovedBrandsIntoChainEntries(
    {
      supplierRole: 'dealer',
      brands: 'acc',
      companyInfoEntries: [
        { id: 'e1', role: 'dealer', brands: 'acc', gstin: '22AAAAA0000A1Z5', companyName: 'Hub' }
      ]
    },
    [
      { name: 'acc', status: 'approved' },
      { name: 'apple', status: 'approved' },
      { name: 'samsung', status: 'approved' }
    ]
  );

  const brandNames = merged.companyInfoEntries.map((entry) => entry.brands).sort();
  assert.deepEqual(brandNames, ['acc', 'apple', 'samsung']);
  const appleEntry = merged.companyInfoEntries.find((entry) => entry.brands === 'apple');
  assert.equal(appleEntry.role, '');
});

test('mergeApprovedBrandsIntoChainEntries skips Phillips when Philips already present', () => {
  const merged = mergeApprovedBrandsIntoChainEntries(
    {
      companyInfoEntries: [{ id: 'e1', role: 'dealer', brands: 'Phillips', companyName: 'Hub' }]
    },
    [
      { name: 'Philips', status: 'approved' },
      { name: 'Phillips', status: 'approved' }
    ]
  );

  const brandNames = merged.companyInfoEntries.map((entry) => entry.brands);
  assert.equal(brandNames.length, 1);
  assert.equal(brandNames[0], 'Phillips');
});

test('mergeChainEntriesForDisplay keeps separate brands and merges by id', async () => {
  const { mergeChainEntriesForDisplay } = await import('../services/supplierChainProfileService.js');
  const merged = mergeChainEntriesForDisplay(
    [
      { id: 'e1', role: 'dealer', brands: 'ACC', authorizationCertificateUrl: 'https://a.com/1.pdf' },
      { id: 'e2', role: 'dealer', brands: 'UltraTech', authorizationCertificateUrl: 'https://a.com/2.pdf' }
    ],
    [{ id: 'e2', role: 'dealer', brands: 'UltraTech', minimumOrderValue: 5000 }]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((e) => e.id === 'e1')?.brands, 'ACC');
  assert.equal(merged.find((e) => e.id === 'e2')?.minimumOrderValue, 5000);
});

test('collectDeclaredBrandNamesFromProfiles gathers brands from saved, draft, and pending shapes', () => {
  const names = collectDeclaredBrandNamesFromProfiles(
    {
      brands: 'hp',
      companyInfoEntries: [{ brands: 'acc' }],
      chainProfileDraft: { companyInfoEntries: [{ brands: 'Finolex' }] }
    },
    { companyInfoEntries: [{ brands: 'apple' }] }
  );
  assert.deepEqual(names.sort(), ['Finolex', 'acc', 'apple', 'hp']);
});

test('detectSupplyChainRoleChanges finds role changes on existing brand entries', () => {
  const baseline = {
    companyInfoEntries: [{ id: 'e1', role: 'dealer', brands: 'Philips' }]
  };
  const incoming = {
    companyInfoEntries: [{ id: 'e1', role: 'retailer', brands: 'Philips' }]
  };
  const changes = detectSupplyChainRoleChanges(baseline, incoming);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].fromRole, 'dealer');
  assert.equal(changes[0].toRole, 'retailer');
  assert.equal(changes[0].brand, 'Philips');
});

test('detectSupplyChainRoleChanges ignores first-time role assignment', () => {
  const baseline = {
    companyInfoEntries: [{ id: 'e1', role: '', brands: 'Philips' }]
  };
  const incoming = {
    companyInfoEntries: [{ id: 'e1', role: 'dealer', brands: 'Philips' }]
  };
  assert.equal(detectSupplyChainRoleChanges(baseline, incoming).length, 0);
});

test('chainRequiresAdminApproval is true when supply-chain role changes on saved brand', () => {
  const baseline = {
    supplierRole: 'dealer',
    brands: 'Philips',
    companyInfoEntries: [{ id: 'e1', role: 'dealer', brands: 'Philips' }]
  };
  const incoming = {
    supplierRole: 'retailer',
    brands: 'Philips',
    companyInfoEntries: [{ id: 'e1', role: 'retailer', brands: 'Philips' }]
  };
  assert.equal(chainRequiresAdminApproval(baseline, incoming), true);
});

test('chainRequiresAdminApproval is false when only minimum order value changes', () => {
  const baseline = {
    supplierRole: 'dealer',
    brands: 'Milton',
    companyInfoEntries: [
      { id: 'e1', role: 'dealer', brands: 'Milton', minimumOrderValue: 2500 }
    ]
  };
  const incoming = {
    supplierRole: 'dealer',
    brands: 'Milton',
    companyInfoEntries: [
      { id: 'e1', role: 'dealer', brands: 'Milton', minimumOrderValue: 5000 }
    ]
  };
  assert.equal(chainRequiresAdminApproval(baseline, incoming), false);
});

test('syncLegacyMinimumOrderValue copies saved entry MOV to legacy profile field', () => {
  const profileUpdate = {};
  syncLegacyMinimumOrderValue(
    profileUpdate,
    {
      companyInfoEntries: [
        { id: 'e1', role: 'dealer', brands: 'Milton', minimumOrderValue: 3200 },
        { id: 'e2', role: 'dealer', brands: 'Other', minimumOrderValue: 1000 }
      ]
    },
    { saveSupplyChainEntryId: 'e1' }
  );
  assert.equal(profileUpdate.minimumOrderValue, 3200);
});

test('mergeSupplierEditableEntrySave updates MOV on one entry without changing top-level role metadata', () => {
  const baseline = {
    supplierRole: 'dealer',
    brands: 'Milton',
    companyInfoEntries: [
      { id: 'e1', role: 'dealer', brands: 'Milton', minimumOrderValue: 2500 },
      { id: 'e2', role: 'dealer', brands: 'HP', minimumOrderValue: 1000 }
    ]
  };
  const incoming = {
    supplierRole: 'dealer',
    brands: 'HP',
    companyInfoEntries: [
      { id: 'e1', role: 'dealer', brands: 'Milton', minimumOrderValue: 5000 },
      { id: 'e2', role: 'dealer', brands: 'HP', minimumOrderValue: 1000 }
    ]
  };

  const merged = mergeSupplierEditableEntrySave(baseline, incoming, 'e1');
  assert.equal(merged.supplierRole, 'dealer');
  assert.equal(merged.brands, 'Milton');
  assert.equal(merged.companyInfoEntries[0].minimumOrderValue, 5000);
  assert.equal(merged.companyInfoEntries[1].minimumOrderValue, 1000);
});
