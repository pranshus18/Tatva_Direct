import { describe, expect, it } from 'vitest';
import { formatPaymentMethodLabel } from './vaultPaymentMethod';

describe('formatPaymentMethodLabel', () => {
  it('shows Pay later for credit checkout (stored as credit)', () => {
    expect(formatPaymentMethodLabel('credit')).toBe('Pay later');
    expect(formatPaymentMethodLabel('CREDIT')).toBe('Pay later');
    expect(formatPaymentMethodLabel('pay_later')).toBe('Pay later');
  });

  it('keeps other methods readable', () => {
    expect(formatPaymentMethodLabel('vault')).toMatch(/Vault/i);
    expect(formatPaymentMethodLabel('cash')).toBe('Cash on delivery');
    expect(formatPaymentMethodLabel('upi')).toBe('UPI');
  });
});
