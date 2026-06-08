/**
 * When to request courier vs auto/trucking quotes from Tatva Logistics.
 * Borzo trucking is intracity (same-city); heavy bulk uses mode "auto" with lat/lng.
 */

function digitsPin6(value) {
  const d = String(value || '').replace(/\D/g, '').slice(0, 6);
  return d.length === 6 ? d : '';
}

function normCity(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export const LOGISTICS_TRUCKING_MIN_WEIGHT_KG = Math.max(
  0,
  Number.parseFloat(String(process.env.LOGISTICS_TRUCKING_MIN_WEIGHT_KG || '30')) || 30
);

/** When true, same-city trucking with no vehicles may fall back to courier quotes. Default: off. */
export const LOGISTICS_COURIER_FALLBACK_AFTER_TRUCKING =
  String(process.env.LOGISTICS_COURIER_FALLBACK_AFTER_TRUCKING || '').toLowerCase() === 'true';

/** Max straight-line distance (km) to treat pickup/delivery as same-city for Borzo. */
export const LOGISTICS_SAME_CITY_MAX_KM = Math.max(
  5,
  Number.parseFloat(String(process.env.LOGISTICS_SAME_CITY_MAX_KM || '45')) || 45
);

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Same-city lane (Borzo intracity). Prefer city match or geodesic distance; PIN match is a weak fallback.
 */
export function isSameCityLane({
  pickupPincode,
  deliveryPincode,
  pickupCity = null,
  deliveryCity = null,
  pickupGeo = null,
  deliveryGeo = null
} = {}) {
  const pc = normCity(pickupCity);
  const dc = normCity(deliveryCity);
  if (pc && dc && pc === dc) return true;

  const plat = Number(pickupGeo?.lat);
  const plng = Number(pickupGeo?.lng);
  const dlat = Number(deliveryGeo?.lat);
  const dlng = Number(deliveryGeo?.lng);
  if ([plat, plng, dlat, dlng].every((n) => Number.isFinite(n))) {
    const km = haversineKm(plat, plng, dlat, dlng);
    if (km <= LOGISTICS_SAME_CITY_MAX_KM) return true;
    if (km > LOGISTICS_SAME_CITY_MAX_KM) return false;
  }

  const pickup = digitsPin6(pickupPincode);
  const delivery = digitsPin6(deliveryPincode);
  if (pickup && delivery && pickup === delivery) return true;

  return false;
}

export function isIntercityLane({
  pickupPincode,
  deliveryPincode,
  pickupCity = null,
  deliveryCity = null,
  pickupGeo = null,
  deliveryGeo = null
} = {}) {
  if (
    isSameCityLane({
      pickupPincode,
      deliveryPincode,
      pickupCity,
      deliveryCity,
      pickupGeo,
      deliveryGeo
    })
  ) {
    return false;
  }

  const pc = normCity(pickupCity);
  const dc = normCity(deliveryCity);
  if (pc && dc && pc !== dc) return true;

  const plat = Number(pickupGeo?.lat);
  const plng = Number(pickupGeo?.lng);
  const dlat = Number(deliveryGeo?.lat);
  const dlng = Number(deliveryGeo?.lng);
  if ([plat, plng, dlat, dlng].every((n) => Number.isFinite(n))) {
    return haversineKm(plat, plng, dlat, dlng) > LOGISTICS_SAME_CITY_MAX_KM;
  }

  const pickup = digitsPin6(pickupPincode);
  const delivery = digitsPin6(deliveryPincode);
  if (pickup && delivery && pickup !== delivery) return true;

  return false;
}

const BULK_CATEGORY_RE = /\b(paint|primer|putty|cement|sand|aggregate|brick|tile|mortar|grout|plaster|construction|bag)\b/i;

/**
 * @param {object} group PO vendor group with items
 * @param {number} [weightKg] precomputed chargeable weight
 */
export function inferLogisticsCategory(group, weightKg = null) {
  const items = Array.isArray(group?.items) ? group.items : [];
  const parsedWeightKg = Number(weightKg);

  const text = items
    .map((i) => {
      const specs =
        i?.specifications && typeof i.specifications === 'object' ? i.specifications : {};
      return `${i?.name || ''} ${i?.category || ''} ${Object.values(specs).join(' ')}`;
    })
    .join(' ')
    .toLowerCase();

  if (BULK_CATEGORY_RE.test(text)) return 'paint';
  if (/\b(laptop|notebook|macbook|chromebook)\b/.test(text)) return 'laptop';
  if (/\b(phone|mobile|tablet|ipad|electronics)\b/.test(text)) return 'electronics';
  if (Number.isFinite(parsedWeightKg) && parsedWeightKg >= LOGISTICS_TRUCKING_MIN_WEIGHT_KG) return 'paint';
  return 'general';
}

/**
 * @returns {{
 *   mode: 'auto' | 'courier' | 'trucking',
 *   category: string,
 *   sameCity: boolean,
 *   intercity: boolean,
 *   heavy: boolean,
 *   quoteNote: string|null,
 *   allowCourierFallback: boolean
 * }}
 */
export function resolveShipmentQuoteStrategy({
  weightKg,
  category,
  pickupPincode,
  deliveryPincode,
  pickupCity = null,
  deliveryCity = null,
  pickupGeo = null,
  deliveryGeo = null
}) {
  const w = Number(weightKg) || 0;
  const heavy = w >= LOGISTICS_TRUCKING_MIN_WEIGHT_KG;
  const lane = { pickupPincode, deliveryPincode, pickupCity, deliveryCity, pickupGeo, deliveryGeo };
  const sameCity = isSameCityLane(lane);
  const intercity = isIntercityLane(lane);
  const cat = String(category || 'general').trim() || 'general';
  const bulkCat = cat === 'general' && heavy ? 'paint' : cat;

  if (intercity) {
    if (heavy) {
      return {
        mode: 'auto',
        category: bulkCat,
        sameCity: false,
        intercity: true,
        heavy: true,
        quoteNote: 'Inter-city heavy lane: logistics module selects the best carrier mode.',
        allowCourierFallback: false
      };
    }
    return {
      mode: 'courier',
      category: cat,
      sameCity: false,
      intercity: true,
      heavy: false,
      quoteNote: 'Inter-city lane: courier (Shiprocket) quotes only — trucking is same-city.',
      allowCourierFallback: false
    };
  }

  if (heavy && sameCity) {
    return {
      mode: 'trucking',
      category: bulkCat,
      sameCity: true,
      intercity: false,
      heavy: true,
      quoteNote: 'Same-city heavy shipment: trucking (Borzo) quotes.',
      allowCourierFallback: LOGISTICS_COURIER_FALLBACK_AFTER_TRUCKING
    };
  }

  if (heavy) {
    return {
      mode: 'auto',
      category: bulkCat,
      sameCity: false,
      intercity: false,
      heavy: true,
      quoteNote:
        'Add complete pickup and delivery addresses (or wait for geocoding) so we can confirm same-city trucking.',
      allowCourierFallback: LOGISTICS_COURIER_FALLBACK_AFTER_TRUCKING
    };
  }

  if (sameCity) {
    return {
      mode: 'courier',
      category: cat,
      sameCity: true,
      intercity: false,
      heavy: false,
      quoteNote: 'Same-city parcel: courier (Shiprocket) quotes.',
      allowCourierFallback: false
    };
  }

  return {
    mode: 'courier',
    category: cat,
    sameCity,
    intercity,
    heavy: false,
    quoteNote: null,
    allowCourierFallback: false
  };
}
