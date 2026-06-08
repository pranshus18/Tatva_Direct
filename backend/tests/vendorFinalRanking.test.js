import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSupplierProductsToRankedVendors } from '../services/vendorFinalRankingService.js';

test('mapSupplierProductsToRankedVendors exposes per-variant stock when includeAllVariants is true', () => {
  const supplierProducts = {
    sup1: {
      supplierId: 'sup1',
      supplierName: 'karthik',
      supplierCompany: '',
      supplierLocation: 'HSR Layout',
      supplierPincode: null,
      locationCandidates: [],
      products: [
        { id: 'p1', price: 85, stock: 64, unit: 'nos', status: 'approved', supplierProductId: 'sp1' },
        { id: 'p2', price: 95, stock: 85, unit: 'nos', status: 'approved', supplierProductId: 'sp2' }
      ],
      bestPrice: 85,
      bestRating: 0,
      totalStock: 149,
      hasApprovedProduct: true
    }
  };

  const vendors = mapSupplierProductsToRankedVendors({
    supplierProducts,
    siteGeoFromBoq: null,
    distanceBySupplier: {},
    distanceSourceLocationBySupplier: {},
    boqProjectCity: null,
    serviceProviderCity: null,
    boqProjectState: null,
    serviceProviderState: null,
    urgencyBonus: 0,
    itemName: 'Mac Air M2',
    itemCategory: 'Electronics',
    includeAllVariants: true
  });

  assert.equal(vendors.length, 2);
  const stocks = vendors.map((v) => v.stock).sort((a, b) => a - b);
  assert.deepEqual(stocks, [64, 85]);
});
