import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOfferSpecifications } from '../services/supplierCatalogHelpersService.js';
import { mapSupplierProductsToRankedVendors } from '../services/vendorFinalRankingService.js';

test('mergeOfferSpecifications uses only offer values when catalog has filled defaults from another variant', () => {
  const merged = mergeOfferSpecifications(
    { 'BPA Free': 'Yes', Capacity: '1 L', Color: 'Silver' },
    {
      attributes: {
        specifications: {
          'BPA Free': '',
          Capacity: '',
          Color: '',
          Height: '600 ml'
        }
      }
    }
  );

  assert.equal(merged['BPA Free'], '');
  assert.equal(merged.Capacity, '');
  assert.equal(merged.Color, '');
  assert.equal(merged.Height, '600 ml');
});

test('mergeOfferSpecifications flattens variantAttributes for vendor ranking cards', () => {
  const merged = mergeOfferSpecifications(
    { Color: 'Silver' },
    {
      attributes: {
        variantAttributes: {
          'BPA Free': 'Yes',
          Capacity: '500ML',
          Color: 'black'
        }
      }
    }
  );

  assert.equal(merged['BPA Free'], 'Yes');
  assert.equal(merged.Capacity, '500ML');
  assert.equal(merged.Color, 'black');
});

test('mapSupplierProductsToRankedVendors forwards merged per-variant specifications', () => {
  const supplierProducts = {
    sup1: {
      supplierId: 'sup1',
      supplierName: 'Pranshu Singh',
      supplierCompany: 'ALL INDIA FOOTBALL FEDERATION',
      supplierLocation: '110075, India',
      supplierPincode: '110075',
      locationCandidates: [],
      products: [
        {
          id: 'p1',
          price: 15,
          stock: 200,
          unit: '600 ml',
          status: 'approved',
          supplierProductId: 'sp-empty-template',
          variant_asin: 'TS1B2D',
          specifications: {
            'BPA Free': 'Yes',
            Capacity: '1 L',
            Color: 'Silver'
          }
        },
        {
          id: 'p2',
          price: 140,
          stock: 10,
          unit: '600 ml',
          status: 'approved',
          supplierProductId: 'sp-filled',
          variant_asin: 'TS1B1D',
          specifications: {
            'BPA Free': 'Yes',
            Capacity: '500ML',
            Color: 'black'
          }
        }
      ],
      bestPrice: 15,
      bestRating: 0,
      totalStock: 210,
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
    itemName: 'STEEL TAURUS 600',
    itemCategory: 'other',
    includeAllVariants: true
  });

  assert.equal(vendors.length, 2);
  const byVariant = Object.fromEntries(vendors.map((v) => [v.variantAsin, v.specifications]));
  assert.equal(byVariant.TS1B2D['BPA Free'], 'Yes');
  assert.equal(byVariant.TS1B1D.Capacity, '500ML');
  assert.equal(byVariant.TS1B1D.Color, 'black');
});
