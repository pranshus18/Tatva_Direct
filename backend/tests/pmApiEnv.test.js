import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePmApiEnv,
  remapPmUrlToEnv,
  resolvePmBaseUrl,
  PM_USERS_HOST_BY_ENV,
  PM_PAYMENT_HOST_BY_ENV,
  PM_API_CATALOG
} from '../config/pmApi.js';

test('resolvePmApiEnv maps prod aliases to production', () => {
  assert.equal(resolvePmApiEnv('production', 'development'), 'production');
  assert.equal(resolvePmApiEnv('prod', 'development'), 'production');
  assert.equal(resolvePmApiEnv('PRODUCTION', 'development'), 'production');
});

test('resolvePmApiEnv maps local non-prod values to development', () => {
  assert.equal(resolvePmApiEnv('dev', 'development'), 'development');
  assert.equal(resolvePmApiEnv('development', 'development'), 'development');
  assert.equal(resolvePmApiEnv('test', 'test'), 'development');
  assert.equal(resolvePmApiEnv('', 'development'), 'development');
});

test('NODE_ENV=production always uses opsapi even if PM_API_ENV=dev is leftover', () => {
  assert.equal(resolvePmApiEnv('dev', 'production'), 'production');
  assert.equal(resolvePmApiEnv('development', 'production'), 'production');
  assert.equal(resolvePmApiEnv('', 'production'), 'production');
  assert.equal(resolvePmApiEnv('prod', 'production'), 'production');
});

test('local development can still opt into production PM APIs', () => {
  assert.equal(resolvePmApiEnv('production', 'development'), 'production');
});

test('remapPmUrlToEnv swaps leftover devopsapi URLs in production', () => {
  assert.equal(
    remapPmUrlToEnv('https://devopsapi.withtatva.ai/users', 'production'),
    'https://opsapi.withtatva.ai/users'
  );
  assert.equal(
    remapPmUrlToEnv(
      'https://devopsapi.withtatva.ai/payment/api/v1/payments/vault/topup/initiate',
      'production'
    ),
    'https://opsapi.withtatva.ai/payment/api/v1/payments/vault/topup/initiate'
  );
});

test('remapPmUrlToEnv swaps leftover opsapi URLs in development', () => {
  assert.equal(
    remapPmUrlToEnv('https://opsapi.withtatva.ai/users', 'development'),
    'https://devopsapi.withtatva.ai/users'
  );
});

test('resolvePmBaseUrl ignores stale env overrides and keeps matching ones', () => {
  assert.equal(
    resolvePmBaseUrl(
      'https://devopsapi.withtatva.ai/users',
      PM_USERS_HOST_BY_ENV.production,
      'production'
    ),
    PM_USERS_HOST_BY_ENV.production
  );
  assert.equal(
    resolvePmBaseUrl(
      'https://opsapi.withtatva.ai/users',
      PM_USERS_HOST_BY_ENV.production,
      'production'
    ),
    PM_USERS_HOST_BY_ENV.production
  );
  assert.equal(
    resolvePmBaseUrl('', PM_USERS_HOST_BY_ENV.development, 'development'),
    PM_USERS_HOST_BY_ENV.development
  );
});

test('PM hosts keep identical paths on devopsapi (dev) and opsapi (prod)', () => {
  assert.equal(PM_USERS_HOST_BY_ENV.development, 'https://devopsapi.withtatva.ai/users');
  assert.equal(PM_USERS_HOST_BY_ENV.production, 'https://opsapi.withtatva.ai/users');
  assert.equal(PM_PAYMENT_HOST_BY_ENV.development, 'https://devopsapi.withtatva.ai/payment');
  assert.equal(PM_PAYMENT_HOST_BY_ENV.production, 'https://opsapi.withtatva.ai/payment');
});

test('every PM API exists for both development and production', () => {
  const expectedKeys = [
    'usersBase',
    'paymentBase',
    'vendorLeads',
    'verifyGst',
    'users',
    'usersMe',
    'sendOtp',
    'verifyOtp',
    'vault',
    'vaultTransactions',
    'vaultAddMoney',
    'address',
    'stateByPincode',
    'vaultTopupInitiate',
    'vaultTopupComplete',
    'vaultPayOrder'
  ];

  assert.deepEqual(Object.keys(PM_API_CATALOG.development), expectedKeys);
  assert.deepEqual(Object.keys(PM_API_CATALOG.production), expectedKeys);

  assert.equal(
    PM_API_CATALOG.development.stateByPincode,
    'https://devopsapi.withtatva.ai/users/api/google-maps/state-by-pincode'
  );
  assert.equal(
    PM_API_CATALOG.production.stateByPincode,
    'https://opsapi.withtatva.ai/users/api/google-maps/state-by-pincode'
  );
  assert.equal(
    PM_API_CATALOG.development.address,
    'https://devopsapi.withtatva.ai/users/api/address'
  );
  assert.equal(
    PM_API_CATALOG.production.address,
    'https://opsapi.withtatva.ai/users/api/address'
  );
  assert.equal(
    PM_API_CATALOG.production.vendorLeads,
    'https://opsapi.withtatva.ai/users/api/users/vendor-leads'
  );
  assert.equal(
    PM_API_CATALOG.production.vault,
    'https://opsapi.withtatva.ai/users/api/vault'
  );
  assert.equal(
    PM_API_CATALOG.production.vaultTopupInitiate,
    'https://opsapi.withtatva.ai/payment/api/v1/payments/vault/topup/initiate'
  );
  assert.equal(
    PM_API_CATALOG.production.vaultPayOrder,
    'https://opsapi.withtatva.ai/payment/api/v1/payments/order-payment/vault-pay'
  );
  assert.equal(
    PM_API_CATALOG.production.verifyGst,
    'https://opsapi.withtatva.ai/users/api/users/verify-gst'
  );
  assert.equal(
    PM_API_CATALOG.production.sendOtp,
    'https://opsapi.withtatva.ai/users/api/auth/send-otp'
  );
  assert.equal(
    PM_API_CATALOG.production.verifyOtp,
    'https://opsapi.withtatva.ai/users/api/auth/verify-otp'
  );
  assert.equal(
    PM_API_CATALOG.production.usersMe,
    'https://opsapi.withtatva.ai/users/api/users/me'
  );
  assert.equal(
    PM_API_CATALOG.production.vaultTransactions,
    'https://opsapi.withtatva.ai/users/api/vault/transactions'
  );
  assert.equal(
    PM_API_CATALOG.production.vaultAddMoney,
    'https://opsapi.withtatva.ai/users/api/vault/add-money'
  );
  assert.equal(
    PM_API_CATALOG.production.vaultTopupComplete,
    'https://opsapi.withtatva.ai/payment/api/v1/payments/vault/topup/complete'
  );

  for (const key of expectedKeys) {
    const devUrl = PM_API_CATALOG.development[key];
    const prodUrl = PM_API_CATALOG.production[key];
    assert.equal(
      prodUrl.replace('opsapi.withtatva.ai', 'devopsapi.withtatva.ai'),
      devUrl,
      `${key} prod path must match dev path`
    );
  }
});
