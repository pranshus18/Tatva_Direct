import { describe, expect, it } from 'vitest';
import {
  areBrandNamesExactDuplicates,
  brandKeyForDuplicateCheck,
  findApprovedCatalogBrandMatch,
  findApprovedCatalogBrandSuggestions,
  formatApprovedCatalogBrandMatchMessage,
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

  it('blocks Path B only on exact approved-catalog identity, not partial typing', () => {
    const catalog = [
      { name: 'Sparsh', status: 'approved' },
      { name: 'samsung', status: 'approved' },
      { name: 'Stella', status: 'approved' }
    ];

    expect(findApprovedCatalogBrandMatch('SPARSGA', catalog)).toBeNull();
    expect(findApprovedCatalogBrandMatch('samsun', catalog)).toBeNull();
    expect(findApprovedCatalogBrandMatch('Sparsh', catalog)?.name).toBe('Sparsh');
    expect(findApprovedCatalogBrandMatch('sparsh', catalog)?.matchType).toBe('exact');
    expect(formatApprovedCatalogBrandMatchMessage('Sparsh', 'Sparsh')).toMatch(
      /approved brands list/i
    );
  });

  it('soft-suggests prefix/near-typo brands without treating them as blocking matches', () => {
    const catalog = [
      { name: 'Sparsh', status: 'approved' },
      { name: 'samsung', status: 'approved' }
    ];

    const prefix = findApprovedCatalogBrandSuggestions('sams', catalog);
    expect(prefix.some((row) => row.name === 'samsung' && row.matchType === 'prefix')).toBe(true);

    // "samsun" is a proper prefix of "samsung" (one letter short), so it stays a soft tip.
    const nearComplete = findApprovedCatalogBrandSuggestions('samsun', catalog);
    expect(nearComplete.some((row) => row.name === 'samsung')).toBe(true);
    expect(findApprovedCatalogBrandMatch('samsun', catalog)).toBeNull();

    const singleEdit = findApprovedCatalogBrandSuggestions('samsing', catalog);
    expect(singleEdit.some((row) => row.name === 'samsung' && row.matchType === 'typo')).toBe(true);

    // SPARSGA is not a prefix of Sparsh and is more than one edit away.
    expect(findApprovedCatalogBrandSuggestions('SPARSGA', catalog)).toEqual([]);
  });
});
