import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdminPublishedDescriptionAttributes,
  buildSupplierDescriptionAttributes,
  getAdminBuyerFacingDescriptionForApproval,
  getAdminPublishedOfferDescription,
  getSupplierSubmittedDescription
} from '../utils/supplierProductDescriptions.js';

test('getAdminBuyerFacingDescriptionForApproval ignores stale catalog without publish', () => {
  assert.equal(
    getAdminBuyerFacingDescriptionForApproval({
      status: 'pending',
      description: 'Stale polished catalog copy.',
      supplierDescription: 'Raw supplier submission.',
      publishedDescription: ''
    }),
    ''
  );
});

test('getAdminBuyerFacingDescriptionForApproval accepts saved publish copy', () => {
  assert.equal(
    getAdminBuyerFacingDescriptionForApproval({
      status: 'pending',
      description: 'Polished buyer copy.',
      supplierDescription: 'Raw supplier submission.',
      publishedDescription: 'Polished buyer copy.'
    }),
    'Polished buyer copy.'
  );
});

test('getAdminBuyerFacingDescriptionForApproval accepts supplier text saved as-is by admin', () => {
  const supplierText = 'Raw supplier submission.';
  assert.equal(
    getAdminBuyerFacingDescriptionForApproval({
      status: 'pending',
      description: supplierText,
      supplierDescription: supplierText,
      publishedDescription: supplierText
    }),
    supplierText
  );
});

test('buildAdminPublishedDescriptionAttributes preserves supplier draft', () => {
  const existing = buildSupplierDescriptionAttributes(
    {},
    'Specification Value Air Conditioner Type Split Inverter AC'
  );
  const next = buildAdminPublishedDescriptionAttributes(
    existing,
    'Polished buyer-facing copy for the marketplace.'
  );

  assert.equal(
    getSupplierSubmittedDescription(next),
    'Specification Value Air Conditioner Type Split Inverter AC'
  );
  assert.equal(
    getAdminPublishedOfferDescription(next),
    'Polished buyer-facing copy for the marketplace.'
  );
});
