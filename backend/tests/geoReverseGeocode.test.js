import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNominatimReverseAddress,
  reverseGeocodeCoordinates,
  __resetGeocodeCacheForTests
} from '../utils/geoUtils.js';

test('parseNominatimReverseAddress prefers street fields over county for city', () => {
  const parsed = parseNominatimReverseAddress(
    {
      house_number: '12',
      road: 'MG Road',
      suburb: 'Indiranagar',
      county: 'Bengaluru Urban',
      state: 'Karnataka',
      postcode: '560038',
      country: 'India'
    },
    'Fallback display name, Bengaluru, Karnataka, India'
  );

  assert.equal(parsed.line1, '12, MG Road, Indiranagar');
  assert.equal(parsed.city, 'Indiranagar');
  assert.equal(parsed.state, 'Karnataka');
  assert.equal(parsed.pincode, '560038');
});

test('reverseGeocodeCoordinates uses Google reverse geocoding when configured', async (t) => {
  __resetGeocodeCacheForTests();
  const originalFetch = global.fetch;
  process.env.GOOGLE_GEOCODING_API_KEY = 'test-google-key';

  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes('maps.googleapis.com/maps/api/geocode/json')) {
      return {
        ok: true,
        json: async () => ({
          status: 'OK',
          results: [
            {
              formatted_address: '12 MG Road, Indiranagar, Bengaluru, Karnataka 560038, India',
              address_components: [
                { long_name: '12', types: ['street_number'] },
                { long_name: 'MG Road', types: ['route'] },
                { long_name: 'Indiranagar', types: ['sublocality', 'sublocality_level_1'] },
                { long_name: 'Bengaluru', types: ['locality', 'political'] },
                { long_name: 'Karnataka', types: ['administrative_area_level_1', 'political'] },
                { long_name: '560038', types: ['postal_code'] },
                { long_name: 'India', types: ['country', 'political'] }
              ]
            }
          ]
        })
      };
    }
    throw new Error(`Unexpected fetch URL: ${target}`);
  };

  t.after(() => {
    global.fetch = originalFetch;
    delete process.env.GOOGLE_GEOCODING_API_KEY;
  });

  const resolved = await reverseGeocodeCoordinates(12.9716, 77.6412);
  assert.equal(resolved.line1, '12, MG Road');
  assert.equal(resolved.city, 'Bengaluru');
  assert.equal(resolved.state, 'Karnataka');
  assert.equal(resolved.pincode, '560038');
});

test('reverseGeocodeCoordinates rejects coordinates outside India', async () => {
  const resolved = await reverseGeocodeCoordinates(40.7128, -74.006);
  assert.equal(resolved, null);
});
