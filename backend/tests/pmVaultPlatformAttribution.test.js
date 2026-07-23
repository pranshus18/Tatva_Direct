import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempStore = path.join(
  os.tmpdir(),
  `pm-vault-attr-test-${process.pid}-${Date.now()}.json`
);
process.env.PM_VAULT_ATTRIBUTION_PATH = tempStore;

const {
  rememberPmVaultPlatformAttribution,
  applyPmVaultPlatformAttribution,
  resolvePmVaultDisplayPlatform
} = await import('../services/pmVaultPlatformAttribution.js');

test('resolvePmVaultDisplayPlatform prefers details marker over PM tatvaops stamp', () => {
  assert.equal(
    resolvePmVaultDisplayPlatform({
      flag: 'tatvaops',
      details: 'Vault top-up (tatvadirect)'
    }),
    'tatvadirect'
  );
});

test('resolvePmVaultDisplayPlatform uses razorpay payment attribution', () => {
  rememberPmVaultPlatformAttribution({ razorpayPaymentId: 'pay_TEST_ATTR_001' });
  assert.equal(
    resolvePmVaultDisplayPlatform({
      flag: 'tatvaops',
      details: 'Vault top-up via Razorpay (pay_TEST_ATTR_001)'
    }),
    'tatvadirect'
  );
});

test('applyPmVaultPlatformAttribution keeps other platform flags', () => {
  const rows = applyPmVaultPlatformAttribution([
    { flag: 'otherapp', details: 'Something from another app' },
    { flag: 'tatvaops', details: 'Vault top-up (tatvadirect)' }
  ]);
  assert.equal(rows[0].flag, 'otherapp');
  assert.equal(rows[1].flag, 'tatvadirect');
});

test.after(() => {
  try {
    fs.unlinkSync(tempStore);
  } catch {
    // ignore
  }
});
