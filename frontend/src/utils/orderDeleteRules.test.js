import { describe, expect, it } from 'vitest';
import { canDeleteOrder, getOrderDeleteBlockReason } from './orderDeleteRules';

describe('orderDeleteRules', () => {
  it('allows delete only when delivered and paid', () => {
    expect(canDeleteOrder({ status: 'delivered', paymentStatus: 'paid' })).toBe(true);
    expect(canDeleteOrder({ status: 'delivered', paymentStatus: 'pending' })).toBe(false);
    expect(canDeleteOrder({ status: 'confirmed', paymentStatus: 'paid' })).toBe(false);
    expect(canDeleteOrder({ status: 'confirmed', paymentStatus: 'pending' })).toBe(false);
  });

  it('explains why delete is blocked', () => {
    expect(getOrderDeleteBlockReason({ paymentStatus: 'pending' })).toMatch(/payment is pending/i);
    expect(getOrderDeleteBlockReason({ status: 'confirmed', paymentStatus: 'paid' })).toMatch(
      /delivered and paid/i
    );
    expect(getOrderDeleteBlockReason({ status: 'delivered', paymentStatus: 'paid' })).toBe('');
  });
});
