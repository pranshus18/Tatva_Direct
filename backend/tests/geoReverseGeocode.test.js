import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNominatimReverseAddress,
  reverseGeocodeCoordinates,
  lookupIndianPincode,
  parsePmPincodeLookupPayload,
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
  assert.equal(parsed.building, '12');
  assert.equal(parsed.street, 'MG Road');
  assert.equal(parsed.district, 'Bengaluru Urban');
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

test('reverseGeocodeCoordinates accepts Google formatted_address when street parts are missing', async (t) => {
  __resetGeocodeCacheForTests();
  const originalFetch = global.fetch;
  process.env.GOOGLE_MAPS_API_KEY = 'test-google-key';

  global.fetch = async (url) => {
    const target = String(url);
    if (target.includes('maps.googleapis.com/maps/api/geocode/json')) {
      return {
        ok: true,
        json: async () => ({
          status: 'OK',
          results: [
            {
              formatted_address: 'Indiranagar, Bengaluru, Karnataka 560038, India',
              address_components: [
                { long_name: 'Indiranagar', types: ['sublocality', 'sublocality_level_1', 'political'] },
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
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  const resolved = await reverseGeocodeCoordinates(12.9716, 77.6412);
  assert.equal(resolved.line1, 'Indiranagar');
  assert.equal(resolved.city, 'Bengaluru');
  assert.equal(resolved.state, 'Karnataka');
  assert.equal(resolved.pincode, '560038');
});

test('reverseGeocodeCoordinates rejects coordinates outside India', async () => {
  const resolved = await reverseGeocodeCoordinates(40.7128, -74.006);
  assert.equal(resolved, null);
});

test('parsePmPincodeLookupPayload reads Google-style state from the PM API', () => {
  const parsed = parsePmPincodeLookupPayload(
    {
      success: true,
      message: 'State retrieved successfully',
      data: {
        pincode: '560102',
        state: {
          long_name: 'Karnataka',
          short_name: 'KA',
          types: ['administrative_area_level_1', 'political']
        }
      }
    },
    '560102'
  );

  assert.equal(parsed.zip, '560102');
  assert.equal(parsed.state, 'Karnataka');
});

test('parsePmPincodeLookupPayload reads extra Google address components when present', () => {
  const parsed = parsePmPincodeLookupPayload({
    data: {
      pincode: '560102',
      address_components: [
        { long_name: 'HSR Layout', types: ['sublocality', 'sublocality_level_1'] },
        { long_name: 'Bengaluru', types: ['locality', 'political'] },
        { long_name: 'Bengaluru Urban', types: ['administrative_area_level_2', 'political'] },
        { long_name: 'Karnataka', types: ['administrative_area_level_1', 'political'] }
      ]
    }
  });

  assert.equal(parsed.state, 'Karnataka');
  assert.equal(parsed.district, 'Bengaluru Urban');
  assert.equal(parsed.locality, 'HSR Layout');
  assert.equal(parsed.city, 'Bengaluru');
});

test('lookupIndianPincode uses the PM state-by-pincode API first', async (t) => {
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    const target = String(url);
    urls.push(target);
    if (target.includes('google-maps/state-by-pincode')) {
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            pincode: '560102',
            state: { long_name: 'Karnataka', short_name: 'KA' }
          }
        })
      };
    }
    if (target.includes('postalpincode.in')) {
      return {
        ok: true,
        json: async () => [
          {
            Status: 'Success',
            PostOffice: [
              {
                Name: 'HSR Layout',
                District: 'Bengaluru Urban',
                State: 'Karnataka',
                Block: 'Bengaluru'
              }
            ]
          }
        ]
      };
    }
    return { ok: false, json: async () => ({}) };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const resolved = await lookupIndianPincode('560102');
  assert.equal(resolved.state, 'Karnataka');
  assert.equal(resolved.district, 'Bengaluru Urban');
  assert.equal(resolved.locality, 'Bengaluru');
  assert.equal(
    urls.some((url) => url.includes('/api/google-maps/state-by-pincode') && url.includes('pincode=560102')),
    true
  );
});

test('lookupIndianPincode uses postal office data when available', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => [
      {
        Status: 'Success',
        PostOffice: [
          {
            Name: 'Marathahalli',
            District: 'Bengaluru Urban',
            State: 'Karnataka',
            Block: 'Bangalore East'
          }
        ]
      }
    ]
  });
  t.after(() => {
    global.fetch = originalFetch;
  });

  const resolved = await lookupIndianPincode('560037');
  assert.equal(resolved.zip, '560037');
  assert.equal(resolved.state, 'Karnataka');
  assert.equal(resolved.district, 'Bengaluru Urban');
  assert.equal(resolved.locality, 'Bangalore East');
});

test('lookupIndianPincode falls back to PIN prefix state', async (t) => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => [{ Status: 'Error', PostOffice: null }]
  });
  t.after(() => {
    global.fetch = originalFetch;
  });

  const resolved = await lookupIndianPincode('560102');
  assert.equal(resolved.state, 'Karnataka');
  assert.equal(resolved.zip, '560102');
});

