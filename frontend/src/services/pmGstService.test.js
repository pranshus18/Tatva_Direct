import { describe, it, expect } from 'vitest';
import { mapPmGstAddress, mapPmGstVerification } from './pmGstService';

describe('mapPmGstAddress', () => {
  it('fills city, state, and PIN from GST address parts instead of one concatenated line', () => {
    const parsed = mapPmGstAddress({
      building: 'ALL INDIA FOOTBALL FEDERATION',
      buildingName: 'FOOTBALL HOUSE',
      street: 'SECTOR 19, PHASE-1',
      locality: 'DWARKA',
      district: 'South West Delhi',
      state: 'Delhi',
      zip: '110075'
    });
    expect(parsed.line1).toBe(
      'ALL INDIA FOOTBALL FEDERATION, FOOTBALL HOUSE, SECTOR 19, PHASE-1, DWARKA'
    );
    expect(parsed.city).toBe('South West Delhi');
    expect(parsed.state).toBe('Delhi');
    expect(parsed.pincode).toBe('110075');
  });

  it('splits a single GST address string into street, city, state, and PIN', () => {
    const parsed = mapPmGstAddress({
      building:
        'ALL INDIA FOOTBALL FEDERATION, FOOTBALL HOUSE, SECTOR 19, PHASE-1, DWARKA, South West Delhi, Delhi, 110075'
    });
    expect(parsed.line1).toBe(
      'ALL INDIA FOOTBALL FEDERATION, FOOTBALL HOUSE, SECTOR 19, PHASE-1, DWARKA'
    );
    expect(parsed.city).toBe('South West Delhi');
    expect(parsed.state).toBe('Delhi');
    expect(parsed.pincode).toBe('110075');
    expect(parsed.country).toBe('India');
  });
});

describe('mapPmGstVerification', () => {
  it('returns structured address alongside the display string', () => {
    const mapped = mapPmGstVerification({
      gstNo: '07AAAAA0000A1Z5',
      companyName: 'ALL INDIA FOOTBALL FEDERATION',
      companyData: {
        addresses: [
          {
            type: 'PRIMARY',
            building:
              'ALL INDIA FOOTBALL FEDERATION, FOOTBALL HOUSE, SECTOR 19, PHASE-1, DWARKA, South West Delhi, Delhi, 110075'
          }
        ]
      }
    });
    expect(mapped.address.city).toBe('South West Delhi');
    expect(mapped.address.state).toBe('Delhi');
    expect(mapped.address.pincode).toBe('110075');
    expect(mapped.address.line1).not.toContain('110075');
  });
});
