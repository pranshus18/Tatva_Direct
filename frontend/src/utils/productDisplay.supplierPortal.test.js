import { describe, expect, it } from 'vitest';
import {
  resolveSupplierPortalDisplayDescription,
  supplierPortalHasPublishedDescription
} from './productDisplay.js';

describe('supplier portal product descriptions', () => {
  it('shows only the admin-polished description when published copy exists', () => {
    const product = {
      supplierDescription: 'Specification Value Air Conditioner Type Split Inverter AC',
      publishedDescription:
        'This split inverter air conditioner provides powerful and energy-efficient cooling.'
    };
    expect(resolveSupplierPortalDisplayDescription(product)).toBe(
      'This split inverter air conditioner provides powerful and energy-efficient cooling.'
    );
    expect(supplierPortalHasPublishedDescription(product)).toBe(true);
  });

  it('falls back to supplier draft before admin publishes', () => {
    const product = {
      supplierDescription: 'Raw supplier submission.',
      publishedDescription: ''
    };
    expect(resolveSupplierPortalDisplayDescription(product)).toBe('Raw supplier submission.');
    expect(supplierPortalHasPublishedDescription(product)).toBe(false);
  });
});

describe('discovery product descriptions', () => {
  it('prefers the selected variant description over shared catalog copy', async () => {
    const { resolveDiscoveryProductDescription } = await import('./productDisplay.js');
    const description = resolveDiscoveryProductDescription(
      { description: 'Shared catalog description for the whole family.' },
      {
        publishedDescription: '600 ml vacuum insulated steel bottle.',
        supplierDescription: 'Supplier draft for 600 ml.'
      }
    );
    expect(description).toBe('600 ml vacuum insulated steel bottle.');
  });
});
