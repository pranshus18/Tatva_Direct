#!/usr/bin/env node
/**
 * End-to-end PM vault wallet integration test.
 *
 * Usage:
 *   PM_OTP=123456 node backend/scripts/testPmVaultIntegration.mjs
 *
 * Optional env:
 *   PHONE=6003121654
 *   API_BASE=http://127.0.0.1:8081
 *   TOPUP_AMOUNT=100
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { PM_API_BASE_URL, PM_PAYMENT_API_BASE_URL } = await import('../config/pmApi.js');

const PHONE = String(process.env.PHONE || '6003121654').replace(/\D/g, '').slice(-10);
const OTP = String(process.env.PM_OTP || '').replace(/\D/g, '');
const API_BASE = String(process.env.API_BASE || 'http://127.0.0.1:8081').replace(/\/$/, '');
const PM_USERS_BASE = PM_API_BASE_URL;
const PM_PAYMENT_BASE = PM_PAYMENT_API_BASE_URL;
const TOPUP_AMOUNT = Number(process.env.TOPUP_AMOUNT || 100);

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function assertOk(condition, message, payload = null) {
  if (!condition) {
    console.error(message, payload || '');
    process.exit(1);
  }
}

async function main() {
  if (!OTP || OTP.length < 4) {
    console.error('Set PM_OTP with the OTP received on the phone.');
    process.exit(1);
  }

  console.log('\n=== PM Vault Integration Test ===\n');

  console.log('1) PM verify-otp');
  const verifyRes = await fetch(`${PM_USERS_BASE}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: PHONE, otp: OTP })
  });
  const verifyData = await parseJson(verifyRes);
  assertOk(verifyRes.ok && verifyData.success !== false, 'PM verify failed', verifyData);
  const pmUser = verifyData?.data?.user || {};
  const tokens = verifyData?.data?.tokens || {};
  const accessToken = tokens.accessToken || tokens.access_token;
  const pmUserId = pmUser._id || pmUser.id;
  console.log('   pmUserId:', pmUserId);

  console.log('\n2) GET PM vault directly');
  const vaultRes = await fetch(`${PM_USERS_BASE}/api/vault`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const vaultData = await parseJson(vaultRes);
  assertOk(vaultRes.ok && vaultData.success !== false, 'PM vault GET failed', vaultData);
  console.log('   vault payload keys:', Object.keys(vaultData?.data || vaultData));

  console.log('\n3) Tatva pm-otp-login');
  const loginRes = await fetch(`${API_BASE}/api/auth/pm-otp-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phoneNumber: PHONE,
      pmAccessToken: accessToken,
      pmRefreshToken: tokens.refreshToken || tokens.refresh_token || undefined,
      pmProfile: {
        pmUserId,
        fullName: pmUser.fullName,
        userName: pmUser.userName,
        email: pmUser.email,
        phoneNumber: PHONE
      }
    })
  });
  const loginData = await parseJson(loginRes);
  assertOk(loginRes.ok && loginData.status !== 'error', 'Tatva pm-otp-login failed', loginData);
  const tatvaToken = loginData.token;
  console.log('   tatva user:', loginData.user?.id);

  console.log('\n4) GET /api/wallet/config');
  const configRes = await fetch(`${API_BASE}/api/wallet/config`, {
    headers: { Authorization: `Bearer ${tatvaToken}` }
  });
  const configData = await parseJson(configRes);
  assertOk(configRes.ok && configData.status === 'success', 'wallet config failed', configData);
  assertOk(configData.config?.pmVault?.enabled === true, 'pmVault not enabled on config', configData.config);
  console.log('   pmVault.enabled:', configData.config.pmVault.enabled);

  console.log('\n5) GET /api/wallet/balance (via Tatva backend → PM vault)');
  const balanceBeforeRes = await fetch(`${API_BASE}/api/wallet/balance`, {
    headers: { Authorization: `Bearer ${tatvaToken}` }
  });
  const balanceBeforeData = await parseJson(balanceBeforeRes);
  assertOk(balanceBeforeRes.ok && balanceBeforeData.status === 'success', 'wallet balance failed', balanceBeforeData);
  assertOk(balanceBeforeData.source === 'pm_vault', 'balance not sourced from pm_vault', balanceBeforeData);
  const balanceBefore = Number(balanceBeforeData.balance || 0);
  console.log('   balance before:', balanceBefore, 'INR');

  console.log('\n6) POST /api/wallet/topup/create');
  const createRes = await fetch(`${API_BASE}/api/wallet/topup/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tatvaToken}`
    },
    body: JSON.stringify({ amount: TOPUP_AMOUNT, idempotencyKey: `pm-vault-test-${Date.now()}` })
  });
  const createData = await parseJson(createRes);
  assertOk(createRes.ok && createData.status === 'success', 'topup create failed', createData);
  assertOk(createData.source === 'pm_vault', 'topup create not using pm_vault', createData);
  assertOk(createData.paymentIntent?.orderId, 'missing razorpay orderId', createData.paymentIntent);
  assertOk(createData.paymentIntent?.keyId, 'missing razorpay keyId', createData.paymentIntent);
  console.log('   orderId:', createData.paymentIntent.orderId);
  console.log('   keyId:', createData.paymentIntent.keyId);
  console.log('   NOTE: Complete Razorpay checkout manually, then re-run with PM_OTP only to verify balance/transactions.');

  console.log('\n7) GET /api/wallet/transactions');
  const txRes = await fetch(`${API_BASE}/api/wallet/transactions?limit=10`, {
    headers: { Authorization: `Bearer ${tatvaToken}` }
  });
  const txData = await parseJson(txRes);
  assertOk(txRes.ok && txData.status === 'success', 'wallet transactions failed', txData);
  console.log('   transaction count:', (txData.transactions || []).length);

  console.log('\n8) PM topup initiate reachable');
  const initiateProbe = await fetch(`${PM_PAYMENT_BASE}/api/v1/payments/vault/topup/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      userId: pmUserId,
      amount: Math.round(TOPUP_AMOUNT * 100),
      description: 'Wallet top-up test'
    })
  });
  const initiateData = await parseJson(initiateProbe);
  assertOk(initiateProbe.ok && initiateData.success !== false, 'PM initiate direct call failed', initiateData);
  console.log('   PM initiate OK');

  console.log('\n✅ Integration checks passed up to Razorpay checkout.');
  console.log('   To fully test top-up complete + order pay: finish Razorpay, then verify balance increases and pay an unpaid order from Your Orders.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
