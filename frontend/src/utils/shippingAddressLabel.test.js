import { describe, it, expect } from 'vitest';
import {
  formatShippingAddressLabel,
  formatShippingAddressOptionLabel,
  formatShippingAddressPreview,
  normalizeShippingAddressBookEntry
} from './shippingAddressLabel.js';

describe('shippingAddressLabel', () => {
  it('shows full address when label is only the city name', () => {
    const entry = {
      id: '1',
      label: 'Bengaluru',
      address: {
        line1: '42 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
        country: 'India'
      }
    };
    expect(formatShippingAddressLabel(entry)).toBe(
      '42 MG Road, Bengaluru, Karnataka, 560001, India'
    );
  });

  it('shows label plus full address for distinct site names', () => {
    const entry = {
      id: '2',
      label: 'Warehouse',
      line1: 'Plot 9 Industrial Area',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      country: 'India'
    };
    expect(formatShippingAddressLabel(entry)).toBe(
      'Warehouse — Plot 9 Industrial Area, Pune, Maharashtra, 411001, India'
    );
  });

  it('uses compact option labels for dropdowns', () => {
    const entry = {
      id: '2',
      label: 'Main Branch',
      line1: 'Plot 9 Industrial Area',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      country: 'India'
    };
    expect(formatShippingAddressOptionLabel(entry)).toBe('Main Branch — Pune, Maharashtra');
    expect(formatShippingAddressLabel(entry)).toBe(
      'Main Branch — Plot 9 Industrial Area, Pune, Maharashtra, 411001, India'
    );
  });

  it('normalizes book entries with complete displayName', () => {
    const normalized = normalizeShippingAddressBookEntry({
      id: '3',
      displayName: 'Pune',
      label: 'Pune',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      country: 'India',
      line1: 'Camp Road'
    });
    expect(normalized.displayName).toBe('Camp Road, Pune, Maharashtra, 411001, India');
    expect(formatShippingAddressPreview(normalized)).toContain('Camp Road');
  });
});
