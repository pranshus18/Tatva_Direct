import { describe, expect, it } from 'vitest';
import {
  SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE,
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
    expect(result.message).toBe(SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE);
  });
});
