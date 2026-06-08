import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCompanyInfoEntries } from '../services/supplierChainProfileService.js';

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
