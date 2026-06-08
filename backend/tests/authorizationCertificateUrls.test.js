import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendAuthorizationCertificateUrl,
  removeAuthorizationCertificateUrl,
  resolveAuthorizationCertificateUrls,
  setAuthorizationCertificateUrls
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
