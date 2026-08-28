import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSignupPlaceholderAddressField,
  sanitizeSignupPlaceholderAddress
} from '../controllers/po/shared/poHelpers.js';

test('sanitizeSignupPlaceholderAddress clears signup defaults for profile display', () => {
  const address = {
    line1: 'Tatvaops',
    city: 'Pending',
    state: 'Pending',
    pincode: '000000',
    country: 'India'
  };

  const sanitized = sanitizeSignupPlaceholderAddress(address, { companyName: 'Tatvaops' });

  assert.deepEqual(sanitized, {
    line1: '',
    city: '',
    state: '',
    pincode: '',
    country: ''
  });
});

test('sanitizeSignupPlaceholderAddress keeps real user-entered billing address', () => {
  const address = {
    line1: '12 MG Road',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411026',
    country: 'India'
  };

  const sanitized = sanitizeSignupPlaceholderAddress(address, { companyName: 'Tatvaops' });

  assert.deepEqual(sanitized, address);
});

test('isSignupPlaceholderAddressField detects individual placeholder fields', () => {
  const address = { city: 'Pending', state: 'Pending', pincode: '000000' };

  assert.equal(isSignupPlaceholderAddressField('city', 'Pending', address), true);
  assert.equal(isSignupPlaceholderAddressField('pincode', '000000', address), true);
  assert.equal(isSignupPlaceholderAddressField('city', 'Pune', address), false);
});

test('buildRegisteredBillingAddress keeps GST city/state/PIN instead of Pending placeholders', async () => {
  const { buildRegisteredBillingAddress } = await import('../utils/parseStructuredShippingAddress.js');
  const address = buildRegisteredBillingAddress({
    businessAddress: 'Plot 1, Hinjewadi',
    addressLine1: 'Plot 1, Hinjewadi',
    city: 'Pune',
    state: 'Maharashtra',
    pincode: '411057',
    country: 'India'
  });

  assert.equal(address.line1, 'Plot 1, Hinjewadi');
  assert.equal(address.city, 'Pune');
  assert.equal(address.state, 'Maharashtra');
  assert.equal(address.pincode, '411057');
  assert.equal(address.country, 'India');
});
