import { describe, it, expect } from 'vitest';
import {
  parseSpecificationsForDisplay,
  mergeCatalogAndOfferSpecificationsForDisplay,
  resolveSupplierOfferDisplaySpecifications,
  specificationEntriesForCustomerDisplay
} from './specifications.js';

describe('mergeExtractedValuesOntoSpecificationTemplate', () => {
  it('maps extracted values onto admin template keys case-insensitively', async () => {
    const { mergeExtractedValuesOntoSpecificationTemplate } = await import('./specifications.js');
    const merged = mergeExtractedValuesOntoSpecificationTemplate(
      { 'AIR CONDITIONER TYPE': '', COLOR: '' },
      { 'Air Conditioner Type': 'Split', color: 'White' }
    );
    expect(merged['AIR CONDITIONER TYPE']).toBe('Split');
    expect(merged.COLOR).toBe('White');
  });

  it('matches admin keys with different spacing and punctuation', async () => {
    const { mergeExtractedValuesOntoSpecificationTemplate } = await import('./specifications.js');
    const merged = mergeExtractedValuesOntoSpecificationTemplate(
      { 'COOLING CAPACITY ( TONS )': '', 'STAR RATING': '' },
      { 'Cooling Capacity (Tons)': '1.5', 'Star Rating': '5' }
    );
    expect(merged['COOLING CAPACITY ( TONS )']).toBe('1.5');
    expect(merged['STAR RATING']).toBe('5');
  });
});

describe('mergeCatalogAndOfferSpecificationsForDisplay', () => {
  it('keeps admin catalog values when offer placeholders are empty', () => {
    const merged = mergeCatalogAndOfferSpecificationsForDisplay(
      { COLOR: 'Red', CAPACITY: '600 ml' },
      { COLOR: '', CAPACITY: '' }
    );
    expect(merged.COLOR).toBe('Red');
    expect(merged.CAPACITY).toBe('600 ml');
  });

  it('prefers filled variant offer values over shared catalog values', () => {
    const merged = mergeCatalogAndOfferSpecificationsForDisplay(
      { COLOR: 'Red', CAPACITY: '600 ml' },
      { COLOR: 'Blue', CAPACITY: '750 ml' }
    );
    expect(merged.COLOR).toBe('Blue');
    expect(merged.CAPACITY).toBe('750 ml');
  });

  it('dedupes keys that differ only by casing or spacing', () => {
    const merged = mergeCatalogAndOfferSpecificationsForDisplay(
      { Color: 'Silver', 'B P A Free': 'Yes', Height: '1 l' },
      { color: 'silver', 'bpa-free': 'yes', height: '600 ml' }
    );
    expect(Object.keys(merged)).toHaveLength(3);
    expect(merged.height).toBe('600 ml');
    expect(merged.color).toBe('silver');
  });
});

describe('resolveSupplierOfferDisplaySpecifications', () => {
  it('uses catalog template keys and per-variant offer values without cross-variant bleed', () => {
    const specs = resolveSupplierOfferDisplaySpecifications({
      catalogSpecifications: { MATERIAL: 'Steel', COLOR: 'Silver' },
      supplierOfferSpecifications: { COLOR: 'Black' }
    });
    expect(specs.COLOR).toBe('Black');
    expect(specs.MATERIAL).toBe('');
  });
});

describe('specificationEntriesForCustomerDisplay', () => {
  it('excludes supplier and published description fields from buyer-facing spec lists', () => {
    const entries = specificationEntriesForCustomerDisplay({
      Color: 'Silver',
      Height: '600 ml',
      supplierDescription: 'The STEEL TAURUS 600 is a durable steel bottle designed for reliable hydration.',
      publishedDescription: 'Polished buyer-facing copy.',
      description: 'Legacy description field.'
    });
    const labels = entries.map((entry) => entry.label.toLowerCase());
    expect(labels).toContain('color');
    expect(labels).toContain('height');
    expect(labels).not.toContain('supplier description');
    expect(labels).not.toContain('published description');
    expect(labels).not.toContain('description');
  });
});

describe('parseSpecificationsForDisplay', () => {
  it('hides internal identity bundle from order line-item chips', () => {
    const specs = {
      identity: {
        catalog: { name: 'mac air m1', category: 'laptop', brand: 'apple', gtin: '23546753846473' },
        catalogKey: '0414904c0119837475e7f334de1f67c1394057d37f7a48a187451569fb5be691',
        variantKey: 'cc184adc5078b56493ce6f3a27694727067236a8acd8756707dfaf73f5ce6604',
        matchSignals: { hasGtin: true, hasMpn: true, hasSerial: true }
      },
      cityCode: 'Pun-840',
      serialNumber: 'SN-04'
    };

    const entries = parseSpecificationsForDisplay(specs);
    const labels = entries.map((entry) => entry.label.toLowerCase());

    expect(labels).not.toContain('identity');
    expect(labels).not.toContain('catalog key');
    expect(labels).not.toContain('match signals');
    expect(labels).toContain('city code');
    expect(labels).toContain('serial number');
  });
});

describe('hasSupplierSpecificationChangesFromBaseline', () => {
  it('detects changed values against catalog baseline', async () => {
    const { hasSupplierSpecificationChangesFromBaseline } = await import('./specifications.js');
    expect(
      hasSupplierSpecificationChangesFromBaseline(
        { ram: '8GB', storage: '256GB' },
        { ram: '16GB', storage: '256GB' }
      )
    ).toBe(true);
  });

  it('treats matching baseline values as unchanged', async () => {
    const { hasSupplierSpecificationChangesFromBaseline } = await import('./specifications.js');
    expect(
      hasSupplierSpecificationChangesFromBaseline(
        { ram: '8GB' },
        { ram: '8gb' }
      )
    ).toBe(false);
  });
});
