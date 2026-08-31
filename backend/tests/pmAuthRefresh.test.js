import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPmAuthTokens,
  ensureFreshPmAuth,
  getPmAuthFromUser,
  mapPmUserToCustomerProfile,
  resolveServiceProviderDisplayFromPm,
  toPmVaultPayload
} from '../services/pmUserService.js';
import { resolvePmAddressAuth } from '../services/pmAddressService.js';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test('extractPmAuthTokens reads verify-otp and refresh shapes', () => {
  const nested = extractPmAuthTokens({
    success: true,
    data: {
      user: { _id: 'pm-1' },
      tokens: { accessToken: 'a1', refreshToken: 'r1' }
    }
  });
  assert.equal(nested.accessToken, 'a1');
  assert.equal(nested.refreshToken, 'r1');
  assert.equal(nested.pmUserId, 'pm-1');

  const snake = extractPmAuthTokens({
    access_token: 'a2',
    refresh_token: 'r2',
    user: { id: 'pm-2' }
  });
  assert.equal(snake.accessToken, 'a2');
  assert.equal(snake.refreshToken, 'r2');
  assert.equal(snake.pmUserId, 'pm-2');
});

test('getPmAuthFromUser keeps a refresh token even without an access token', () => {
  const auth = getPmAuthFromUser({
    profile: { pmCustomerAuth: { refreshToken: 'r-only', pmUserId: 'pm-1' } }
  });
  assert.equal(auth.refreshToken, 'r-only');
  assert.equal(auth.accessToken, null);
});

test('mapPmUserToCustomerProfile does not keep a tatvavision tenant flag', () => {
  const mapped = mapPmUserToCustomerProfile({
    _id: 'pm-1',
    fullName: 'Lokesh',
    flag: 'tatvavision'
  });
  assert.equal(mapped.flag, 'tatvadirect');
  assert.equal(mapped.platformFlag, 'tatvadirect');
});

test('resolveServiceProviderDisplayFromPm shows tatvadirect even if stored flag is stale', () => {
  const display = resolveServiceProviderDisplayFromPm({
    name: 'Lokesh',
    email: 'lokesh.m@withtatva.ai',
    phone: '9876543210',
    profile: {
      pmCustomerProfile: {
        fullName: 'Lokesh',
        flag: 'tatvavision'
      }
    }
  });
  assert.equal(display.pmCustomerAccount.flag, 'tatvadirect');
  assert.equal(display.pmCustomerAccount.platformFlag, 'tatvadirect');
});

test('toPmVaultPayload includes refresh-only sessions', () => {
  const payload = toPmVaultPayload({ refreshToken: 'r1', pmUserId: 'pm-1' });
  assert.equal(payload.refreshToken, 'r1');
  assert.equal(payload.accessToken, null);
});

test('ensureFreshPmAuth refreshes when the access token is rejected', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes('/api/users/me')) {
      const auth = options?.headers?.Authorization || '';
      if (auth.includes('fresh-access')) {
        return jsonResponse(200, { success: true, data: { user: { _id: 'pm-1' } } });
      }
      return jsonResponse(401, { success: false, message: 'expired' });
    }
    if (href.includes('/api/auth/refresh')) {
      return jsonResponse(200, {
        success: true,
        data: {
          tokens: { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' },
          user: { _id: 'pm-1' }
        }
      });
    }
    return jsonResponse(404, {});
  };

  try {
    const auth = await ensureFreshPmAuth(
      {
        profile: {
          pmCustomerAuth: {
            accessToken: 'stale-access',
            refreshToken: 'refresh-1',
            pmUserId: 'pm-1'
          }
        }
      },
      {}
    );
    assert.equal(auth.accessToken, 'fresh-access');
    assert.equal(auth.refreshToken, 'fresh-refresh');
    assert.equal(auth.refreshed, true);
    assert.equal(auth.pmUserId, 'pm-1');
    assert.equal(auth.hadAnyToken, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('resolvePmAddressAuth does not ask for OTP when refresh succeeds', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes('/api/users/me')) {
      const auth = options?.headers?.Authorization || '';
      if (auth.includes('fresh-access')) {
        return jsonResponse(200, { success: true, data: { user: { _id: 'pm-1' } } });
      }
      return jsonResponse(401, { success: false });
    }
    if (href.includes('/api/auth/refresh')) {
      return jsonResponse(200, {
        success: true,
        data: { tokens: { accessToken: 'fresh-access', refreshToken: 'fresh-refresh' } }
      });
    }
    return jsonResponse(404, {});
  };

  try {
    const auth = await resolvePmAddressAuth(
      {
        phone: '9876543210',
        profile: {
          pmCustomerAuth: {
            accessToken: 'stale-access',
            refreshToken: 'refresh-1',
            pmUserId: 'pm-1'
          }
        }
      },
      {},
      { requireToken: true }
    );
    assert.equal(auth.accessToken, 'fresh-access');
    assert.equal(auth.pmUserId, 'pm-1');
    assert.equal(auth.refreshed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
