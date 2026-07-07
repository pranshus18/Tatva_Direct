/** Browser geolocation + server reverse geocode → normalized address fields. */

import { authFetch } from '../config/api';

const ACCEPTABLE_ACCURACY_METERS = 75;
const LOCATION_HARD_TIMEOUT_MS = 12000;
const LOCATION_SOFT_TIMEOUT_MS = 6000;

export function getCurrentPositionAsync() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not supported in this browser.'));
      return;
    }

    const options = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: LOCATION_HARD_TIMEOUT_MS
    };

    let bestPosition = null;
    let watchId = null;
    let finished = false;
    let hardTimeoutId = null;
    let softTimeoutId = null;

    const cleanup = () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (hardTimeoutId) clearTimeout(hardTimeoutId);
      if (softTimeoutId) clearTimeout(softTimeoutId);
    };

    const finish = (position, error) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (position) resolve(position);
      else reject(error || new Error('Unable to fetch your current location.'));
    };

    const consider = (position) => {
      if (!position?.coords) return;
      const accuracy = Number(position.coords.accuracy);
      if (
        !bestPosition ||
        (Number.isFinite(accuracy) &&
          accuracy < Number(bestPosition.coords.accuracy ?? Number.POSITIVE_INFINITY))
      ) {
        bestPosition = position;
      }
      if (Number.isFinite(accuracy) && accuracy <= ACCEPTABLE_ACCURACY_METERS) {
        finish(position);
      }
    };

    hardTimeoutId = setTimeout(() => {
      if (bestPosition) {
        finish(bestPosition);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (position) => finish(position),
        (error) => finish(null, error),
        options
      );
    }, LOCATION_HARD_TIMEOUT_MS);

    softTimeoutId = setTimeout(() => {
      if (bestPosition) finish(bestPosition);
    }, LOCATION_SOFT_TIMEOUT_MS);

    watchId = navigator.geolocation.watchPosition(
      consider,
      (error) => {
        if (bestPosition) finish(bestPosition);
        else if (error?.code === 1) finish(null, error);
      },
      options
    );
  });
}

function parseNominatimReverseAddress(addr = {}, displayName = '') {
  const line1 = [
    addr.house_number,
    addr.building,
    addr.road || addr.pedestrian || addr.residential || addr.footway,
    addr.neighbourhood || addr.suburb || addr.quarter || addr.hamlet
  ]
    .filter(Boolean)
    .join(', ')
    .trim();

  const city =
    addr.city ||
    addr.city_district ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    addr.suburb ||
    addr.neighbourhood ||
    '';

  const state = addr.state || addr.state_district || '';
  const pincode = addr.postcode || '';
  const country = addr.country || 'India';

  const fallbackLine1 = String(displayName || '')
    .split(',')
    .slice(0, 2)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');

  return {
    line1: line1 || fallbackLine1,
    city,
    state,
    pincode,
    country
  };
}

async function reverseGeocodeDirect(lat, lon) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1` +
    `&zoom=18&layer=address&accept-language=en&countrycodes=in` +
    `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en' }
  });
  if (!res.ok) {
    throw new Error('Could not fetch address from your current location.');
  }
  const geoData = await res.json();
  const parsed = parseNominatimReverseAddress(geoData?.address || {}, geoData?.display_name || '');
  return {
    ...parsed,
    latitude: lat,
    longitude: lon,
    geoLocation: { lat, lng: lon }
  };
}

export async function reverseGeocodeToAddress(lat, lon) {
  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lng: String(lon)
    });
    const res = await authFetch(`/api/geo/reverse?${params.toString()}`, {
      timeoutMs: 15000
    });
    const data = await res.json();
    if (res.ok && data.status === 'success' && data.address) {
      return {
        ...data.address,
        latitude: lat,
        longitude: lon,
        geoLocation: { lat, lng: lon }
      };
    }
  } catch {
    // Fall back to direct reverse geocoding when the API is unavailable.
  }

  return reverseGeocodeDirect(lat, lon);
}

/** Human-readable single-line address for site location fields. */
export function formatResolvedAddressLine(resolved) {
  if (!resolved) return '';
  return [resolved.line1, resolved.city, resolved.state, resolved.pincode]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
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
