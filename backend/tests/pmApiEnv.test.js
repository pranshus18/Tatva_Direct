import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePmApiEnv,
  PM_USERS_HOST_BY_ENV,
  PM_PAYMENT_HOST_BY_ENV,
  PM_API_CATALOG
} from '../config/pmApi.js';

test('resolvePmApiEnv maps prod aliases to production', () => {
  assert.equal(resolvePmApiEnv('production'), 'production');
  assert.equal(resolvePmApiEnv('prod'), 'production');
  assert.equal(resolvePmApiEnv('PRODUCTION'), 'production');
});

test('resolvePmApiEnv maps everything else to development', () => {
  assert.equal(resolvePmApiEnv('dev'), 'development');
  assert.equal(resolvePmApiEnv('development'), 'development');
  assert.equal(resolvePmApiEnv('test'), 'development');
  assert.equal(resolvePmApiEnv(''), 'development');
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
    'vaultTopupInitiate',
    'vaultTopupComplete',
    'vaultPayOrder'
  ];

  assert.deepEqual(Object.keys(PM_API_CATALOG.development), expectedKeys);
  assert.deepEqual(Object.keys(PM_API_CATALOG.production), expectedKeys);

  assert.equal(
    PM_API_CATALOG.development.vendorLeads,
    'https://devopsapi.withtatva.ai/users/api/users/vendor-leads'
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
