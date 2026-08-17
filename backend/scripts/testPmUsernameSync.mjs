#!/usr/bin/env node
/**
 * End-to-end test: Tatva profile username change → PM PUT sync
 *
 * Usage:
 *   PM_OTP=123456 node backend/scripts/testPmUsernameSync.mjs
 *
 * Optional env:
 *   PHONE=6003121654
 *   NEW_USERNAME=prans
 *   API_BASE=http://127.0.0.1:8081
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const { PM_API_BASE_URL } = await import('../config/pmApi.js');

const PHONE = String(process.env.PHONE || '6003121654').replace(/\D/g, '').slice(-10);
const OTP = String(process.env.PM_OTP || '').replace(/\D/g, '');
const NEW_USERNAME = String(process.env.NEW_USERNAME || 'prans').trim();
const API_BASE = String(process.env.API_BASE || 'http://127.0.0.1:8081').replace(/\/$/, '');
const PM_BASE = PM_API_BASE_URL;

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function fetchPmUserByPhone(phone) {
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const response = await fetch(`${PM_BASE}/api/users/?page=${page}&limit=100`);
    const payload = await parseJson(response);
    const users = Array.isArray(payload?.data?.users) ? payload.data.users : [];
    totalPages = Math.max(1, Number(payload?.data?.totalPages || 1));
    const match = users.find((u) => String(u.phoneNumber || '').slice(-10) === phone);
    if (match) return match;
    page += 1;
  }
  return null;
}

async function main() {
  if (!OTP || OTP.length < 4) {
    console.error('Set PM_OTP env var with the OTP received on the phone.');
    process.exit(1);
  }

  console.log(`\n1) PM verify-otp for ${PHONE}...`);
  const verifyRes = await fetch(`${PM_BASE}/api/auth/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber: PHONE, otp: OTP })
  });
  const verifyData = await parseJson(verifyRes);
  if (!verifyRes.ok || verifyData.success === false) {
    console.error('PM verify failed:', verifyData.message || verifyData);
    process.exit(1);
  }

  const pmUser = verifyData?.data?.user || {};
  const tokens = verifyData?.data?.tokens || {};
  const accessToken = tokens.accessToken || tokens.access_token;
  const pmUserId = pmUser._id || pmUser.id;
  console.log('   PM user:', pmUserId, pmUser.fullName, pmUser.userName);

  console.log('\n2) Tatva pm-otp-login...');
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
        phoneNumber: PHONE,
        status: pmUser.status
      }
    })
  });
  const loginData = await parseJson(loginRes);
  if (!loginRes.ok || loginData.status === 'error') {
    console.error('Tatva login failed:', loginData.message || loginData);
    process.exit(1);
  }
  const tatvaToken = loginData.token;
  console.log('   Tatva user id:', loginData.user?.id);

  console.log('\n3) GET Tatva profile (before)...');
  const beforeProfileRes = await fetch(`${API_BASE}/api/profile`, {
    headers: { Authorization: `Bearer ${tatvaToken}` }
  });
  const beforeProfileData = await parseJson(beforeProfileRes);
  const beforeAccount = beforeProfileData?.profile?.pmCustomerAccount;
  console.log('   userName on Tatva:', beforeAccount?.userName);

  console.log(`\n4) PUT Tatva profile — change userName to "${NEW_USERNAME}"...`);
  const updateRes = await fetch(`${API_BASE}/api/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tatvaToken}`
    },
    body: JSON.stringify({
      userType: 'service_provider',
      pmCustomerAccount: {
        fullName: beforeAccount?.fullName || pmUser.fullName || 'Arundhati',
        userName: NEW_USERNAME,
        email: beforeAccount?.email || pmUser.email,
        phoneNumber: beforeAccount?.phoneNumber || PHONE
      },
      shippingAddresses: beforeProfileData?.profile?.shippingAddresses || []
    })
  });
  const updateData = await parseJson(updateRes);
  if (!updateRes.ok || updateData.status !== 'success') {
    console.error('Tatva profile update failed:', updateData.message || updateData);
    process.exit(1);
  }
  console.log('   message:', updateData.message);
  console.log('   userName on Tatva after save:', updateData.profile?.pmCustomerAccount?.userName);

  console.log('\n5) Verify on PM directory...');
  await new Promise((r) => setTimeout(r, 1500));
  const pmAfter = await fetchPmUserByPhone(PHONE);
  console.log('   PM userName:', pmAfter?.userName);
  console.log('   PM fullName:', pmAfter?.fullName);

  if (String(pmAfter?.userName || '').trim() === NEW_USERNAME) {
    console.log('\n✅ SUCCESS — username synced to PM as', NEW_USERNAME);
    process.exit(0);
  }

  console.error('\n❌ FAILED — PM still shows userName:', pmAfter?.userName);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
