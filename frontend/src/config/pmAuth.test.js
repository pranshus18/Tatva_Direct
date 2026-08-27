import { describe, expect, it } from 'vitest';
import {
  resolvePmApiEnv,
  remapPmUrlToEnv,
  resolvePmBaseUrl,
  PM_USERS_HOST_BY_ENV
} from './pmAuth';

describe('resolvePmApiEnv', () => {
  it('uses opsapi for production Vite builds even if VITE_PM_API_ENV=dev is leftover', () => {
    expect(resolvePmApiEnv('dev', 'production')).toBe('production');
    expect(resolvePmApiEnv('', 'production')).toBe('production');
  });

  it('keeps devopsapi for local development', () => {
    expect(resolvePmApiEnv('dev', 'development')).toBe('development');
    expect(resolvePmApiEnv('', 'development')).toBe('development');
  });

  it('lets local development opt into production PM APIs', () => {
    expect(resolvePmApiEnv('production', 'development')).toBe('production');
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
