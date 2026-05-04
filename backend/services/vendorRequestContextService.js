import { inferCityStateFromLocationText } from '../utils/geoUtils.js';

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
