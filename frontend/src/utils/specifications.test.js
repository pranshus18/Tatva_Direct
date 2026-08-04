import { describe, it, expect } from 'vitest';
import {
  parseSpecificationsForDisplay,
  mergeCatalogAndOfferSpecificationsForDisplay,
  resolveSupplierOfferDisplaySpecifications
} from './specifications.js';

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
});

describe('resolveSupplierOfferDisplaySpecifications', () => {
  it('merges catalog and offer fields on supplier rows', () => {
    const specs = resolveSupplierOfferDisplaySpecifications({
      catalogSpecifications: { MATERIAL: 'Steel' },
      supplierOfferSpecifications: { COLOR: 'Black' }
    });
    expect(specs.MATERIAL).toBe('Steel');
    expect(specs.COLOR).toBe('Black');
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
