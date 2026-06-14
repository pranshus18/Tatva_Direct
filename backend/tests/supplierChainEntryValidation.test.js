import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSupplyChainRegistrationData,
  resolveCompanyInfoEntriesForValidation,
  supplierProfileIncludesChainDraft,
  validateCompanyInfoEntriesList
} from '../utils/supplierChainEntryValidation.js';

test('validateCompanyInfoEntriesList requires all fields per entry', () => {
  const incomplete = [
    {
      id: 'e1',
      role: 'dealer',
      brands: 'Oil',
      gstin: '',
      companyName: 'Acme',
      ownershipDetails: 'Pvt Ltd',
      authorizationCertificateUrl: 'https://example.com/cert.pdf',
      minimumOrderValue: 1000
    }
  ];
  const result = validateCompanyInfoEntriesList(incomplete);
  assert.equal(result.ok, false);
  assert.match(result.message, /GSTIN/i);
});

test('retailer entry does not require minimum order value', () => {
  const ok = validateCompanyInfoEntriesList([
    {
      id: 'e1',
      role: 'retailer',
      brands: 'Cement',
      gstin: '22AAAAA0000A1Z5',
      companyName: 'Shop',
      ownershipDetails: 'Proprietorship',
      authorizationCertificateUrl: 'https://example.com/cert.pdf'
    }
  ]);
  assert.equal(ok.ok, true);
});

test('resolveCompanyInfoEntriesForValidation uses legacy row when entries array empty', () => {
  const rows = resolveCompanyInfoEntriesForValidation({
    supplierRole: 'dealer',
    companyInfoEntries: []
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'legacy');
});

test('supplierProfileIncludesChainDraft is false for empty chain payload', () => {
  assert.equal(supplierProfileIncludesChainDraft({ companyInfoEntries: [] }), false);
});

test('supplierProfileIncludesChainDraft ignores general profile-only fields', () => {
  assert.equal(
    supplierProfileIncludesChainDraft({
      companyInfoEntries: [],
      gstin: '29JVJPS2072B1ZA',
      companyName: 'Acme Traders',
      ownershipDetails: 'Pvt Ltd'
    }),
    false
  );
});

test('supplierProfileIncludesChainDraft detects legacy supply-chain fields', () => {
  assert.equal(
    supplierProfileIncludesChainDraft({
      companyInfoEntries: [],
      supplierRole: 'dealer',
      brands: 'Cement'
    }),
    true
  );
});

test('hasSupplyChainRegistrationData detects in-progress entry rows', () => {
  assert.equal(hasSupplyChainRegistrationData({ gstin: '22AAAAA0000A1Z5' }), true);
  assert.equal(hasSupplyChainRegistrationData({}), false);
});

test('validateCompanyInfoEntriesList rejects multiple brands in one entry', () => {
  const result = validateCompanyInfoEntriesList([
    {
      id: 'e1',
      role: 'dealer',
      brands: 'Oil, Cement',
      gstin: '22AAAAA0000A1Z5',
      companyName: 'Acme',
      ownershipDetails: 'Pvt Ltd',
      authorizationCertificateUrl: 'https://example.com/cert.pdf',
      minimumOrderValue: 1000
    }
  ]);
  assert.equal(result.ok, false);
  assert.match(result.message, /only one brand/i);
});
