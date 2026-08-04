import { describe, it, expect } from 'vitest';
import { dedupeLabelsCaseInsensitive, dedupeCategoryStrings } from './categoryNormalize.js';

describe('categoryNormalize', () => {
  it('dedupes labels that differ only by casing', () => {
    const merged = dedupeLabelsCaseInsensitive([
      { value: 'flasks & bottles', label: 'flasks & bottles' },
      { value: 'Flasks & Bottles', label: 'Flasks & Bottles' }
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].value).toBe('flasks & bottles');
  });

  it('dedupes raw category strings', () => {
    expect(dedupeCategoryStrings(['Steel', 'steel', 'Cement'])).toEqual(['Cement', 'Steel']);
  });
});
