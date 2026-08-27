import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assignNearestRecommendedFlags,
  sortVendorsByGeoThenRankScore,
  vendorOfferCanFulfill
} from '../services/vendorRankingScoringService.js';

const oosNearest = {
  id: 'karthik',
  name: 'karthik',
  supplierProductId: 'sp-oos',
  distanceKm: 763,
  availableStock: 0,
  stock: 0,
  isAvailable: false,
  isNearestRecommended: true,
  rankScore: 80
};

const inStockFarther = {
  id: 'pran',
  name: 'pran',
  supplierProductId: 'sp-ok',
  distanceKm: 900,
  availableStock: 50,
  stock: 50,
  isAvailable: true,
  rankScore: 70
};

test('out-of-stock nearest offer cannot fulfill and is not recommended', () => {
  assert.equal(vendorOfferCanFulfill(oosNearest, 1), false);
  const vendors = [{ ...oosNearest }, { ...inStockFarther }];
  assignNearestRecommendedFlags(vendors, {
    preferredSupplierId: 'karthik',
    requestedQty: 5,
    enabled: true
  });
  assert.equal(vendors.find((v) => v.id === 'karthik').isNearestRecommended, undefined);
  assert.equal(vendors.find((v) => v.id === 'pran').isNearestRecommended, true);
});

test('when every offer is out of stock, no supplier is recommended', () => {
  const vendors = [{ ...oosNearest }];
  assignNearestRecommendedFlags(vendors, { preferredSupplierId: 'karthik', requestedQty: 1, enabled: true });
  assert.equal(vendors[0].isNearestRecommended, undefined);
});

test('geo sort places fulfillable offers before out-of-stock nearer ones', () => {
  const vendors = [{ ...oosNearest }, { ...inStockFarther }];
  sortVendorsByGeoThenRankScore(vendors, { lat: 1, lng: 1 }, 5);
  assert.equal(vendors[0].id, 'pran');
  assert.equal(vendors[1].id, 'karthik');
});
