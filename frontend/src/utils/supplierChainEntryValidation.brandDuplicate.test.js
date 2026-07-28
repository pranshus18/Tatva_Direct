import { describe, expect, it } from 'vitest';
import {
  areBrandNamesExactDuplicates,
  brandKeyForDuplicateCheck,
  validateUniqueBrandsAcrossEntries
} from './supplierChainEntryValidation';

describe('brand duplicate matching', () => {
  it('uses complete brand names — H is not a duplicate of HP', () => {
    expect(brandKeyForDuplicateCheck('H')).not.toBe(brandKeyForDuplicateCheck('HP'));
    expect(areBrandNamesExactDuplicates('H', 'HP')).toBe(false);
    expect(
      validateUniqueBrandsAcrossEntries([
        { id: 'e1', brands: 'HP' },
        { id: 'e2', brands: 'H' }
      ]).ok
    ).toBe(true);
  });

  it('flags the same complete brand name regardless of case', () => {
    expect(areBrandNamesExactDuplicates('HP', 'hp')).toBe(true);
    expect(
      validateUniqueBrandsAcrossEntries([
        { id: 'e1', brands: 'HP' },
        { id: 'e2', brands: 'hp' }
      ]).ok
    ).toBe(false);
  });

  it('still treats Philips / Phillips spelling variants as the same brand', () => {
    expect(areBrandNamesExactDuplicates('Philips', 'Phillips')).toBe(true);
  });

  it('matches approved catalog brands including near-typos like samsun → samsung', async () => {
    const { findApprovedCatalogBrandMatch, formatApprovedCatalogBrandMatchMessage } = await import(
      './supplierChainEntryValidation'
    );
    const match = findApprovedCatalogBrandMatch('samsun', [
      { name: 'samsung', status: 'approved' },
      { name: 'Stella', status: 'approved' }
    ]);
    expect(match?.name).toBe('samsung');
    expect(match?.matchType).toMatch(/prefix|typo/);
    expect(formatApprovedCatalogBrandMatchMessage('samsun', 'samsung')).toMatch(
      /approved brands list/i
    );
  });
});
