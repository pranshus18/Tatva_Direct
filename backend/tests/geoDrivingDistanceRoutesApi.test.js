import test from 'node:test';
import assert from 'node:assert/strict';
import { getDrivingDistanceMatrixKm, distanceKmForRanking } from '../utils/geoUtils.js';

/**
 * Regression test for a real production bug: Google's Routes API returned ~1112km for a
 * Pune -> Bengaluru pair when called with routingPreference: 'TRAFFIC_AWARE', while Google's own
 * classic Distance Matrix API AND an independent OSRM lookup both agreed on ~860km for the exact
 * same two points. Because the Routes API is tried first and its (wrong but non-null) answer
 * short-circuits every other source, this silently showed suppliers hundreds of km further away
 * than they really were. TRAFFIC_UNAWARE must be used since this engine only needs a stable
 * physical distance for ranking, not a live-traffic-dependent ETA.
 */
test('getDrivingDistanceMatrixKm requests TRAFFIC_UNAWARE from the Google Routes API, not TRAFFIC_AWARE', async (t) => {
  const originalFetch = global.fetch;
  const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';

  let capturedBody = null;
  global.fetch = async (url, options) => {
    const urlStr = String(url);
    if (urlStr.includes('routes.googleapis.com/distanceMatrix')) {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => [{ originIndex: 0, destinationIndex: 0, status: {}, distanceMeters: 860463 }]
      };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalGoogleMapsKey !== undefined) process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    else delete process.env.GOOGLE_MAPS_API_KEY;
  });

  const origin = { lat: 12.9348, lng: 77.6342 }; // HSR Layout, Bengaluru
  const destination = { lat: 18.6374972, lng: 73.836 }; // Pune area

  const [km] = await getDrivingDistanceMatrixKm(origin, [destination]);

  assert.ok(capturedBody, 'expected the Google Routes API to be called');
  assert.equal(
    capturedBody.routingPreference,
    'TRAFFIC_UNAWARE',
    'must not request TRAFFIC_AWARE — it produced a ~250km-too-long result for this exact route in production'
  );
  assert.equal(km, 860.463);
});

/**
 * Defense-in-depth: even if TRAFFIC_UNAWARE (or any future API) regresses and returns an
 * implausible number again, it must not be accepted silently. The bad value should be rejected
 * and the NEXT source in the cascade (classic Distance Matrix API here) should be used instead.
 */
test('getDrivingDistanceMatrixKm rejects an implausible Routes API result and falls through to Distance Matrix', async (t) => {
  const originalFetch = global.fetch;
  const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';

  global.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('routes.googleapis.com/distanceMatrix')) {
      // Same bad answer that shipped to production: ~1112km vs. the real ~860km for this pair.
      return {
        ok: true,
        json: async () => [{ originIndex: 0, destinationIndex: 0, status: {}, distanceMeters: 1112000 }]
      };
    }
    if (urlStr.includes('maps.googleapis.com/maps/api/distancematrix')) {
      return {
        ok: true,
        json: async () => ({
          status: 'OK',
          rows: [{ elements: [{ status: 'OK', distance: { value: 860463 } }] }]
        })
      };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalGoogleMapsKey !== undefined) process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    else delete process.env.GOOGLE_MAPS_API_KEY;
  });

  const origin = { lat: 12.9348, lng: 77.6342 }; // HSR Layout, Bengaluru
  const destination = { lat: 18.6374972, lng: 73.836 }; // Pune area

  const [km] = await getDrivingDistanceMatrixKm(origin, [destination]);

  assert.equal(km, 860.463, 'implausible Routes API value must be discarded in favor of Distance Matrix');
});

test('getDrivingDistanceMatrixKm rejects implausible results from every road-distance source and falls back to haversine', async (t) => {
  const originalFetch = global.fetch;
  const originalGoogleMapsKey = process.env.GOOGLE_MAPS_API_KEY;
  process.env.GOOGLE_MAPS_API_KEY = 'test-key';

  global.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('routes.googleapis.com/distanceMatrix')) {
      return {
        ok: true,
        json: async () => [{ originIndex: 0, destinationIndex: 0, status: {}, distanceMeters: 1112000 }]
      };
    }
    if (urlStr.includes('maps.googleapis.com/maps/api/distancematrix')) {
      return {
        ok: true,
        json: async () => ({
          status: 'OK',
          rows: [{ elements: [{ status: 'OK', distance: { value: 1120000 } }] }]
        })
      };
    }
    if (urlStr.includes('router.project-osrm.org')) {
      return {
        ok: true,
        json: async () => ({ distances: [[0, 1130000]] })
      };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  t.after(() => {
    global.fetch = originalFetch;
    if (originalGoogleMapsKey !== undefined) process.env.GOOGLE_MAPS_API_KEY = originalGoogleMapsKey;
    else delete process.env.GOOGLE_MAPS_API_KEY;
  });

  const origin = { lat: 12.9348, lng: 77.6342 }; // HSR Layout, Bengaluru
  const destination = { lat: 18.6374972, lng: 73.836 }; // Pune area

  const [km] = await getDrivingDistanceMatrixKm(origin, [destination]);

  // Straight-line distance for this pair is ~753km — every mocked source above (1112/1120/1130km)
  // is implausible against it, so all should be rejected and the great-circle distance returned
  // instead of any of the wrong values.
  assert.ok(km < 800, `expected haversine fallback (~753km) when every source is implausible, got ${km}`);
  assert.ok(km > 700, `expected haversine fallback (~753km) when every source is implausible, got ${km}`);
});

test('distanceKmForRanking accepts a genuinely plausible road distance close to the real Pune-Bengaluru figure', () => {
  const bengaluru = { lat: 12.9348, lng: 77.6342 };
  const pune = { lat: 18.6374972, lng: 73.836 };
  assert.equal(distanceKmForRanking(bengaluru, pune, 860.463), 860.463);
});

test('distanceKmForRanking rejects the production-incident value (1112km) as implausible for this route', () => {
  const bengaluru = { lat: 12.9348, lng: 77.6342 };
  const pune = { lat: 18.6374972, lng: 73.836 };
  const result = distanceKmForRanking(bengaluru, pune, 1112);
  assert.notEqual(result, 1112, 'the bad production value must never be surfaced as-is');
  assert.ok(result < 800, `expected great-circle fallback, got ${result}`);
});
