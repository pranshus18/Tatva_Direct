import { describe, expect, it } from 'vitest';
import {
  collectUnavailableSourcingMineIds,
  dropUnavailableFromSelection
} from './upstreamSourcingAvailability';

describe('collectUnavailableSourcingMineIds', () => {
  it('marks suggestion rows that have no eligible upstream offers', () => {
    const unavailable = collectUnavailableSourcingMineIds(
      [
        {
          mineSupplierProductId: 'mouse-1',
          upstreamOffers: [],
          message: 'No upstream offers found from Dealers for "HP".'
        },
        {
          mineSupplierProductId: 'phone-1',
          upstreamOffers: [{ upstreamSupplierProductId: 'offer-1' }]
        }
      ],
      (item) => (Array.isArray(item.upstreamOffers) ? item.upstreamOffers.length : 0)
    );

    expect(unavailable['mouse-1']).toMatch(/No upstream offers found/);
    expect(unavailable['phone-1']).toBeUndefined();
  });

  it('uses the compatible-offer count so variant mismatches are also unavailable', () => {
    const unavailable = collectUnavailableSourcingMineIds(
      [{ mineSupplierProductId: 'listed-1', upstreamOffers: [{ upstreamSupplierProductId: 'other-variant' }] }],
      () => 0
    );
    expect(unavailable['listed-1']).toBeTruthy();
  });
});

describe('dropUnavailableFromSelection', () => {
  it('removes unavailable products from the selected sourcing set', () => {
    const next = dropUnavailableFromSelection(
      { 'mouse-1': 2, 'phone-1': 1 },
      { 'mouse-1': 'No upstream offers found from Dealers for "HP".' }
    );
    expect(next).toEqual({ 'phone-1': 1 });
  });

  it('returns the same object when nothing is unavailable', () => {
    const selected = { 'phone-1': 1 };
    expect(dropUnavailableFromSelection(selected, {})).toBe(selected);
  });
});
