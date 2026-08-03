import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAdminProductApprovalReadiness,
  isAdminProductReadyForApproval
} from '../services/adminProductApprovalReadinessService.js';

const readyProduct = {
  description: 'Durable steel bottle suitable for daily hydration.',
  hsn_code: '7323',
  igst_rate: 18,
  cgst_rate: 9,
  sgst_rate: 9,
  specifications: { Brand: null, 'Model Name': null }
};

test('isAdminProductReadyForApproval passes when description, GST, and spec keys exist', () => {
  assert.equal(isAdminProductReadyForApproval(readyProduct), true);
});

test('validateAdminProductApprovalReadiness fails without description', () => {
  const result = validateAdminProductApprovalReadiness({ ...readyProduct, description: '' });
  assert.equal(result.ok, false);
  assert.ok(result.missingRequirements.some((row) => row.id === 'description'));
});

test('validateAdminProductApprovalReadiness fails without GST', () => {
  const result = validateAdminProductApprovalReadiness({
    ...readyProduct,
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
  const result = validateAdminProductApprovalReadiness({ ...readyProduct, specifications: {} });
  assert.equal(result.ok, false);
  assert.ok(result.missingRequirements.some((row) => row.id === 'specifications'));
});
