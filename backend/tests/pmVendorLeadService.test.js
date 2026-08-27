import test from 'node:test';
import assert from 'node:assert/strict';
import { formatPmVendorLeadError } from '../services/pmVendorLeadService.js';
import { withPmPlatformFlagQuery, PM_VENDOR_LEADS_URL } from '../config/pmApi.js';

test('formatPmVendorLeadError prefers field details over generic Validation failed', () => {
  assert.equal(
    formatPmVendorLeadError({
      message: 'Validation failed',
      errors: [{ field: 'companyType', message: 'Invalid enum value' }]
    }),
    'companyType: Invalid enum value'
  );
});

test('formatPmVendorLeadError keeps a specific top-level message', () => {
  assert.equal(
    formatPmVendorLeadError({
      message: 'GST already registered',
      errors: [{ message: 'gstNo must be unique' }]
    }),
    'GST already registered — gstNo must be unique'
  );
});

test('vendor-leads URL includes the tatvadirect platform flag', () => {
  const url = withPmPlatformFlagQuery(PM_VENDOR_LEADS_URL);
  assert.match(url, /\/api\/users\/vendor-leads/);
  assert.match(url, /[?&]flag=tatvadirect/);
});
