import { describe, expect, it } from 'vitest';
import { buildSpecExtractionSourceKey } from './extractSpecificationsApi';

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
