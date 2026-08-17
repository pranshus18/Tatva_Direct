import { describe, expect, it } from 'vitest';
import { sumOrderItemQuantities } from './orderItemQuantity';

describe('sumOrderItemQuantities', () => {
  it('uses quantity, not product-row count', () => {
    expect(sumOrderItemQuantities([{ quantity: 2 }])).toBe(2);
    expect(sumOrderItemQuantities([{ quantity: 2 }, { quantity: 3 }])).toBe(5);
  });

  it('ignores invalid and empty rows', () => {
    expect(sumOrderItemQuantities([])).toBe(0);
    expect(sumOrderItemQuantities(null)).toBe(0);
    expect(sumOrderItemQuantities([{ quantity: 0 }, { quantity: -1 }, {}])).toBe(0);
  });
});
