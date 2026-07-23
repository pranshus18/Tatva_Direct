import {
  PM_PLATFORM_FLAG,
  PM_SEND_OTP_URL,
  PM_VERIFY_OTP_URL
} from '../config/pmAuth';
import { getApiUrl } from '../config/api';
import {
  getPmCustomerCredentials,
  setPmCustomerCredentials
} from '../utils/pmAuthSession';

const normalizePhone = (phoneNumber) => String(phoneNumber || '').replace(/\D/g, '');

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function sendPmOtp(phoneNumber) {
  const normalizedPhone = normalizePhone(phoneNumber);
  if (!normalizedPhone || normalizedPhone.length < 10) {
    throw new Error('Enter a valid 10-digit phone number');
  }

  const response = await fetch(`${PM_SEND_OTP_URL}?flag=${encodeURIComponent(PM_PLATFORM_FLAG)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      flag: PM_PLATFORM_FLAG,
      'x-flag': PM_PLATFORM_FLAG,
      'x-platform-flag': PM_PLATFORM_FLAG
    },
    body: JSON.stringify({
      phoneNumber: normalizedPhone,
      flag: PM_PLATFORM_FLAG,
      platformFlag: PM_PLATFORM_FLAG
    })
  });

  const data = await parseJsonResponse(response);

  if (!response.ok || data.success === false) {
    throw new Error(data.message || 'Failed to send OTP');
  }

  return { phoneNumber: normalizedPhone, ...data };
}

export async function verifyPmOtp(phoneNumber, otp) {
  const normalizedPhone = normalizePhone(phoneNumber);
  const normalizedOtp = String(otp || '').replace(/\D/g, '');

  if (!normalizedPhone || normalizedPhone.length < 10) {
    throw new Error('Enter a valid phone number');
  }
  if (!normalizedOtp || normalizedOtp.length < 4) {
    throw new Error('Enter the OTP sent to your phone');
  }

  const response = await fetch(`${PM_VERIFY_OTP_URL}?flag=${encodeURIComponent(PM_PLATFORM_FLAG)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      flag: PM_PLATFORM_FLAG,
      'x-flag': PM_PLATFORM_FLAG,
      'x-platform-flag': PM_PLATFORM_FLAG
    },
    body: JSON.stringify({
      phoneNumber: normalizedPhone,
      otp: normalizedOtp,
      flag: PM_PLATFORM_FLAG,
      platformFlag: PM_PLATFORM_FLAG
    })
  });

  const data = await parseJsonResponse(response);

  if (!response.ok || data.success === false) {
    throw new Error(data.message || 'Invalid or expired OTP');
  }

  return { phoneNumber: normalizedPhone, ...data };
}

export async function completePmAuth(phoneNumber, pmProfile = null, pmAccessToken = null, pmRefreshToken = null) {
  const normalizedPhone = normalizePhone(phoneNumber);
  const response = await fetch(getApiUrl('/api/auth/pm-otp-login'), {
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

/** Restore PM tokens from Tatva backend when local storage was cleared after OTP login. */
export async function restorePmVaultSession() {
  const existing = getPmCustomerCredentials();
  if (existing.accessToken) return existing;

  const token = localStorage.getItem('token');
  if (!token) return existing;

  const response = await fetch(getApiUrl('/api/auth/pm-vault-session'), {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  const data = await parseJsonResponse(response);
  if (response.ok && data.status === 'success' && data.pmVault?.accessToken) {
    setPmCustomerCredentials(data.pmVault);
    return getPmCustomerCredentials();
  }
  return existing;
}
