import test from 'node:test';
import assert from 'node:assert/strict';
import { upsertEntryDocument, removeCertificateFromEntries, liveEntryHasApprovedRoleDocuments } from '../controllers/profile/routes/certificateRoutes.js';
import {
  resolveBrandApprovalDocumentUrls,
  resolveAuthorizationCertificateUrls
} from '../utils/authorizationCertificateUrls.js';

const SAVED_ENTRY = {
  id: 'entry-1',
  role: 'dealer',
  brands: 'acc',
  gstin: '22AAAAA0000A1Z5',
  companyName: 'Acc Traders'
};

test('upsertEntryDocument attaches a brand document to an existing entry', () => {
  const entries = upsertEntryDocument([SAVED_ENTRY], 'entry-1', 'https://files.test/b.pdf', 'brand_approval');

  assert.equal(entries.length, 1);
  assert.deepEqual(resolveBrandApprovalDocumentUrls(entries[0]), ['https://files.test/b.pdf']);
  assert.deepEqual(resolveAuthorizationCertificateUrls(entries[0]), []);
});

test('upsertEntryDocument creates a draft entry when the row is not saved yet', () => {
  const entries = upsertEntryDocument([SAVED_ENTRY], 'draft-entry', 'https://files.test/b.pdf', 'brand_approval');

  assert.equal(entries.length, 2);
  const draft = entries.find((entry) => entry.id === 'draft-entry');
  assert.ok(draft, 'draft entry is created so the upload can be linked');
  assert.deepEqual(resolveBrandApprovalDocumentUrls(draft), ['https://files.test/b.pdf']);
  // The already-saved row must not be touched.
  assert.deepEqual(resolveBrandApprovalDocumentUrls(entries.find((e) => e.id === 'entry-1')), []);
});

test('upsertEntryDocument attaches role documents to the role field only', () => {
  const entries = upsertEntryDocument([SAVED_ENTRY], 'entry-1', 'https://files.test/r.pdf', 'role_authorization');

  assert.deepEqual(resolveAuthorizationCertificateUrls(entries[0]), ['https://files.test/r.pdf']);
  assert.deepEqual(resolveBrandApprovalDocumentUrls(entries[0]), []);
});

test('upsertEntryDocument keeps earlier documents and ignores duplicates', () => {
  const first = upsertEntryDocument([SAVED_ENTRY], 'entry-1', 'https://files.test/a.pdf', 'brand_approval');
  const second = upsertEntryDocument(first, 'entry-1', 'https://files.test/b.pdf', 'brand_approval');
  const duplicate = upsertEntryDocument(second, 'entry-1', 'https://files.test/b.pdf', 'brand_approval');

  assert.deepEqual(resolveBrandApprovalDocumentUrls(duplicate[0]), [
    'https://files.test/a.pdf',
    'https://files.test/b.pdf'
  ]);
});

test('upsertEntryDocument creates the first entry when the profile has none', () => {
  const entries = upsertEntryDocument([], 'draft-entry', 'https://files.test/b.pdf', 'brand_approval');

  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, 'draft-entry');
  assert.deepEqual(resolveBrandApprovalDocumentUrls(entries[0]), ['https://files.test/b.pdf']);
});

test('removeCertificateFromEntries drops a role document from the matching entry', () => {
  const withDoc = upsertEntryDocument([SAVED_ENTRY], 'entry-1', 'https://files.test/r.pdf', 'role_authorization');
  const { entries, removed } = removeCertificateFromEntries(
    withDoc,
    'entry-1',
    'https://files.test/r.pdf',
    'role_authorization'
  );

  assert.equal(removed, true);
  assert.deepEqual(resolveAuthorizationCertificateUrls(entries[0]), []);
});

test('removeCertificateFromEntries finds the row by document URL when entry ids differ', () => {
  const withDoc = upsertEntryDocument([SAVED_ENTRY], 'entry-1', 'https://files.test/r.pdf', 'role_authorization');
  const { entries, removed } = removeCertificateFromEntries(
    withDoc,
    'form-draft-id',
    'https://files.test/r.pdf',
    'role_authorization'
  );

  assert.equal(removed, true);
  assert.equal(entries.length, 1);
  assert.deepEqual(resolveAuthorizationCertificateUrls(entries[0]), []);
});

test('liveEntryHasApprovedRoleDocuments is true only when the saved role already has documents', () => {
  const withDoc = upsertEntryDocument([SAVED_ENTRY], 'entry-1', 'https://files.test/r.pdf', 'role_authorization');
  assert.equal(liveEntryHasApprovedRoleDocuments({ companyInfoEntries: withDoc }, 'entry-1'), true);
  assert.equal(liveEntryHasApprovedRoleDocuments({ companyInfoEntries: [SAVED_ENTRY] }, 'entry-1'), false);
  assert.equal(liveEntryHasApprovedRoleDocuments({ companyInfoEntries: withDoc }, 'missing'), false);
});
