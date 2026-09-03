import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuthCredentialRequest } from '../middleware/rateLimits.js';

test('isAuthCredentialRequest limits login, signup, and OTP routes only', () => {
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/login' }), true);
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/signup/' }), true);
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/pm-send-otp?x=1' }), true);
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/pm-verify-otp' }), true);
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/pm-otp-login' }), true);
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/pm-signup' }), true);
  assert.equal(isAuthCredentialRequest({ path: '/login' }), true);
});

test('isAuthCredentialRequest skips session and portal routes used while already signed in', () => {
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/switch-portal' }), false);
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/portal-status' }), false);
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/pm-vault-session' }), false);
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/pm-verify-gst' }), false);
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/register-supplier' }), false);
  assert.equal(isAuthCredentialRequest({ originalUrl: '/api/auth/logout' }), false);
  assert.equal(isAuthCredentialRequest({ path: '/pm-vault-session' }), false);
});
