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

test('mapSupplierProductsToRankedVendors gives two offers from the same supplier their own distance, keyed by each offer own location', () => {
  const supplierProducts = {
    sup1: {
      supplierId: 'sup1',
      supplierName: 'karthik',
      supplierCompany: '',
      supplierLocation: 'HSR Layout, Bengaluru, Karnataka, 560102, India',
      supplierPincode: '560102',
      locationCandidates: [],
      products: [
        {
          id: 'p-hsr',
          outlet_id: null,
          price: 85,
          stock: 64,
          unit: 'nos',
          status: 'approved',
          supplierProductId: 'sp-hsr',
          location: 'HSR Layout, Bengaluru, Karnataka, 560102, India'
        },
        {
          id: 'p-pune',
          outlet_id: null,
          price: 95,
          stock: 99,
          unit: 'nos',
          status: 'approved',
          supplierProductId: 'sp-pune',
          location: 'Pune, Pune, Maharashtra, 411026, India'
        }
      ],
      bestPrice: 85,
      bestRating: 0,
      totalStock: 163,
      hasApprovedProduct: true
    }
  };

  // Only the HSR offer resolved a supplier-wide fallback distance (e.g. via the account
  // address / nearest outlet); the Pune offer must NOT inherit it just because it belongs
  // to the same supplier — it must use its own geocoded location instead.
  const vendors = mapSupplierProductsToRankedVendors({
    supplierProducts,
    siteGeoFromBoq: { lat: 12.9121, lng: 77.6446 },
    distanceBySupplier: { sup1: 6 },
    distanceSourceLocationBySupplier: { sup1: 'HSR Layout, Bengaluru, Karnataka, 560102, India' },
    distanceByOutletId: {},
    distanceSourceLocationByOutletId: {},
    distanceByLocationText: {
      'hsr layout, bengaluru, karnataka, 560102, india': 6,
      'pune, pune, maharashtra, 411026, india': 843
    },
    distanceSourceLocationByLocationText: {
      'hsr layout, bengaluru, karnataka, 560102, india': 'HSR Layout, Bengaluru, Karnataka, 560102, India',
      'pune, pune, maharashtra, 411026, india': 'Pune, Pune, Maharashtra, 411026, India'
    },
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
  const hsrVendor = vendors.find((v) => v.supplierProductId === 'sp-hsr');
  const puneVendor = vendors.find((v) => v.supplierProductId === 'sp-pune');
  assert.equal(hsrVendor.distanceKm, 6);
  assert.equal(puneVendor.distanceKm, 843, 'the Pune offer must not inherit the HSR offer distance');
});
