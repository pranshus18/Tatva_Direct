import { describe, expect, it } from 'vitest';
import {
  pickPrimaryVariantOption,
  resolveActiveDiscoveryVariant,
  resolveDiscoveryVariantLabel,
  resolveViewerListingForVariant,
  variantMatchesSelections,
  variantSelectionKey
} from './discoveryVariantSelection.js';

describe('discoveryVariantSelection', () => {
  const variants = [
    {
      productId: 'prod-1',
      variantAsin: 'TS1B1H',
      variantKey: 'silver-1000',
      supplierProductId: 'offer-1',
      name: 'Steel Taurus 1L',
      price: 100,
      specifications: { height: '1 l', 'leak-proof': 'no' }
    },
    {
      productId: 'prod-1',
      variantAsin: 'TS1B2N',
      variantKey: 'silver-600',
      supplierProductId: 'offer-2',
      name: 'Steel Taurus 600',
      price: 150,
      specifications: { height: '8 inch', 'leak-proof': 'yes' }
    }
  ];

  it('prefers the mine listing when opening upstream detail from sourcing', () => {
    const active = resolveActiveDiscoveryVariant({
      variants,
      selectedVariantKey: '',
      optionSelections: {},
      urlVariantToken: '',
      mineSupplierProductId: 'mine-2',
      viewerListings: [
        { id: 'mine-1', productId: 'prod-1', variantAsin: 'TS1B1H', price: 4500 },
        { id: 'mine-2', productId: 'prod-1', variantAsin: 'TS1B2N', price: 5200 }
      ]
    });
    expect(active?.variantAsin).toBe('TS1B2N');
  });

  it('prefers the URL variant token over a loose mine productId fallback', () => {
    // Shared catalog id + listing without variant identity used to pick variants[0].
    const active = resolveActiveDiscoveryVariant({
      variants,
      selectedVariantKey: '',
      optionSelections: {},
      urlVariantToken: 'silver-600',
      mineSupplierProductId: 'mine-loose',
      viewerListings: [{ id: 'mine-loose', productId: 'prod-1', price: 5200 }]
    });
    expect(active?.variantKey).toBe('silver-600');
    expect(active?.name).toBe('Steel Taurus 600');
  });

  it('does not guess among multiple variants when mine listing has no variant identity', () => {
    const active = resolveActiveDiscoveryVariant({
      variants,
      selectedVariantKey: '',
      optionSelections: {},
      urlVariantToken: '',
      mineSupplierProductId: 'mine-loose',
      viewerListings: [{ id: 'mine-loose', productId: 'prod-1', price: 5200 }]
    });
    // Falls through to first variant only as last resort (no safe mine match).
    expect(active?.variantAsin).toBe('TS1B1H');
  });

  it('resolves viewer listing by variant identity before mine id', () => {
    const listings = [
      { id: 'mine-1', productId: 'prod-1', variantAsin: 'TS1B1H', price: 4500 },
      { id: 'mine-2', productId: 'prod-1', variantAsin: 'TS1B2N', price: 5200 }
    ];
    expect(resolveViewerListingForVariant(listings, variants[1], 'mine-1')?.price).toBe(5200);
    expect(resolveViewerListingForVariant(listings, variants[0], '')?.price).toBe(4500);
  });

  it('prefers option chip selections over a stale URL variant token', () => {
    const active = resolveActiveDiscoveryVariant({
      variants,
      selectedVariantKey: variantSelectionKey(variants[0]),
      optionSelections: { height: '8 inch' },
      urlVariantToken: 'TS1B1H'
    });
    expect(active?.price).toBe(150);
    expect(active?.variantAsin).toBe('TS1B2N');
  });

  it('matches option values case-insensitively', () => {
    expect(
      variantMatchesSelections(variants[1], { height: '8 inch', 'leak-proof': 'Yes' })
    ).toBe(true);
    expect(variantMatchesSelections(variants[0], { height: '1 L' })).toBe(true);
  });

  it('falls back to explicit variant key when no option selections are active', () => {
    const active = resolveActiveDiscoveryVariant({
      variants,
      selectedVariantKey: variantSelectionKey(variants[1]),
      optionSelections: {},
      urlVariantToken: 'TS1B1H'
    });
    expect(active?.price).toBe(150);
  });

  it('does not fall through to the first variant when option chips form an impossible combo', () => {
    const active = resolveActiveDiscoveryVariant({
      variants,
      selectedVariantKey: variantSelectionKey(variants[0]),
      optionSelections: { height: '8 inch', 'leak-proof': 'no' },
      urlVariantToken: 'TS1B1H'
    });
    expect(active).toBeNull();
  });

  it('matches option keys regardless of punctuation/spacing', () => {
    expect(
      variantMatchesSelections(variants[1], { 'Leak Proof': 'yes', Height: '8 inch' })
    ).toBe(true);
  });
});

describe('pickPrimaryVariantOption', () => {
  it('prefers color over capacity, height, and material', () => {
    const primary = pickPrimaryVariantOption([
      { key: 'height', label: 'Height', values: ['27 cm', '600ml'] },
      { key: 'capacity', label: 'Capacity', values: ['1 L', '500ML'] },
      { key: 'color', label: 'Color', values: ['black', 'blue', 'Silver'] },
      { key: 'material', label: 'Material', values: ['Stainless Steel', 'Steel 304'] }
    ]);
    expect(primary).toHaveLength(1);
    expect(primary[0].key).toBe('color');
  });

  it('returns the only option when just one selector exists', () => {
    const primary = pickPrimaryVariantOption([
      { key: 'capacity', label: 'Capacity', values: ['1 L', '500ML'] }
    ]);
    expect(primary).toEqual([
      { key: 'capacity', label: 'Capacity', values: ['1 L', '500ML'] }
    ]);
  });

  it('falls back to the option with the most values when no priority key matches', () => {
    const primary = pickPrimaryVariantOption([
      { key: 'finish', label: 'Finish', values: ['Matte'] },
      { key: 'edition', label: 'Edition', values: ['Standard', 'Pro', 'Max'] }
    ]);
    expect(primary[0].key).toBe('edition');
  });
});

describe('resolveDiscoveryVariantLabel', () => {
  it('builds labels from variantOptions keys in order', () => {
    const label = resolveDiscoveryVariantLabel(
      {
        variantAsin: 'TS1B2N',
        specifications: { height: '8 inch', 'leak-proof': 'yes' }
      },
      [
        { key: 'height', label: 'Height' },
        { key: 'leak-proof', label: 'Leak proof' }
      ]
    );
    expect(label).toBe('8 inch · yes');
  });

  it('falls back to variantAsin when no option values resolve', () => {
    expect(
      resolveDiscoveryVariantLabel({ variantAsin: 'TS1B2N', specifications: {} }, [])
    ).toBe('TS1B2N');
  });

  it('falls back to variantName when asin is missing', () => {
    expect(
      resolveDiscoveryVariantLabel({ variantName: 'Large red', specifications: {} }, [])
    ).toBe('Large red');
  });
});
