import { describe, expect, it } from 'vitest';
import {
  SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE,
  SELECT_YOURSELF_DOCS_REQUIRED_MESSAGE,
  SELECT_YOURSELF_MOV_REQUIRED_MESSAGE,
  SELECT_YOURSELF_ROLE_REQUIRED_MESSAGE,
  entryMatchesSavedBaseline,
  getSelectYourselfEntrySaveReadiness,
  getSelectYourselfEntrySaveState,
  validateSelectYourselfChainEntries,
  isEntrySupplyChainOnboardingComplete,
  getActiveApprovedRoleForEntry
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

describe('getSelectYourselfEntrySaveState', () => {
  const savedBaselineEntries = [
    {
      id: 'e1',
      brands: 'acc',
      role: 'retailer',
      authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf']
    }
  ];

  it('disables save when entry matches the saved baseline', () => {
    const state = getSelectYourselfEntrySaveState(
      {
        id: 'e1',
        brands: 'acc',
        role: 'retailer',
        authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf']
      },
      savedBaselineEntries,
      savedBaselineEntries
    );

    expect(state.ok).toBe(true);
    expect(state.alreadySaved).toBe(true);
    expect(state.enabled).toBe(false);
  });

  it('re-enables save when the entry changes after save', () => {
    const entry = {
      id: 'e1',
      brands: 'acc',
      role: 'retailer',
      authorizationCertificateUrls: ['https://cdn.example.com/new-doc.pdf']
    };
    const state = getSelectYourselfEntrySaveState(entry, savedBaselineEntries, savedBaselineEntries);

    expect(state.ok).toBe(true);
    expect(entryMatchesSavedBaseline(entry, savedBaselineEntries)).toBe(false);
    expect(state.alreadySaved).toBe(false);
    expect(state.enabled).toBe(true);
  });

  it('enables save for an approved role change even before all fields are complete', () => {
    const state = getSelectYourselfEntrySaveState(
      {
        id: 'e1',
        brands: 'acc',
        role: 'dealer',
        authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf']
      },
      savedBaselineEntries,
      savedBaselineEntries,
      'retailer'
    );

    expect(state.ok).toBe(false);
    expect(state.pendingApprovedRoleChange).toBe(true);
    expect(state.enabled).toBe(true);
  });
});

describe('completed onboarding role lock helpers', () => {
  const completeEntry = {
    id: 'e1',
    brands: 'acc',
    role: 'dealer',
    authorizationCertificateUrls: ['https://cdn.example.com/doc.pdf'],
    minimumOrderValue: 25000
  };
  const profile = { chainProfileApprovalStatus: 'approved' };

  it('detects a saved, approved supply-chain entry as onboarding complete', () => {
    expect(isEntrySupplyChainOnboardingComplete(completeEntry, profile, [completeEntry])).toBe(true);
  });

  it('returns the active approved role for a completed entry', () => {
    expect(
      getActiveApprovedRoleForEntry(completeEntry, profile, [completeEntry], [completeEntry])
    ).toBe('dealer');
  });

  it('uses baseline role while a profile change is pending approval', () => {
    const pendingProfile = { chainProfileApprovalStatus: 'pending' };
    const baseline = [{ ...completeEntry, role: 'retailer' }];
    expect(
      getActiveApprovedRoleForEntry(
        { ...completeEntry, role: 'dealer' },
        pendingProfile,
        baseline,
        baseline
      )
    ).toBe('retailer');
  });
});
