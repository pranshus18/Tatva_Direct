import { PM_PLATFORM_FLAG } from '../config/pmAuth';
import { resolveApiPath } from '../config/api';
import {
  applyPmAuthFromResponse,
  applyPmVaultCredentials,
  getPmCustomerCredentials
} from '../utils/pmAuthSession';

const normalizePhone = (phoneNumber) => String(phoneNumber || '').replace(/\D/g, '');

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

/**
 * Browser → Tatva `/api/auth/pm-send-otp` → PM send-otp.
 * Avoids CORS / Failed to fetch against the PM users host from the browser.
 */
export async function sendPmOtp(phoneNumber) {
  const normalizedPhone = normalizePhone(phoneNumber);
  if (!normalizedPhone || normalizedPhone.length < 10) {
    throw new Error('Enter a valid 10-digit phone number');
  }

  const response = await fetch(resolveApiPath('/api/auth/pm-send-otp'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      phoneNumber: normalizedPhone,
      flag: PM_PLATFORM_FLAG,
      platformFlag: PM_PLATFORM_FLAG
    })
  });

  const data = await parseJsonResponse(response);

  if (!response.ok || data.success === false || data.status === 'error') {
    throw new Error(data.message || 'Failed to send OTP');
  }

  return { phoneNumber: normalizedPhone, ...data };
}

/**
 * Browser → Tatva `/api/auth/pm-verify-otp` → PM verify-otp.
 */
export async function verifyPmOtp(phoneNumber, otp) {
  const normalizedPhone = normalizePhone(phoneNumber);
  const normalizedOtp = String(otp || '').replace(/\D/g, '');

  if (!normalizedPhone || normalizedPhone.length < 10) {
    throw new Error('Enter a valid phone number');
  }
  if (!normalizedOtp || normalizedOtp.length < 4) {
    throw new Error('Enter the OTP sent to your phone');
  }

  const response = await fetch(resolveApiPath('/api/auth/pm-verify-otp'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      phoneNumber: normalizedPhone,
      otp: normalizedOtp,
      flag: PM_PLATFORM_FLAG,
      platformFlag: PM_PLATFORM_FLAG
    })
  });

  const data = await parseJsonResponse(response);

  if (!response.ok || data.success === false || data.status === 'error') {
    throw new Error(data.message || 'Invalid or expired OTP');
  }

  return { phoneNumber: normalizedPhone, ...data };
}

export async function completePmAuth(phoneNumber, pmProfile = null, pmAccessToken = null, pmRefreshToken = null) {
  const normalizedPhone = normalizePhone(phoneNumber);
  const response = await fetch(resolveApiPath('/api/auth/pm-otp-login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phoneNumber: normalizedPhone,
      ...(pmProfile ? { pmProfile } : {}),
      ...(pmAccessToken ? { pmAccessToken } : {}),
      ...(pmRefreshToken ? { pmRefreshToken } : {})
    })
  });

  const data = await parseJsonResponse(response);

  if (!response.ok || data.status === 'error') {
    throw new Error(data.message || 'Could not complete phone sign-in');
  }

  return data;
}

/**
 * Restore and refresh PM tokens from the Tatva backend.
 * Always asks the server — local access tokens go stale while the Tatva session is still valid.
 */
export async function restorePmVaultSession() {
  const existing = getPmCustomerCredentials();
  const token = localStorage.getItem('token');
  if (!token) return existing;

  const response = await fetch(resolveApiPath('/api/auth/pm-vault-session'), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(existing.accessToken ? { 'X-PM-Access-Token': existing.accessToken } : {}),
      ...(existing.refreshToken ? { 'X-PM-Refresh-Token': existing.refreshToken } : {})
    }
  });
  const data = await parseJsonResponse(response);
  applyPmAuthFromResponse(response);
  if (response.ok && data.status === 'success' && (data.pmVault?.accessToken || data.pmVault?.refreshToken)) {
    applyPmVaultCredentials(data.pmVault);
    return getPmCustomerCredentials();
  }
  return getPmCustomerCredentials();
}
