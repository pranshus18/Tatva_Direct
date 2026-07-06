import { describe, it, expect } from 'vitest';
import {
  buildStableReservationLineSignature,
  getReservationSecondsRemaining,
  parseReservationExpiresAt
} from './checkoutReservation.js';

describe('buildStableReservationLineSignature', () => {
  it('is identical regardless of line order', () => {
    const linesA = [
      { supplierProductId: 'sp-1', supplierId: 'sup-1', quantity: 2 },
      { supplierProductId: 'sp-2', supplierId: 'sup-1', quantity: 1 }
    ];
    const linesB = [
      { supplierProductId: 'sp-2', supplierId: 'sup-1', quantity: 1 },
      { supplierProductId: 'sp-1', supplierId: 'sup-1', quantity: 2 }
    ];
    expect(buildStableReservationLineSignature(linesA)).toEqual(
      buildStableReservationLineSignature(linesB)
    );
  });

  it('changes when a quantity actually changes', () => {
    const before = [{ supplierProductId: 'sp-1', supplierId: 'sup-1', quantity: 2 }];
    const after = [{ supplierProductId: 'sp-1', supplierId: 'sup-1', quantity: 3 }];
    expect(buildStableReservationLineSignature(before)).not.toEqual(
      buildStableReservationLineSignature(after)
    );
  });

  it('changes when a line is added or removed', () => {
    const before = [{ supplierProductId: 'sp-1', supplierId: 'sup-1', quantity: 2 }];
    const after = [
      { supplierProductId: 'sp-1', supplierId: 'sup-1', quantity: 2 },
      { supplierProductId: 'sp-2', supplierId: 'sup-1', quantity: 1 }
    ];
    expect(buildStableReservationLineSignature(before)).not.toEqual(
      buildStableReservationLineSignature(after)
    );
  });
});

describe('reservation expiry parsing/countdown', () => {
  it('treats a timestamp without timezone suffix as UTC', () => {
    const parsed = parseReservationExpiresAt('2026-06-26T10:30:45.844');
    expect(parsed.toISOString()).toEqual('2026-06-26T10:30:45.844Z');
  });

  it('reports seconds remaining for a future expiry, not already expired', () => {
    const future = new Date(Date.now() + 3 * 60 * 1000).toISOString();
    const seconds = getReservationSecondsRemaining(future);
    expect(seconds).toBeGreaterThan(170);
    expect(seconds).toBeLessThanOrEqual(180);
  });

  it('reports 0 seconds remaining once truly past expiry', () => {
    const past = new Date(Date.now() - 5000).toISOString();
    expect(getReservationSecondsRemaining(past)).toBe(0);
  });
});
