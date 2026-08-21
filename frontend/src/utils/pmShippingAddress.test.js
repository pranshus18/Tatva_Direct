import { describe, it, expect } from 'vitest';
import {
  applyPincodeLookupToForm,
  buildFormattedPmAddress,
  buildPmShippingAddressRequest,
  emptyPmShippingAddressForm,
  mapResolvedLocationToPmForm,
  resolvePmAddressSubType,
  validatePmShippingAddressForm
} from './pmShippingAddress.js';

describe('pmShippingAddress', () => {
  it('builds the PM POST payload from the add-address form', () => {
    const payload = buildPmShippingAddressRequest({
      ...emptyPmShippingAddressForm(),
      subType: 'WORK',
      building: '123',
      buildingName: '1',
      floor: '2',
      street: '9th Main Road',
      locality: 'Bengaluru',
      district: 'Bengaluru Urban',
      zip: '560102',
      state: 'Karnataka'
    });

    expect(payload).toMatchObject({
      type: 'SHIPPING',
      subType: 'WORK',
      building: '123',
      zip: '560102',
      city: 'Bengaluru',
      pincode: '560102',
      country: 'India'
    });
    expect(payload.formatted_address).toBe(
      '123, 1, 2, 9th Main Road, Bengaluru, Bengaluru Urban, Karnataka, 560102'
    );
  });

  it('requires building, zip, and state', () => {
    const errors = validatePmShippingAddressForm(emptyPmShippingAddressForm());
    expect(errors.building).toBeTruthy();
    expect(errors.zip).toBeTruthy();
    expect(errors.state).toBeTruthy();
  });

  it('uses custom subtype text for Other', () => {
    expect(resolvePmAddressSubType({ subType: 'OTHER', customSubType: 'Warehouse' })).toBe(
      'Warehouse'
    );
  });

  it('maps current location into the form fields', () => {
    const mapped = mapResolvedLocationToPmForm({
      building: '12',
      street: 'MG Road',
      city: 'Bengaluru',
      district: 'Bengaluru Urban',
      pincode: '560038',
      state: 'Karnataka'
    });
    expect(mapped.locality).toBe('Bengaluru');
    expect(mapped.zip).toBe('560038');
    expect(buildFormattedPmAddress(mapped)).toContain('MG Road');
  });

  it('fills locality, district, and state from a pincode lookup', () => {
    const next = applyPincodeLookupToForm(
      { ...emptyPmShippingAddressForm(), zip: '560102', building: '123' },
      {
        state: 'Karnataka',
        district: 'Bengaluru Urban',
        locality: 'Bengaluru',
        street: 'HSR Layout'
      }
    );
    expect(next.building).toBe('123');
    expect(next.state).toBe('Karnataka');
    expect(next.district).toBe('Bengaluru Urban');
    expect(next.locality).toBe('Bengaluru');
    expect(next.street).toBe('HSR Layout');
  });
});
