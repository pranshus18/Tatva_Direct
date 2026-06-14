import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectDeclaredBrandNamesFromProfiles,
  mergeApprovedBrandsIntoChainEntries,
  normalizeCompanyInfoEntries
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
