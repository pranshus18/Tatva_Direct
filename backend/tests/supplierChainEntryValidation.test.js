import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSupplyChainRegistrationData,
  resolveCompanyInfoEntriesForValidation,
  supplierProfileIncludesChainDraft,
  validateCompanyInfoEntriesList
} from '../utils/supplierChainEntryValidation.js';

test('validateCompanyInfoEntriesList requires role documents when Step 2 started', () => {
  const result = validateCompanyInfoEntriesList([
    {
      id: 'e1',
      role: 'dealer',
      brands: 'Oil',
      minimumOrderValue: 1000
    }
  ]);
  assert.equal(result.ok, false);
  assert.match(result.message, /upload the required document/i);
});

test('validateCompanyInfoEntriesList requires role and docs when registration started without role', () => {
  const result = validateCompanyInfoEntriesList([
    {
      id: 'e1',
      brands: 'Titan',
      supplyChainRegistrationStarted: true
    }
  ]);
  assert.equal(result.ok, false);
  assert.match(result.message, /select your role and upload the required document/i);
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
  assert.equal(hasSupplyChainRegistrationData({ gstin: '22AAAAA0000A1Z5' }), false);
  assert.equal(hasSupplyChainRegistrationData({ brands: 'Cement' }), true);
  assert.equal(hasSupplyChainRegistrationData({}), false);
});

test('company profile save does not require brand for mirrored profile-only entries', () => {
  const mirroredEntry = {
    id: 'e1',
    brands: '',
    gstin: '29JVJPS2072B1ZA',
    companyName: 'Acme Traders',
    ownershipDetails: 'Pvt Ltd'
  };
  assert.equal(
    supplierProfileIncludesChainDraft({
      companyInfoEntries: [mirroredEntry]
    }),
    false
  );
  const result = validateCompanyInfoEntriesList([mirroredEntry]);
  assert.equal(result.ok, true);
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

test('validateCompanyInfoEntriesList skips brand-only entries without Step 2 data', () => {
  const result = validateCompanyInfoEntriesList([
    { id: 'e1', brands: 'Philips' },
    {
      id: 'e2',
      role: 'dealer',
      brands: 'ACC',
      gstin: '22AAAAA0000A1Z5',
      companyName: 'Acme',
      ownershipDetails: 'Pvt Ltd',
      authorizationCertificateUrl: 'https://example.com/cert.pdf',
      minimumOrderValue: 1000
    }
  ]);
  assert.equal(result.ok, true);
});

test('validateCompanyInfoEntriesList rejects duplicate brands across entries', () => {
  const result = validateCompanyInfoEntriesList([
    {
      id: 'e1',
      role: 'dealer',
      brands: 'ACC',
      gstin: '22AAAAA0000A1Z5',
      companyName: 'Acme',
      ownershipDetails: 'Pvt Ltd',
      authorizationCertificateUrl: 'https://example.com/cert1.pdf',
      minimumOrderValue: 1000
    },
    {
      id: 'e2',
      role: 'retailer',
      brands: 'acc',
      gstin: '22AAAAA0000A1Z6',
      companyName: 'Acme 2',
      ownershipDetails: 'Pvt Ltd',
      authorizationCertificateUrl: 'https://example.com/cert2.pdf'
    }
  ]);
  assert.equal(result.ok, false);
  assert.match(result.message, /already registered/i);
  assert.match(result.message, /only one supply-chain role/i);
});
