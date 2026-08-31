import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isForeignPmPlatformFlag,
  normalizePmStoredUserFlag,
  resolvePmDisplayPlatformFlag,
  PM_PLATFORM_FLAG,
  resolvePmApiEnv,
  remapPmUrlToEnv,
  resolvePmBaseUrl,
  pmEnvFromTatvaHostname,
  resolvePmApiEnvFromRequest,
  runWithPmRequestEnv,
  pmUrl,
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

test('explicit PM_API_ENV=dev uses devopsapi even when NODE_ENV=production', () => {
  assert.equal(resolvePmApiEnv('dev', 'production'), 'development');
  assert.equal(resolvePmApiEnv('development', 'production'), 'development');
});

test('unset PM_API_ENV falls back to NODE_ENV=production → opsapi', () => {
  assert.equal(resolvePmApiEnv('', 'production'), 'production');
});

test('Tatva prod frontend uses opsapi and Vercel dev frontend uses devopsapi', () => {
  assert.equal(pmEnvFromTatvaHostname('direct.withtatva.ai'), 'production');
  assert.equal(pmEnvFromTatvaHostname('https://direct.withtatva.ai'), 'production');
  assert.equal(pmEnvFromTatvaHostname('www.direct.withtatva.ai'), 'production');
  assert.equal(pmEnvFromTatvaHostname('tatva-direct-frontend-five.vercel.app'), 'development');
  assert.equal(
    pmEnvFromTatvaHostname('https://tatva-direct-frontend-five.vercel.app'),
    'development'
  );
  assert.equal(pmEnvFromTatvaHostname('localhost'), 'development');
});

test('request Origin selects PM server even when env vars disagree', () => {
  assert.equal(
    resolvePmApiEnvFromRequest({ headers: { origin: 'https://direct.withtatva.ai' } }),
    'production'
  );
  assert.equal(
    resolvePmApiEnvFromRequest({
      headers: { origin: 'https://tatva-direct-frontend-five.vercel.app' }
    }),
    'development'
  );
  assert.equal(
    resolvePmApiEnv('production', 'production', 'tatva-direct-frontend-five.vercel.app'),
    'development'
  );
  assert.equal(resolvePmApiEnv('dev', 'development', 'direct.withtatva.ai'), 'production');
});

test('pmUrl follows the current request Tatva frontend', () => {
  runWithPmRequestEnv('production', () => {
    assert.ok(pmUrl('verifyGst').includes('://opsapi.withtatva.ai'));
    assert.ok(pmUrl('sendOtp').includes('://opsapi.withtatva.ai'));
    assert.ok(pmUrl('vendorLeads').includes('://opsapi.withtatva.ai'));
    assert.ok(pmUrl('vaultTopupInitiate').includes('://opsapi.withtatva.ai'));
  });
  runWithPmRequestEnv('development', () => {
    assert.ok(pmUrl('verifyGst').includes('://devopsapi.withtatva.ai'));
    assert.ok(pmUrl('vaultPayOrder').includes('://devopsapi.withtatva.ai'));
  });
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
    'refresh',
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
    PM_API_CATALOG.production.refresh,
    'https://opsapi.withtatva.ai/users/api/auth/refresh'
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

test('active exported PM URLs all live on the resolved env hosts', async () => {
  const { PM_API_ENV, PM_API_BASE_URL, PM_PAYMENT_API_BASE_URL, getActivePmApiSnapshot } =
    await import('../config/pmApi.js');
  const snapshot = getActivePmApiSnapshot();
  const expectedMarker =
    PM_API_ENV === 'production' ? '://opsapi.withtatva.ai' : '://devopsapi.withtatva.ai';
  const wrongMarker =
    PM_API_ENV === 'production' ? '://devopsapi.withtatva.ai' : '://opsapi.withtatva.ai';

  assert.equal(snapshot.env, PM_API_ENV);
  assert.equal(snapshot.usersHost, PM_API_BASE_URL);
  assert.equal(snapshot.paymentHost, PM_PAYMENT_API_BASE_URL);
  assert.ok(String(PM_API_BASE_URL).includes(expectedMarker), `users host should include ${expectedMarker}`);
  assert.equal(String(PM_API_BASE_URL).includes(wrongMarker), false);

  for (const [name, url] of Object.entries(snapshot.endpoints)) {
    assert.ok(String(url).includes(expectedMarker), `${name} must use ${expectedMarker}`);
    assert.equal(String(url).includes(wrongMarker), false, `${name} must not use ${wrongMarker}`);
  }
});

test('normalizePmStoredUserFlag replaces other Tatva product tenants with tatvadirect', () => {
  assert.equal(isForeignPmPlatformFlag('tatvavision'), true);
  assert.equal(isForeignPmPlatformFlag('tatvaops'), true);
  assert.equal(isForeignPmPlatformFlag('tatvadirect'), false);
  assert.equal(normalizePmStoredUserFlag('tatvavision'), 'tatvadirect');
  assert.equal(normalizePmStoredUserFlag('tatva-vision'), 'tatvadirect');
  assert.equal(normalizePmStoredUserFlag('service_provider'), 'service_provider');
  assert.equal(normalizePmStoredUserFlag(''), PM_PLATFORM_FLAG);
  assert.equal(resolvePmDisplayPlatformFlag(), 'tatvadirect');
});
