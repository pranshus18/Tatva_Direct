import { inferCityStateFromLocationText, geocodeIndianAddress } from '../utils/geoUtils.js';
import { isAddressComplete, normalizeAddress } from '../controllers/po/shared/poHelpers.js';
import { deriveShippingAddressesFromProfile } from '../controllers/profile/profileHelpers.js';

/** Expand shippingAddressId to full address from the customer's saved profile when needed. */
export async function resolveProjectShippingAddress(project = {}, { supabase, userId } = {}) {
  const base = project && typeof project === 'object' ? { ...project } : {};
  const inline = base.shippingAddress && typeof base.shippingAddress === 'object' ? base.shippingAddress : null;
  if (inline) {
    const normalized = normalizeAddress(inline);
    if (isAddressComplete(normalized)) {
      return { ...base, shippingAddress: normalized };
    }
  }

  const shippingAddressId = String(base.shippingAddressId || '').trim();
  if (!shippingAddressId || !supabase || !userId) return base;

  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('profile, user_type')
      .eq('id', userId)
      .maybeSingle();
    if (error || !user) return base;

    const saved = deriveShippingAddressesFromProfile(user);
    const match = saved.find((entry) => String(entry.id) === shippingAddressId);
    if (!match) return base;

    const shippingAddress = normalizeAddress(match);
    return {
      ...base,
      shippingAddressId,
      shippingAddress,
      location: base.location || formatShippingAddressText(shippingAddress)
    };
  } catch {
    return base;
  }
}

export function formatShippingAddressText(address = {}) {
  const normalized = normalizeAddress(address);
  return [normalized.line1, normalized.city, normalized.state, normalized.pincode, normalized.country]
    .filter(Boolean)
    .join(', ');
}

export async function loadBoqContextForRanking({ supabase, boqId, userId }) {
  let siteGeoFromBoq = null;
  let boqProjectCity = '';
  let boqProjectState = '';
  let requiredDateFromBoq = '';

  if (!boqId) {
    return { siteGeoFromBoq, boqProjectCity, boqProjectState, requiredDateFromBoq };
  }

  const { data: boqRow, error: boqLookupErr } = await supabase
    .from('boqs')
    .select('project')
    .eq('id', boqId)
    .eq('service_provider_id', userId)
    .single();

  if (!boqLookupErr && boqRow?.project) {
    const p = boqRow.project;
    if (p.siteGeo && typeof p.siteGeo.lat === 'number' && typeof p.siteGeo.lng === 'number') {
      siteGeoFromBoq = { lat: p.siteGeo.lat, lng: p.siteGeo.lng };
    }
    if (p.location) {
      const inferred = inferCityStateFromLocationText(p.location);
      boqProjectCity = inferred.city;
      boqProjectState = inferred.state;
    }
    if (p.requiredDate) {
      requiredDateFromBoq = String(p.requiredDate);
    }
  }

  return { siteGeoFromBoq, boqProjectCity, boqProjectState, requiredDateFromBoq };
}

/** Product Discovery / cart project — rank suppliers by distance to selected shipping address. */
export async function loadDiscoveryProjectContextForRanking(project = {}) {
  let siteGeoFromBoq = null;
  let boqProjectCity = '';
  let boqProjectState = '';
  let requiredDateFromBoq = '';
  let deliveryLocation = '';

  if (!project || typeof project !== 'object') {
    return { siteGeoFromBoq, boqProjectCity, boqProjectState, requiredDateFromBoq, deliveryLocation };
  }

  const shippingAddress =
    project.shippingAddress && typeof project.shippingAddress === 'object' ? project.shippingAddress : null;
  deliveryLocation =
    String(project.location || '').trim() ||
    (shippingAddress ? formatShippingAddressText(shippingAddress) : '');

  if (shippingAddress) {
    const normalized = normalizeAddress(shippingAddress);
    boqProjectCity = String(normalized.city || '').trim().toLowerCase();
    boqProjectState = String(normalized.state || '').trim().toLowerCase();
  } else if (deliveryLocation) {
    const inferred = inferCityStateFromLocationText(deliveryLocation);
    boqProjectCity = inferred.city;
    boqProjectState = inferred.state;
  }

  if (project.requiredDate) {
    requiredDateFromBoq = String(project.requiredDate);
  }

  // Always re-geocode from the selected shipping address — cached siteGeo can be from an old BOQ site.
  if (shippingAddress) {
    const normalized = normalizeAddress(shippingAddress);
    if (isAddressComplete(normalized)) {
      try {
        const geo = await geocodeIndianAddress(normalized);
        if (geo) siteGeoFromBoq = geo;
      } catch {
        // Non-fatal — fall through to location text / cached geo.
      }
    }
  }

  if (!siteGeoFromBoq && deliveryLocation) {
    try {
      const geo = await geocodeIndianAddress(deliveryLocation);
      if (geo) siteGeoFromBoq = geo;
    } catch {
      // Non-fatal.
    }
  }

  if (
    !siteGeoFromBoq &&
    project.siteGeo &&
    typeof project.siteGeo.lat === 'number' &&
    typeof project.siteGeo.lng === 'number'
  ) {
    siteGeoFromBoq = { lat: project.siteGeo.lat, lng: project.siteGeo.lng };
  }

  return { siteGeoFromBoq, boqProjectCity, boqProjectState, requiredDateFromBoq, deliveryLocation };
}

export async function loadServiceProviderLocationContext({ supabase, userId }) {
  let serviceProviderCity = '';
  let serviceProviderState = '';
  let serviceProviderLocation = '';

  try {
    const { data: spUser, error: spError } = await supabase
      .from('users')
      .select('address, profile, name, company')
      .eq('id', userId)
      .single();

    if (!spError && spUser) {
      const addr = spUser.address || {};
      const city = (addr.city || '').toString().trim();
      const state = (addr.state || '').toString().trim();
      serviceProviderCity = city.toLowerCase();
      serviceProviderState = state.toLowerCase();
      serviceProviderLocation = [city, state].filter(Boolean).join(', ');
      console.log('[Vendor Ranking] Service provider location detected from profile/address:', serviceProviderLocation || 'N/A');
    } else {
      console.log('[Vendor Ranking] Could not fetch service provider location from profile/address', spError);
    }
  } catch (spLocError) {
    console.log('[Vendor Ranking] Error while detecting service provider location:', spLocError);
  }

  return { serviceProviderCity, serviceProviderState, serviceProviderLocation };
}
