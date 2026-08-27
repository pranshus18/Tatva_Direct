import { describe, expect, it } from 'vitest';
import {
  pickRecommendedVendor,
  sanitizeVendorOffers,
  vendorCanFulfill
} from './vendorFulfillment';

const item = { id: 'line-1', quantity: 5, nearestSupplier: { supplierId: 'karthik' } };

function oosNearest() {
  return {
    id: 'karthik',
    name: 'karthik',
    supplierProductId: 'sp-oos',
    status: 'approved',
    distanceKm: 763,
    availableStock: 0,
    stock: 0,
    isAvailable: false,
    isNearestRecommended: true,
    rank: 1
  };
}

function inStockFarther() {
  return {
    id: 'pran',
    name: 'pran',
    supplierProductId: 'sp-ok',
    status: 'approved',
    distanceKm: 900,
    availableStock: 50,
    stock: 50,
    isAvailable: true,
    rank: 2
  };
}

describe('vendor fulfillment / recommendation', () => {
  it('does not recommend an out-of-stock nearest supplier', () => {
    expect(vendorCanFulfill(oosNearest(), item)).toBe(false);
    expect(pickRecommendedVendor([oosNearest()], item)).toBeNull();
  });

  it('recommends a farther in-stock supplier instead of a nearer out-of-stock one', () => {
    const picked = pickRecommendedVendor([oosNearest(), inStockFarther()], item);
    expect(picked?.supplierProductId).toBe('sp-ok');
  });

  it('strips recommendation flags from out-of-stock offers in cached rank payloads', () => {
    const cleaned = sanitizeVendorOffers({ 'line-1': [oosNearest()] }, [item]);
    expect(cleaned['line-1'][0].isNearestRecommended).toBe(false);
    expect(cleaned['line-1'][0].isAvailable).toBe(false);
    expect(vendorCanFulfill(cleaned['line-1'][0], item)).toBe(false);
  });
});
