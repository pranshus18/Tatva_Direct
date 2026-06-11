import { describe, expect, it } from 'vitest';
import { applyIgstToTaxFields, deriveCgstSgstFromIgst } from './gstRates';

describe('deriveCgstSgstFromIgst', () => {
  it('splits IGST equally into CGST and SGST', () => {
    expect(deriveCgstSgstFromIgst('18')).toEqual({ cgst_rate: '9', sgst_rate: '9' });
    expect(deriveCgstSgstFromIgst('12')).toEqual({ cgst_rate: '6', sgst_rate: '6' });
    expect(deriveCgstSgstFromIgst('5')).toEqual({ cgst_rate: '2.5', sgst_rate: '2.5' });
    expect(deriveCgstSgstFromIgst('0')).toEqual({ cgst_rate: '0', sgst_rate: '0' });
  });

  it('returns empty rates for invalid IGST', () => {
    expect(deriveCgstSgstFromIgst('')).toEqual({ cgst_rate: '', sgst_rate: '' });
  });
});

describe('applyIgstToTaxFields', () => {
  it('updates all three tax fields together', () => {
    expect(
      applyIgstToTaxFields({ igst_rate: '', cgst_rate: '', sgst_rate: '', name: 'Cement' }, '28')
    ).toEqual({
      igst_rate: '28',
      cgst_rate: '14',
      sgst_rate: '14',
      name: 'Cement'
    });
  });
});
