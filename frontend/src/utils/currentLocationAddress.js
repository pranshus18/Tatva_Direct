/** Browser geolocation + OpenStreetMap reverse geocode → normalized address fields. */

export function getCurrentPositionAsync() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not supported in this browser.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0
    });
  });
}

export async function reverseGeocodeToAddress(lat, lon) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1` +
    `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
  const res = await fetch(url, {
    headers: { 'Accept-Language': 'en' }
  });
  if (!res.ok) {
    throw new Error('Could not fetch address from your current location.');
  }
  const geoData = await res.json();
  const addr = geoData?.address || {};
  const line1 =
    [
      addr.house_number,
      addr.road || addr.pedestrian || addr.footway,
      addr.neighbourhood || addr.suburb || addr.quarter
    ]
      .filter(Boolean)
      .join(', ')
      .trim() || geoData?.display_name || '';
  const city =
    addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
  const state = addr.state || addr.state_district || '';
  const pincode = addr.postcode || '';
  const country = addr.country || 'India';

  return {
    line1,
    city,
    state,
    pincode,
    country,
    latitude: lat,
    longitude: lon,
    geoLocation: { lat, lng: lon }
  };
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
