import { describe, expect, it } from 'vitest';
import {
  resolvePmApiEnv,
  remapPmUrlToEnv,
  resolvePmBaseUrl,
  withPmPlatformFlagQuery,
  PM_USERS_HOST_BY_ENV,
  PM_API_CATALOG,
  PM_SEND_OTP_URL,
  PM_VERIFY_GST_URL,
  PM_VENDOR_LEADS_URL,
  PM_VAULT_URL,
  PM_VAULT_TOPUP_INITIATE_URL,
  PM_VAULT_PAY_ORDER_URL,
  PM_API_ENV,
  PM_USERS_HOST,
  PM_PAYMENT_HOST
} from './pmAuth';

describe('resolvePmApiEnv', () => {
  it('uses the Tatva prod hostname for opsapi even if VITE_PM_API_ENV=dev', () => {
    expect(resolvePmApiEnv('dev', 'development', 'direct.withtatva.ai')).toBe('production');
  });

  it('uses the Vercel dev hostname for devopsapi even if VITE_PM_API_ENV=production', () => {
    expect(resolvePmApiEnv('production', 'production', 'tatva-direct-frontend-five.vercel.app')).toBe(
      'development'
    );
  });

  it('keeps devopsapi for local development', () => {
    expect(resolvePmApiEnv('dev', 'development', 'localhost')).toBe('development');
    expect(resolvePmApiEnv('', 'development', '')).toBe('development');
  });

  it('lets an explicit env win when the hostname is unknown', () => {
    expect(resolvePmApiEnv('production', 'development', '')).toBe('production');
    expect(resolvePmApiEnv('dev', 'production', '')).toBe('development');
  });
});

describe('remapPmUrlToEnv', () => {
  it('rewrites leftover devopsapi URLs in production builds', () => {
    expect(remapPmUrlToEnv('https://devopsapi.withtatva.ai/users', 'production')).toBe(
      'https://opsapi.withtatva.ai/users'
    );
  });

  it('rewrites leftover opsapi URLs in development', () => {
    expect(remapPmUrlToEnv('https://opsapi.withtatva.ai/payment', 'development')).toBe(
      'https://devopsapi.withtatva.ai/payment'
    );
  });
});

describe('resolvePmBaseUrl', () => {
  it('drops stale devopsapi overrides in production', () => {
    expect(
      resolvePmBaseUrl(
        'https://devopsapi.withtatva.ai/users',
        PM_USERS_HOST_BY_ENV.production,
        'production'
      )
    ).toBe(PM_USERS_HOST_BY_ENV.production);
  });
});

describe('PM catalog and active URLs', () => {
  it('keeps identical paths on devopsapi and opsapi', () => {
    for (const key of Object.keys(PM_API_CATALOG.development)) {
      expect(PM_API_CATALOG.production[key].replace('opsapi.withtatva.ai', 'devopsapi.withtatva.ai')).toBe(
        PM_API_CATALOG.development[key]
      );
    }
  });

  it('derives live URLs from the selected env hosts', () => {
    const expectedMarker =
      PM_API_ENV === 'production' ? '://opsapi.withtatva.ai' : '://devopsapi.withtatva.ai';
    const urls = [
      PM_SEND_OTP_URL,
      PM_VERIFY_GST_URL,
      PM_VENDOR_LEADS_URL,
      PM_VAULT_URL,
      PM_VAULT_TOPUP_INITIATE_URL,
      PM_VAULT_PAY_ORDER_URL,
      PM_USERS_HOST,
      PM_PAYMENT_HOST
    ];
    for (const url of urls) {
      if (String(url).startsWith('/')) continue;
      expect(url).toContain(expectedMarker);
    }
  });

  it('appends tatvadirect flag to relative and absolute PM URLs', () => {
    expect(withPmPlatformFlagQuery('/pm-users/api/vault')).toBe('/pm-users/api/vault?flag=tatvadirect');
    expect(withPmPlatformFlagQuery('https://opsapi.withtatva.ai/users/api/users/verify-gst')).toContain(
      'flag=tatvadirect'
    );
  });
});
