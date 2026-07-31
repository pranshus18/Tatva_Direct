import { describe, expect, it } from 'vitest';
import {
  SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE,
  SELECT_YOURSELF_DOCS_REQUIRED_MESSAGE,
  SELECT_YOURSELF_MOV_REQUIRED_MESSAGE,
  SELECT_YOURSELF_ROLE_REQUIRED_MESSAGE,
  getSelectYourselfEntrySaveReadiness,
  validateSelectYourselfChainEntries
} from './supplierSelectYourselfValidation';

describe('validateSelectYourselfChainEntries', () => {
  it('requires role and documents when Step 2 registration started', () => {
    const result = validateSelectYourselfChainEntries([
      {
        id: 'e1',
        brands: 'Titan',
        supplyChainRegistrationStarted: true
      }
    ]);

    expect(result.ok).toBe(false);
    expect(result.message).toBe(SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE);
  });

  it('requires documents when role selected but docs missing', () => {
    const result = validateSelectYourselfChainEntries([
      {
        id: 'e1',
        brands: 'Titan',
        role: 'retailer',
        supplyChainRegistrationStarted: true
      }
    ]);

    expect(result.ok).toBe(false);
    expect(result.message).toBe(SELECT_YOURSELF_DOCS_REQUIRED_MESSAGE);
  });

  it('requires MOV for non-retailer roles', () => {
    const result = validateSelectYourselfChainEntries([
      {
        id: 'e1',
        brands: 'Philips',
        role: 'regional_distributor',
        authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf'],
        supplyChainRegistrationStarted: true
      }
    ]);

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/minimum order value/i);
  });
});

describe('getSelectYourselfEntrySaveReadiness', () => {
  it('disables save when role docs are missing', () => {
    const result = getSelectYourselfEntrySaveReadiness({
      id: 'e1',
      brands: 'Philips',
      role: 'regional_distributor',
      minimumOrderValue: 25000,
      supplyChainRegistrationStarted: true
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('documents');
    expect(result.message).toBe(SELECT_YOURSELF_DOCS_REQUIRED_MESSAGE);
  });

  it('disables save when role is missing', () => {
    const result = getSelectYourselfEntrySaveReadiness({
      id: 'e1',
      brands: 'Philips',
      role: '',
      authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf'],
      supplyChainRegistrationStarted: true
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('role');
    expect(result.message).toBe(SELECT_YOURSELF_ROLE_REQUIRED_MESSAGE);
  });

  it('disables save when MOV is missing for regional distributor', () => {
    const result = getSelectYourselfEntrySaveReadiness({
      id: 'e1',
      brands: 'Philips',
      role: 'regional_distributor',
      authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf'],
      supplyChainRegistrationStarted: true
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toContain('minimumOrderValue');
    expect(result.message).toBe(SELECT_YOURSELF_MOV_REQUIRED_MESSAGE);
  });

  it('enables save when retailer has role and docs', () => {
    const result = getSelectYourselfEntrySaveReadiness({
      id: 'e1',
      brands: 'Philips',
      role: 'retailer',
      authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf'],
      supplyChainRegistrationStarted: true
    });

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('enables save when non-retailer has role, docs, and MOV', () => {
    const result = getSelectYourselfEntrySaveReadiness({
      id: 'e1',
      brands: 'Philips',
      role: 'regional_distributor',
      minimumOrderValue: 25000,
      authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf'],
      supplyChainRegistrationStarted: true
    });

    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
