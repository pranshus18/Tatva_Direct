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

  it('does not treat short partials / acronym fragments as the same brand', () => {
    expect(areBrandNamesExactDuplicates('AB', 'ABB')).toBe(false);
    expect(areBrandNamesExactDuplicates('ES', 'ESS')).toBe(false);
    expect(brandKeyForDuplicateCheck('AB')).not.toBe(brandKeyForDuplicateCheck('ABB'));
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

  it('treats Philips / Phillips spelling variants as different brands', () => {
    expect(areBrandNamesExactDuplicates('Philips', 'Phillips')).toBe(false);
  });

  it('blocks Path B only on exact approved catalog spelling', () => {
    const catalog = [
      { name: 'Sparsh', status: 'approved' },
      { name: 'samsung', status: 'approved' },
      { name: 'Stella', status: 'approved' },
      { name: 'ABB', status: 'approved' },
      { name: 'Phillips', status: 'approved' },
      { name: 'Fastrack', status: 'approved' }
    ];

    expect(findApprovedCatalogBrandMatch('SPARSGA', catalog)).toBeNull();
    expect(findApprovedCatalogBrandMatch('sam', catalog)).toBeNull();
    expect(findApprovedCatalogBrandMatch('AB', catalog)).toBeNull();
    expect(findApprovedCatalogBrandMatch('samsun', catalog)).toBeNull();
    expect(findApprovedCatalogBrandMatch('Faststark', catalog)).toBeNull();
    expect(findApprovedCatalogBrandMatch('Sparsh', catalog)?.name).toBe('Sparsh');
    expect(findApprovedCatalogBrandMatch('sparsh', catalog)?.matchType).toBe('exact');
    expect(findApprovedCatalogBrandMatch('Philips', catalog)).toBeNull();
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

    // Incomplete shorter prefix stays a soft tip (not yet a catalog match).
    expect(findApprovedCatalogBrandMatch('sams', catalog)).toBeNull();

    // Single-edit of a complete brand is a new brand; it may still get a typo suggestion.
    expect(findApprovedCatalogBrandMatch('samsing', catalog)).toBeNull();
    expect(findApprovedCatalogBrandSuggestions('samsing', catalog).some((row) => row.name === 'samsung')).toBe(
      true
    );

    // SPARSGA is not a prefix of Sparsh and is more than one edit away.
    expect(findApprovedCatalogBrandSuggestions('SPARSGA', catalog)).toEqual([]);
  });

  it('does not treat longer distinct brands as the approved shorter brand (pran ≠ pransh)', () => {
    const catalog = [{ name: 'pran', status: 'approved' }];

    expect(areBrandNamesExactDuplicates('pran', 'pransh')).toBe(false);
    expect(brandKeyForDuplicateCheck('pran')).not.toBe(brandKeyForDuplicateCheck('pransh'));
    expect(findApprovedCatalogBrandMatch('pransh', catalog)).toBeNull();
    expect(findApprovedCatalogBrandMatch('prans', catalog)).toBeNull();
    expect(findApprovedCatalogBrandMatch('pran', catalog)?.name).toBe('pran');

    // Incomplete typing may soft-suggest the shorter approved brand without blocking.
    const tip = findApprovedCatalogBrandSuggestions('pra', catalog);
    expect(tip.some((row) => row.name === 'pran')).toBe(true);
    expect(findApprovedCatalogBrandMatch('pra', catalog)).toBeNull();
  });
});
