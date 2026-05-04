/** Earth radius in km */
const R_KM = 6371;

export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_KM * c;
}

function isFiniteCoord(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeLatLng(geo) {
  if (!geo || typeof geo !== 'object') return null;
  const lat = normalizeGeoValue(geo.lat ?? geo.latitude);
  const lng = normalizeGeoValue(geo.lng ?? geo.lon ?? geo.longitude ?? geo.long);
  if (!isFiniteCoord(lat) || !isFiniteCoord(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function getPrimaryGoogleMapsApiKey() {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.Google_Maps_API_KEY ||
    process.env.google_maps_api_key ||
    ''
  );
}

/**
 * Compute road distance for many destinations from one origin.
 * Priority: Google Routes API -> Google Distance Matrix -> OSRM table API -> haversine fallback.
 */
export async function getDrivingDistanceMatrixKm(origin, destinations = []) {
  const normalizedOrigin = normalizeLatLng(origin);
  if (!normalizedOrigin || !Array.isArray(destinations) || destinations.length === 0) return [];

  const normalizedDestinations = destinations.map((d) => normalizeLatLng(d));
  const results = normalizedDestinations.map(() => null);

  const primaryGoogleMapsApiKey = getPrimaryGoogleMapsApiKey();
  const routesApiKey =
    process.env.GOOGLE_ROUTES_API_KEY ||
    process.env.GOOGLE_DISTANCE_MATRIX_API_KEY ||
    primaryGoogleMapsApiKey ||
    process.env.GOOGLE_GEOCODING_API_KEY;
  const distanceMatrixKey =
    process.env.GOOGLE_DISTANCE_MATRIX_API_KEY ||
    primaryGoogleMapsApiKey ||
    process.env.GOOGLE_GEOCODING_API_KEY;

  if (routesApiKey) {
    // Keep batch conservative for reliability and quota behavior.
    const batchSize = 25;
    for (let i = 0; i < normalizedDestinations.length; i += batchSize) {
      const batch = normalizedDestinations.slice(i, i + batchSize);
      const valid = batch.map((d, idx) => ({ d, idx })).filter((x) => x.d);
      if (valid.length === 0) continue;
      try {
        const body = {
          origins: [
            {
              waypoint: {
                location: {
                  latLng: {
                    latitude: normalizedOrigin.lat,
                    longitude: normalizedOrigin.lng
                  }
                }
              }
            }
          ],
          destinations: valid.map(({ d }) => ({
            waypoint: {
              location: {
                latLng: {
                  latitude: d.lat,
                  longitude: d.lng
                }
              }
            }
          })),
          travelMode: 'DRIVE',
          routingPreference: 'TRAFFIC_AWARE'
        };
        const response = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': routesApiKey,
            'X-Goog-FieldMask': 'originIndex,destinationIndex,distanceMeters,status'
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) continue;
        const rows = await response.json();
        if (!Array.isArray(rows)) continue;
        rows.forEach((row) => {
          if (row?.status?.code && row.status.code !== 0) return;
          const destinationIndex = Number(row?.destinationIndex);
          const meters = Number(row?.distanceMeters);
          if (!Number.isFinite(destinationIndex) || destinationIndex < 0) return;
          if (!Number.isFinite(meters) || meters < 0) return;
          const batchOffset = valid[destinationIndex]?.idx;
          if (typeof batchOffset === 'number') {
            results[i + batchOffset] = meters / 1000;
          }
        });
      } catch {
        // Keep null; fallback strategy below will fill.
      }
    }
  }

  if (distanceMatrixKey) {
    // Google Distance Matrix allows up to 25 destinations per request.
    const batchSize = 25;
    for (let i = 0; i < normalizedDestinations.length; i += batchSize) {
      const batch = normalizedDestinations.slice(i, i + batchSize);
      const valid = batch
        .map((d, idx) => ({ d, idx }))
        .filter((x) => x.d && results[i + x.idx] == null);
      if (valid.length === 0) continue;
      try {
        const destinationsParam = valid.map(({ d }) => `${d.lat},${d.lng}`).join('|');
        const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(
          `${normalizedOrigin.lat},${normalizedOrigin.lng}`
        )}&destinations=${encodeURIComponent(destinationsParam)}&mode=driving&units=metric&region=IN&key=${encodeURIComponent(
          distanceMatrixKey
        )}`;
        const response = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) continue;
        const body = await response.json();
        if (body.status !== 'OK' || !Array.isArray(body.rows) || body.rows.length === 0) continue;
        const elements = body.rows[0]?.elements || [];
        elements.forEach((element, validIdx) => {
          if (element?.status !== 'OK') return;
          const meters = Number(element?.distance?.value);
          if (!Number.isFinite(meters) || meters < 0) return;
          const batchOffset = valid[validIdx]?.idx;
          if (typeof batchOffset === 'number') {
            results[i + batchOffset] = meters / 1000;
          }
        });
      } catch {
        // Keep null; fallback strategy below will fill.
      }
    }
  }

  // Fill unresolved values via OSRM (no key required).
  const unresolved = results
    .map((distanceKm, idx) => ({ distanceKm, idx }))
    .filter((entry) => entry.distanceKm == null && normalizedDestinations[entry.idx]);
  if (unresolved.length > 0) {
    try {
      const coords = [
        `${normalizedOrigin.lng},${normalizedOrigin.lat}`,
        ...unresolved.map(({ idx }) => {
          const d = normalizedDestinations[idx];
          return `${d.lng},${d.lat}`;
        })
      ];
      const osrmUrl = `https://router.project-osrm.org/table/v1/driving/${coords.join(
        ';'
      )}?sources=0&annotations=distance`;
      const response = await fetch(osrmUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
      });
      if (response.ok) {
        const body = await response.json();
        const distances = body?.distances?.[0];
        if (Array.isArray(distances)) {
          for (let j = 1; j < distances.length; j += 1) {
            const meters = Number(distances[j]);
            if (!Number.isFinite(meters) || meters < 0) continue;
            const target = unresolved[j - 1];
            if (target) results[target.idx] = meters / 1000;
          }
        }
      }
    } catch {
      // Last fallback below.
    }
  }

  // Final fallback: great-circle distance so ranking still works when APIs fail.
  return results.map((distanceKm, idx) => {
    if (distanceKm != null) return distanceKm;
    const d = normalizedDestinations[idx];
    if (!d) return null;
    return haversineKm(normalizedOrigin.lat, normalizedOrigin.lng, d.lat, d.lng);
  });
}

/**
 * Compute nearest road distance (km) from a set of origins to each destination.
 * Uses the same routing stack as getDrivingDistanceMatrixKm for consistency.
 */
export async function getMinDrivingDistanceFromOriginsKm(origins = [], destinations = []) {
  if (!Array.isArray(destinations) || destinations.length === 0) return [];
  if (!Array.isArray(origins) || origins.length === 0) return destinations.map(() => null);

  const normalizedOrigins = origins.map((origin) => normalizeLatLng(origin)).filter(Boolean);
  if (normalizedOrigins.length === 0) return destinations.map(() => null);

  const bestByDestination = destinations.map(() => null);
  for (const origin of normalizedOrigins) {
    const distances = await getDrivingDistanceMatrixKm(origin, destinations);
    distances.forEach((distanceKm, idx) => {
      if (distanceKm == null || !Number.isFinite(distanceKm)) return;
      const currentBest = bestByDestination[idx];
      if (currentBest == null || distanceKm < currentBest) {
        bestByDestination[idx] = distanceKm;
      }
    });
  }
  return bestByDestination;
}

export function parseOptionalGeo(latStr, lngStr) {
  if (latStr === undefined || lngStr === undefined || latStr === '' || lngStr === '') return null;
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Build a single-line string from outlet address JSON for geocoding APIs. */
export function buildOutletAddressString(address) {
  if (!address) return '';
  if (typeof address === 'string') return address.trim();
  if (typeof address !== 'object') return '';
  const a = address;
  const parts = [
    a.line1 || a.street || a.address_line1 || a.address,
    a.line2,
    a.city,
    a.state || a.region,
    a.pincode || a.postal_code || a.zip || a.zipCode,
    a.country
  ]
    .map((x) => (x != null ? String(x).trim() : ''))
    .filter(Boolean);
  return parts.join(', ');
}

function normalizeGeoValue(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = parseFloat(value);
    return Number.isNaN(n) ? null : n;
  }
  return null;
}

function normalizeGeoObject(geo) {
  if (!geo || typeof geo !== 'object') return null;
  const lat = normalizeGeoValue(geo.lat ?? geo.latitude);
  const lng = normalizeGeoValue(geo.lng ?? geo.lon ?? geo.longitude ?? geo.long);
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function isValidGeoLocation(geo) {
  return !!normalizeGeoObject(geo);
}

/**
 * Use explicit geo if valid; otherwise forward-geocode outlet address (Google if GOOGLE_GEOCODING_API_KEY / GOOGLE_MAPS_API_KEY set).
 */
export async function resolveGeoFromOutletAddress(geo_location, address) {
  const normalized = normalizeGeoObject(geo_location);
  if (normalized) {
    return normalized;
  }
  const text = buildOutletAddressString(address);
  if (!text.trim()) return null;
  return geocodeAddressNominatim(text);
}

/**
 * Forward geocode a free-text address.
 * Priority: GOOGLE_GEOCODING_API_KEY or GOOGLE_MAPS_API_KEY → Google Geocoding API; else Nominatim.
 */
export async function geocodeAddressNominatim(address) {
  const q = (address || '').trim();
  if (!q) return null;

  // 1) Try Google Geocoding API when key is configured
  const googleKey =
    process.env.GOOGLE_GEOCODING_API_KEY || getPrimaryGoogleMapsApiKey();
  if (googleKey) {
    try {
      // Bias Google results to India because the platform currently operates in India.
      const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
        q
      )}&region=IN&components=country:IN&key=${encodeURIComponent(googleKey)}`;
      const googleRes = await fetch(googleUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (googleRes.ok) {
        const body = await googleRes.json();
        if (body.status === 'OK' && Array.isArray(body.results) && body.results.length > 0) {
          const loc = body.results[0]?.geometry?.location;
          const lat = parseFloat(loc?.lat);
          const lng = parseFloat(loc?.lng);
          if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
            return { lat, lng };
          }
        }
        // Many keys fail on backend because of restrictions (HTTP referrer/billing/IP).
        if (body.status && body.status !== 'OK') {
          console.warn('[Geo] Google geocode not OK:', {
            status: body.status,
            errorMessage: body.error_message || null,
            query: q.slice(0, 120)
          });
        }
      } else {
        console.warn('[Geo] Google geocode HTTP error:', googleRes.status, q.slice(0, 120));
      }
    } catch {
      // swallow and fall back to Nominatim
    }
  }

  // 2) Fallback: free Nominatim (try strict India first, then broader retries)
  const looksIndian = /\bindia\b/i.test(q);
  const queryCandidates = looksIndian ? [q] : [q, `${q}, India`];
  for (const query of queryCandidates) {
    // First pass: constrain to India for better precision when possible
    for (const countryFilter of ['in', '']) {
      try {
        const countryParam = countryFilter ? `&countrycodes=${countryFilter}` : '';
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
          query
        )}&format=json&limit=${1}${countryParam}`;
        const res = await fetch(url, {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'TatvaDirect-BOQ/1.0'
          },
          signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) continue;
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
        return { lat, lng };
      } catch {
        // keep trying the next fallback strategy
      }
    }
  }
  return null;
}

/** "City, State" style split for text proximity fallback */
export function inferCityStateFromLocationText(text) {
  const t = (text || '').trim();
  if (!t) return { city: '', state: '' };
  const parts = t.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { city: '', state: '' };
  if (parts.length === 1) return { city: parts[0].toLowerCase(), state: '' };
  return {
    city: parts[0].toLowerCase(),
    state: parts[parts.length - 1].toLowerCase()
  };
}
