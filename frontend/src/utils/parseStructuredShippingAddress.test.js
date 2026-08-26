import { describe, it, expect } from 'vitest';
import { parseStructuredShippingAddress } from './parseStructuredShippingAddress.js';

describe('parseStructuredShippingAddress', () => {
  it('splits legacy comma-separated branch address into structured fields', () => {
    const parsed = parseStructuredShippingAddress({
      line1:
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

  it('parses street, city, state, and pincode', () => {
    const parsed = parseStructuredShippingAddress({
      line1: '42 MG Road, Pune, Maharashtra, 411026'
    });
    expect(parsed.line1).toBe('42 MG Road');
    expect(parsed.city).toBe('Pune');
    expect(parsed.state).toBe('Maharashtra');
    expect(parsed.pincode).toBe('411026');
  });

  it('leaves already-structured addresses unchanged', () => {
    const input = {
      line1: '42 MG Road',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411026',
      country: 'India'
    };
    expect(parseStructuredShippingAddress(input)).toEqual(input);
  });

  it('splits GST-fetched line even when signup placeholders filled city/state/PIN', () => {
    const parsed = parseStructuredShippingAddress({
      line1:
        'ALL INDIA FOOTBALL FEDERATION, FOOTBALL HOUSE, SECTOR 19, PHASE-1, DWARKA, South West Delhi, Delhi, 110075',
      city: 'Pending',
      state: 'Pending',
      pincode: '000000',
      country: 'India'
    });
    expect(parsed.line1).toBe(
      'ALL INDIA FOOTBALL FEDERATION, FOOTBALL HOUSE, SECTOR 19, PHASE-1, DWARKA'
    );
    expect(parsed.city).toBe('South West Delhi');
    expect(parsed.state).toBe('Delhi');
    expect(parsed.pincode).toBe('110075');
  });

  it('strips city/state/PIN from line1 when those fields were also provided', () => {
    const parsed = parseStructuredShippingAddress({
      line1:
        'ALL INDIA FOOTBALL FEDERATION, FOOTBALL HOUSE, SECTOR 19, PHASE-1, DWARKA, South West Delhi, Delhi, 110075',
      city: 'South West Delhi',
      state: 'Delhi',
      pincode: '110075',
      country: 'India'
    });
    expect(parsed.line1).toBe(
      'ALL INDIA FOOTBALL FEDERATION, FOOTBALL HOUSE, SECTOR 19, PHASE-1, DWARKA'
    );
    expect(parsed.city).toBe('South West Delhi');
    expect(parsed.state).toBe('Delhi');
    expect(parsed.pincode).toBe('110075');
  });

  it('extracts trailing country when present', () => {
    const parsed = parseStructuredShippingAddress({
      line1: 'Plot 9, Bengaluru, Karnataka, 560001, India'
    });
    expect(parsed.line1).toBe('Plot 9');
    expect(parsed.city).toBe('Bengaluru');
    expect(parsed.state).toBe('Karnataka');
    expect(parsed.pincode).toBe('560001');
    expect(parsed.country).toBe('India');
  });
});
