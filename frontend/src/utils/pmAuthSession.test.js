/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyPmAuthFromResponse,
  applyPmVaultCredentials,
  clearPmCustomerCredentials,
  getPmCustomerCredentials
} from './pmAuthSession';

afterEach(() => {
  clearPmCustomerCredentials();
});

describe('PM credential persistence', () => {
  it('stores rotated tokens from response headers', () => {
    const headers = new Headers({
      'X-PM-Access-Token': 'new-access',
      'X-PM-Refresh-Token': 'new-refresh',
      'X-PM-User-Id': 'pm-99'
    });
    applyPmAuthFromResponse({ headers });
    expect(getPmCustomerCredentials()).toEqual({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      pmUserId: 'pm-99'
    });
  });

  it('stores pmVault payloads that only include a refresh token', () => {
    applyPmVaultCredentials({ refreshToken: 'r-only', pmUserId: 'pm-1' });
    expect(getPmCustomerCredentials().refreshToken).toBe('r-only');
    expect(getPmCustomerCredentials().pmUserId).toBe('pm-1');
  });
});
