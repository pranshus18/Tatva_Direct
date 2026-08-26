import { describe, expect, it } from 'vitest';
import { excludeCancelledBoqItems } from './boqCancelledItems';

describe('excludeCancelledBoqItems', () => {
  it('drops cancelled ids and keeps the rest', () => {
    const items = [
      { id: 'a', normalizedName: 'Cement A' },
      { id: 'b', normalizedName: 'Cement B' },
      { id: 'c', normalizedName: 'Cement C' }
    ];
    const kept = excludeCancelledBoqItems(items, null, new Set(['b']));
    expect(kept.map((item) => item.id)).toEqual(['a', 'c']);
  });
});
