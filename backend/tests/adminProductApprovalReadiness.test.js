import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAdminProductApprovalReadiness,
  isAdminProductReadyForApproval,
  mergeOfferIntoProductForApproval
} from '../services/adminProductApprovalReadinessService.js';

const readyPendingProduct = {
  status: 'pending',
  supplierDescription: 'Raw supplier submission.',
  publishedDescription: 'Durable steel bottle suitable for daily hydration.',
  description: 'Durable steel bottle suitable for daily hydration.',
  hsn_code: '7323',
  igst_rate: 18,
  cgst_rate: 9,
  sgst_rate: 9,
  specifications: { Brand: null, 'Model Name': null }
};

test('isAdminProductReadyForApproval passes when saved buyer-facing description exists', () => {
  assert.equal(isAdminProductReadyForApproval(readyPendingProduct), true);
});

test('validateAdminProductApprovalReadiness passes when admin saves supplier text as-is', () => {
  const supplierText = 'Durable steel bottle suitable for daily hydration.';
  assert.equal(
    isAdminProductReadyForApproval({
      ...readyPendingProduct,
      supplierDescription: supplierText,
      publishedDescription: supplierText,
      description: supplierText
    }),
    true
  );
});

test('validateAdminProductApprovalReadiness fails without saved buyer-facing description', () => {
  const result = validateAdminProductApprovalReadiness({
    ...readyPendingProduct,
    publishedDescription: '',
    description: 'Stale polished catalog copy.'
  });
  assert.equal(result.ok, false);
  assert.ok(result.missingRequirements.some((row) => row.id === 'description'));
});

test('mergeOfferIntoProductForApproval attaches publishedDescription from offer attrs', () => {
  const merged = mergeOfferIntoProductForApproval(
    { status: 'pending', description: '' },
    {
      attributes: {
        publishedDescription: 'Polished buyer copy.',
        supplierDescription: 'Raw supplier copy.'
      }
    }
  );
  assert.equal(merged.publishedDescription, 'Polished buyer copy.');
  assert.equal(merged.supplierDescription, 'Raw supplier copy.');
});

test('validateAdminProductApprovalReadiness fails without GST', () => {
  const result = validateAdminProductApprovalReadiness({
    ...readyPendingProduct,
    hsn_code: '',
    igst_rate: null,
    cgst_rate: null,
    sgst_rate: null
  });
  assert.equal(result.ok, false);
  assert.ok(result.missingRequirements.some((row) => row.id === 'gst_hsn'));
  assert.ok(result.missingRequirements.some((row) => row.id === 'gst_rates'));
});

test('validateAdminProductApprovalReadiness fails without specification keys', () => {
  const result = validateAdminProductApprovalReadiness({ ...readyPendingProduct, specifications: {} });
  assert.equal(result.ok, false);
  assert.ok(result.missingRequirements.some((row) => row.id === 'specifications'));
});
