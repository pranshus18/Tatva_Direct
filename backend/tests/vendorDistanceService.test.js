import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSupplierDistances } from '../services/vendorDistanceService.js';

/**
 * Regression test for the "supplier in Pune shows as 4km away from a Bengaluru delivery
 * address" bug: distance selection must honour candidate PRIORITY (the specific product
 * listing location first, then the supplier's generic account address), never pick
 * whichever candidate happens to geocode closest to the buyer.
 */

function makeOutletsQueryStub(rows = []) {
  return {
    select() {
      return {
        in() {
          return {
            eq() {
              return Promise.resolve({ data: rows });
            }
          };
        }
      };
    }
  };
}

function makeFakeSupabase({ outletRows = [] } = {}) {
  return {
    from(table) {
      if (table === 'outlets') return makeOutletsQueryStub(outletRows);
      throw new Error(`Unexpected table in test stub: ${table}`);
    }
  };
}

const PUNE_COORDS = { lat: 18.5204, lon: 73.8567 };
const NEAR_SITE_COORDS = { lat: 12.9141, lon: 77.648 };
const SITE_GEO = { lat: 12.9121, lng: 77.6446 }; // HSR Layout, Bengaluru

function makeFetchMock() {
  return async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('nominatim.openstreetmap.org/search')) {
      const q = decodeURIComponent(new URL(urlStr).searchParams.get('q') || '').toLowerCase();
      if (q.includes('pune')) {
        return { ok: true, json: async () => [{ lat: String(PUNE_COORDS.lat), lon: String(PUNE_COORDS.lon) }] };
      }
      if (q.includes('560102')) {
        return {
          ok: true,
          json: async () => [{ lat: String(NEAR_SITE_COORDS.lat), lon: String(NEAR_SITE_COORDS.lon) }]
        };
      }
      return { ok: true, json: async () => [] };
    }
    // Any routing/distance-matrix endpoint: force the geo utils to fall back to haversine.
    return { ok: false, status: 500, json: async () => ({}) };
  };
}

test('computeSupplierDistances prefers the highest-priority geocodable candidate, not the nearest-sounding one', async (t) => {
  const originalFetch = global.fetch;
  const originalGoogleKey = process.env.GOOGLE_GEOCODING_API_KEY;
  const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_GEOCODING_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  global.fetch = makeFetchMock();
  t.after(() => {
    global.fetch = originalFetch;
    if (originalGoogleKey !== undefined) process.env.GOOGLE_GEOCODING_API_KEY = originalGoogleKey;
    if (originalGoogleMapsKey !== undefined) process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
  });

  const supabase = makeFakeSupabase({ outletRows: [] });

  // "karthik" actually lists this product from Pune, but his registered account address
  // (pushed later / lower priority in the candidate list) is a generic Bengaluru pincode
  // that coincidentally sits right next to the buyer's delivery address.
  const supplierProducts = {
    'karthik-id': {
      supplierId: 'karthik-id',
      supplierName: 'karthik',
      supplierLocation: 'Pune, Pune, Maharashtra, 411026, India',
      locationCandidates: [
        'Pune, Pune, Maharashtra, 411026, India',
        '560102, India',
        'HSR Layout, Bengaluru, Karnataka, 560102, India'
      ],
      products: [{ id: 'p1', outlet_id: null, price: 82, stock: 117 }]
    }
  };

  const { distanceBySupplier, distanceSourceLocationBySupplier } = await computeSupplierDistances({
    supabase,
    supplierProducts,
    siteGeoFromBoq: SITE_GEO
  });

  assert.equal(
    distanceSourceLocationBySupplier['karthik-id'],
    'Pune, Pune, Maharashtra, 411026, India',
    'distance source must match the actual product/listing location, not a coincidentally-nearby fallback address'
  );
  // Pune <-> HSR Layout Bengaluru is roughly 700-850km apart — nowhere near "4km".
  assert.ok(
    distanceBySupplier['karthik-id'] > 500,
    `expected a large distance for a Pune supplier vs a Bengaluru delivery address, got ${distanceBySupplier['karthik-id']}`
  );
});

test('computeSupplierDistances resolves an exact per-offer outlet distance when outlet_id is set', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = makeFetchMock();
  t.after(() => {
    global.fetch = originalFetch;
  });

  const outletRows = [{ id: 'outlet-pune-1', geo_location: { lat: PUNE_COORDS.lat, lng: PUNE_COORDS.lon }, address: null }];
  const supabase = makeFakeSupabase({ outletRows });

  const supplierProducts = {
    'karthik-id': {
      supplierId: 'karthik-id',
      supplierName: 'karthik',
      supplierLocation: 'Pune, Pune, Maharashtra, 411026, India',
      locationCandidates: ['Pune, Pune, Maharashtra, 411026, India'],
      products: [{ id: 'p1', outlet_id: 'outlet-pune-1', price: 82, stock: 117 }]
    }
  };

  const { distanceByOutletId, distanceSourceLocationByOutletId } = await computeSupplierDistances({
    supabase,
    supplierProducts,
    siteGeoFromBoq: SITE_GEO
  });

  assert.ok(distanceByOutletId['outlet-pune-1'] > 500);
  assert.equal(distanceSourceLocationByOutletId['outlet-pune-1'], 'Outlet geo location');
});
