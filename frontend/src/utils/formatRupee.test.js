import { describe, expect, it } from 'vitest';
import { lineMoneyTotal, parseMoney, roundMoney } from './formatRupee';
import { resolveDiscoveryDisplayPricing } from './discoveryPricing';

describe('money rounding', () => {
  it('rounds unit × qty to paise', () => {
    expect(lineMoneyTotal(19.99, 3)).toBe(59.97);
    expect(roundMoney(10.1 * 3)).toBe(30.3);
  });

  it('parses Indian grouped rupee strings', () => {
    expect(parseMoney('1,250.50')).toBe(1250.5);
    expect(parseMoney('₹9,000')).toBe(9000);
  });
});

describe('resolveDiscoveryDisplayPricing', () => {
  it('does not show a strikethrough when COV is not cheaper than MRP', () => {
    const locked = resolveDiscoveryDisplayPricing({
      price: 10000,
      mrp: 10000,
      bcovApplied: true
    });
    expect(locked.bcovApplied).toBe(false);
    expect(locked.price).toBe(10000);
  });

  it('shows COV price and MRP when unlocked below list price', () => {
    const unlocked = resolveDiscoveryDisplayPricing({
      price: 8500,
      mrp: 10000,
      bcovApplied: true
    });
    expect(unlocked.bcovApplied).toBe(true);
    expect(unlocked.price).toBe(8500);
    expect(unlocked.mrp).toBe(10000);
  });
});
