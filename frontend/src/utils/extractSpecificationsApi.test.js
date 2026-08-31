import { describe, expect, it } from 'vitest';
import {
  applyExtractResultToSpecs,
  buildSpecExtractionSourceKey,
  formatSpecExtractSuccessMessage,
  SPEC_EXTRACT_NO_VALUES
} from './extractSpecificationsApi';

describe('buildSpecExtractionSourceKey', () => {
  it('is stable for equivalent whitespace/casing', () => {
    const a = buildSpecExtractionSourceKey({
      name: 'HP Printer',
      category: 'Printers',
      brand: 'HP',
      description: 'Laser printer  for office use.'
    });
    const b = buildSpecExtractionSourceKey({
      name: 'hp printer',
      category: 'printers',
      brand: 'hp',
      description: 'Laser printer for office use.'
    });
    expect(a).toBe(b);
  });

  it('changes when description changes', () => {
    const base = {
      name: 'HP Printer',
      category: 'printers',
      brand: 'HP',
      description: 'Laser printer'
    };
    expect(buildSpecExtractionSourceKey(base)).not.toBe(
      buildSpecExtractionSourceKey({ ...base, description: 'Laser printer with duplex' })
    );
  });
});

describe('applyExtractResultToSpecs', () => {
  it('maps narrative extraction onto empty template keys', () => {
    const result = applyExtractResultToSpecs(
      { BRAND: '', COLOR: '', SERIES: '', WEIGHT: '' },
      {
        status: 'success',
        specifications: {
          BRAND: 'Jaquar',
          COLOR: 'White',
          SERIES: 'Continental',
          WEIGHT: '17.5 kg',
          Material: 'Vitreous China'
        }
      }
    );
    expect(result.ok).toBe(true);
    expect(result.filledCount).toBe(5);
    expect(result.merged.BRAND).toBe('Jaquar');
    expect(result.merged.COLOR).toBe('White');
    expect(result.merged.Material).toBe('Vitreous China');
  });

  it('does not overwrite locked filled values and ignores extra keys', () => {
    const result = applyExtractResultToSpecs(
      { BRAND: 'Jaquar', COLOR: 'White', SERIES: 'Continental', WEIGHT: '17.5 kg' },
      {
        status: 'success',
        specifications: {
          BRAND: 'Other',
          COLOR: 'Ivory',
          Material: 'Vitreous China'
        }
      },
      { preserveFilled: true }
    );
    expect(result.ok).toBe(true);
    expect(result.filledCount).toBe(0);
    expect(result.merged).toEqual({
      BRAND: 'Jaquar',
      COLOR: 'White',
      SERIES: 'Continental',
      WEIGHT: '17.5 kg'
    });
  });

  it('reports zero newly filled values when the description adds nothing new', () => {
    const result = applyExtractResultToSpecs(
      { COLOR: 'White', WEIGHT: '17.5 kg' },
      { status: 'success', specifications: { COLOR: 'White', WEIGHT: '17.5 kg' } }
    );
    expect(result.ok).toBe(true);
    expect(result.filledCount).toBe(0);
    expect(SPEC_EXTRACT_NO_VALUES).toMatch(/colour, size, material, weight/i);
    expect(formatSpecExtractSuccessMessage(2)).toBe(
      'Specifications extracted. 2 values were filled from the description.'
    );
  });
});
