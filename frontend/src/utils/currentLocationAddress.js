/** Browser geolocation + server reverse geocode → normalized address fields. */

import { authFetch } from '../config/api';

function getClientGoogleMapsApiKey() {
  return String(
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY ||
      import.meta.env.VITE_GOOGLE_GEOCODING_API_KEY ||
      ''
  ).trim();
}

function buildResolvedAddress(payload, lat, lon) {
  return {
    ...payload,
    latitude: lat,
    longitude: lon,
    geoLocation: { lat, lng: lon }
  };
}

function parseGoogleClientResult(result) {
  const formattedAddress = String(result?.formatted_address || '').trim();
  const components = Array.isArray(result?.address_components) ? result.address_components : [];
  const pick = (...types) => {
    for (const type of types) {
      const hit = components.find((component) => Array.isArray(component?.types) && component.types.includes(type));
      if (hit?.long_name) return String(hit.long_name).trim();
    }
    return '';
  };

  const streetNumber = pick('street_number', 'premise', 'subpremise');
  const route = pick('route', 'neighborhood', 'sublocality_level_2');
  const locality = pick('sublocality_level_1', 'sublocality', 'neighborhood');
  const city = pick('locality', 'administrative_area_level_2', 'sublocality_level_1', 'sublocality', 'neighborhood');
  const line1 =
    [streetNumber, route]
      .filter(Boolean)
      .join(', ')
      .trim() ||
    locality ||
    formattedAddress.split(',')[0]?.trim() ||
    formattedAddress;

  return {
    line1,
    city,
    state: pick('administrative_area_level_1'),
    pincode: pick('postal_code'),
    country: pick('country') || 'India',
    formattedAddress,
    building: streetNumber,
    buildingName: pick('premise'),
    street: route,
    locality: locality || city,
    district: pick('administrative_area_level_2'),
    zip: pick('postal_code')
  };
}

async function reverseGeocodeWithGoogleClient(lat, lon) {
  const apiKey = getClientGoogleMapsApiKey();
  if (!apiKey) return null;

  const url =
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(`${lat},${lon}`)}` +
    `&language=en&region=IN&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;

  const body = await res.json();
  if (body.status !== 'OK' || !Array.isArray(body.results) || !body.results.length) {
    return null;
  }

  const parsed = parseGoogleClientResult(body.results[0]);
  if (!parsed.line1 && !parsed.city && !parsed.state && !parsed.formattedAddress) {
    return null;
  }
  return parsed;
}

export function getCurrentPositionAsync() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not supported in this browser.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0
    });
  });
}

/** Human-readable single-line address for site location fields. */
export function formatResolvedAddressLine(resolved) {
  if (!resolved) return '';

  const formattedAddress = String(resolved.formattedAddress || '').trim();
  const structured = [resolved.line1, resolved.city, resolved.state, resolved.pincode]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');

  return structured || formattedAddress;
}

export async function reverseGeocodeToAddress(lat, lon) {
  const params = new URLSearchParams({
    lat: String(lat),
    lng: String(lon)
  });

  try {
    const res = await authFetch(`/api/geo/reverse?${params.toString()}`, {
      timeoutMs: 20000
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.status === 'success' && data.address) {
      return buildResolvedAddress(data.address, lat, lon);
    }
  } catch {
    // Fall through to browser-side Google lookup when the backend route is unavailable.
  }

  const clientGoogleAddress = await reverseGeocodeWithGoogleClient(lat, lon);
  if (clientGoogleAddress) {
    return buildResolvedAddress(clientGoogleAddress, lat, lon);
  }

  throw new Error(
    'Could not fetch address from your current location. Please try again or enter it manually.'
  );
}

export async function resolveAddressFromCurrentLocation() {
  const position = await getCurrentPositionAsync();
  const latitude = position?.coords?.latitude;
  const longitude = position?.coords?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw new Error('Could not read your current coordinates.');
  }
  return reverseGeocodeToAddress(latitude, longitude);
}

export function getGeolocationErrorMessage(error) {
  if (error?.code === 1) {
    return 'Location permission is blocked. Please allow location access and try again.';
  }
  if (error?.code === 2) {
    return 'Your location is unavailable right now. Please try again.';
  }
  if (error?.code === 3) {
    return 'Location request timed out. Please try again.';
  }
  return error?.message || 'Unable to fetch your current location.';
}
