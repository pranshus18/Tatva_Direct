import { describe, expect, it } from 'vitest';
import {
  canAdvanceOrderStatus,
  getAllowedOrderStatusTransitions,
  getSelectableOrderStatusOptions,
  isValidOrderStatusTransition
} from './orderStatusTransitions';

describe('orderStatusTransitions', () => {
  it('only offers the next sequential status and cancel', () => {
    expect(getAllowedOrderStatusTransitions('processing')).toEqual(['shipped', 'cancelled']);
    expect(getSelectableOrderStatusOptions('processing').map((option) => option.value)).toEqual([
      'processing',
      'shipped',
      'cancelled'
    ]);
  });

  it('hides previously completed and skipped statuses', () => {
    const values = getSelectableOrderStatusOptions('shipped').map((option) => option.value);
    expect(values).not.toContain('pending');
    expect(values).not.toContain('confirmed');
    expect(values).not.toContain('processing');
    expect(values).toEqual(['shipped', 'delivered', 'cancelled']);
  });

  it('rejects backward and skipped transitions', () => {
    expect(isValidOrderStatusTransition('processing', 'confirmed')).toBe(false);
    expect(isValidOrderStatusTransition('pending', 'delivered')).toBe(false);
    expect(isValidOrderStatusTransition('processing', 'shipped')).toBe(true);
    expect(canAdvanceOrderStatus('delivered')).toBe(false);
  });

  it('rejects every status change once an order is cancelled', () => {
    expect(isValidOrderStatusTransition('cancelled', 'pending')).toBe(false);
    expect(isValidOrderStatusTransition('cancelled', 'cancelled')).toBe(false);
    expect(isValidOrderStatusTransition('canceled', 'confirmed')).toBe(false);
    expect(canAdvanceOrderStatus('cancelled')).toBe(false);
    expect(getSelectableOrderStatusOptions('cancelled').map((option) => option.value)).toEqual([
      'cancelled'
    ]);
  });
});
