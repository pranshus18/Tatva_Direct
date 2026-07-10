import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAuthorizationCertificateUrl,
  removeAuthorizationCertificateUrl,
  resolveAuthorizationCertificateUrls,
  resolveRoleVerificationDocumentUrls,
  setAuthorizationCertificateUrls,
  stripBrandDocumentsFromRoleFields
} from '../utils/authorizationCertificateUrls.js';

test('resolveAuthorizationCertificateUrls merges legacy single url and array', () => {
  assert.deepEqual(
    resolveAuthorizationCertificateUrls({
      authorizationCertificateUrl: 'https://example.com/a.pdf',
      authorizationCertificateUrls: ['https://example.com/b.pdf']
    }),
    ['https://example.com/a.pdf', 'https://example.com/b.pdf']
  );
});

test('appendAuthorizationCertificateUrl adds without duplicates', () => {
  const entry = { authorizationCertificateUrl: 'https://example.com/a.pdf' };
  const next = appendAuthorizationCertificateUrl(entry, 'https://example.com/b.pdf');
  assert.deepEqual(next.authorizationCertificateUrls, [
    'https://example.com/a.pdf',
    'https://example.com/b.pdf'
  ]);
  assert.equal(next.authorizationCertificateUrl, 'https://example.com/a.pdf');
});

test('removeAuthorizationCertificateUrl removes one document', () => {
  const entry = setAuthorizationCertificateUrls({}, [
    'https://example.com/a.pdf',
    'https://example.com/b.pdf'
  ]);
  const next = removeAuthorizationCertificateUrl(entry, 'https://example.com/a.pdf');
  assert.deepEqual(next.authorizationCertificateUrls, ['https://example.com/b.pdf']);
  assert.equal(next.authorizationCertificateUrl, 'https://example.com/b.pdf');
});

test('resolveRoleVerificationDocumentUrls excludes brand approval documents', () => {
  const entry = {
    brandApprovalDocumentUrls: ['https://example.com/brand.png'],
    authorizationCertificateUrls: [
      'https://example.com/brand.png',
      'https://example.com/role.pdf'
    ]
  };
  assert.deepEqual(resolveRoleVerificationDocumentUrls(entry), ['https://example.com/role.pdf']);
});

test('stripBrandDocumentsFromRoleFields removes brand docs from role fields', () => {
  const entry = {
    brandApprovalDocumentUrls: ['https://example.com/brand.png'],
    authorizationCertificateUrls: [
      'https://example.com/brand.png',
      'https://example.com/role.pdf'
    ]
  };
  const next = stripBrandDocumentsFromRoleFields(entry);
  assert.deepEqual(next.authorizationCertificateUrls, ['https://example.com/role.pdf']);
  assert.deepEqual(next.brandApprovalDocumentUrls, ['https://example.com/brand.png']);
});
