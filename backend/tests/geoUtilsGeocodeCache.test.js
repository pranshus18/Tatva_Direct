import test from 'node:test';
import assert from 'node:assert/strict';
import { geocodeAddressNominatim, __resetGeocodeCacheForTests } from '../utils/geoUtils.js';

/**
 * At scale the same handful of supplier/outlet addresses get looked up on every ranking
 * request. Geocoding must be cached process-wide so we don't re-hit external geocoders (and
 * don't risk tripping Nominatim's fair-use rate limit) for an address we've already resolved.
 */

process.env.GEOCODE_NOMINATIM_MIN_GAP_MS = '0';

function withPatchedEnv(fn) {
  const originalGoogleKey = process.env.GOOGLE_GEOCODING_API_KEY;
  const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  delete process.env.GOOGLE_GEOCODING_API_KEY;
  delete process.env.GOOGLE_MAPS_API_KEY;
  return async () => {
    try {
      await fn();
    } finally {
      if (originalGoogleKey !== undefined) process.env.GOOGLE_GEOCODING_API_KEY = originalGoogleKey;
      if (originalGoogleMapsKey !== undefined) process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    }
  };
}

test('geocodeAddressNominatim caches a resolved address and does not call fetch again', async (t) => {
  __resetGeocodeCacheForTests();
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return { ok: true, json: async () => [{ lat: '12.9141', lon: '77.648' }] };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  await withPatchedEnv(async () => {
    const first = await geocodeAddressNominatim('HSR Layout, Bengaluru, Karnataka, 560102, India');
    const second = await geocodeAddressNominatim('HSR Layout, Bengaluru, Karnataka, 560102, India');
    assert.deepEqual(first, { lat: 12.9141, lng: 77.648 });
    assert.deepEqual(second, { lat: 12.9141, lng: 77.648 });
    assert.equal(callCount, 1, 'second lookup for the same address text must be served from cache');
  })();
});

test('geocodeAddressNominatim cache is case/whitespace-insensitive on the address text', async (t) => {
  __resetGeocodeCacheForTests();
  const originalFetch = global.fetch;
  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return { ok: true, json: async () => [{ lat: '18.5204', lon: '73.8567' }] };
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  await withPatchedEnv(async () => {
    await geocodeAddressNominatim('Pune, Maharashtra, India');
    await geocodeAddressNominatim('  PUNE, Maharashtra, India  ');
    assert.equal(callCount, 1);
  })();
});

test('a failed geocode is retried sooner than a successful one (short negative TTL)', async (t) => {
  __resetGeocodeCacheForTests();
  const originalFetch = global.fetch;
  const originalNegativeTtl = process.env.GEOCODE_NEGATIVE_TTL_MS;
  process.env.GEOCODE_NEGATIVE_TTL_MS = '10';
  let callCount = 0;
  let shouldSucceed = false;
  global.fetch = async () => {
    callCount += 1;
    if (!shouldSucceed) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => [{ lat: '12.9141', lon: '77.648' }] };
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalNegativeTtl !== undefined) process.env.GEOCODE_NEGATIVE_TTL_MS = originalNegativeTtl;
    else delete process.env.GEOCODE_NEGATIVE_TTL_MS;
  });

  await withPatchedEnv(async () => {
    const firstAttempt = await geocodeAddressNominatim('Transient Failure Address, India');
    assert.equal(firstAttempt, null);
    const callsAfterFirstAttempt = callCount;
    assert.ok(callsAfterFirstAttempt > 0);

    // Immediately retrying within the (short) negative TTL window should still be served from
    // the cached "null" without any additional network calls.
    const stillCached = await geocodeAddressNominatim('Transient Failure Address, India');
    assert.equal(stillCached, null);
    assert.equal(callCount, callsAfterFirstAttempt, 'a cached null must not trigger new fetch calls');

    // Once the short negative TTL has elapsed, a real retry must happen (and can now succeed) —
    // a transient outage must never permanently poison the cache the way a real result would.
    await new Promise((resolve) => setTimeout(resolve, 20));
    shouldSucceed = true;
    const afterExpiry = await geocodeAddressNominatim('Transient Failure Address, India');
    assert.deepEqual(afterExpiry, { lat: 12.9141, lng: 77.648 });
    assert.ok(callCount > callsAfterFirstAttempt, 'expiry of the negative cache must trigger a fresh lookup');
  })();
});
