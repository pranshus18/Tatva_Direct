/**
 * Strict courier vs trucking intent — drives which upstream booking endpoint is called.
 * Courier: POST /api/logistics/book-courier-checkout
 * Trucking: POST /carrier/trucking-book
 */

export const TRANSPORT_KIND = Object.freeze({
  COURIER: 'courier',
  TRUCKING: 'trucking'
});

function positiveInt(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

function finiteCoord(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Classify a service-providers quote row (same rules as logisticsController.normalizeProviderForUi).
 * @returns {'courier'|'trucking'|null}
 */
export function classifyQuoteProvider(provider = {}) {
  const explicit = String(provider.transportKind || provider.transport_kind || '').toLowerCase();
  if (explicit === TRANSPORT_KIND.TRUCKING) return TRANSPORT_KIND.TRUCKING;
  if (explicit === TRANSPORT_KIND.COURIER) return TRANSPORT_KIND.COURIER;

  const src = String(provider.source || '').toLowerCase();
  const vehicleTypeId = positiveInt(provider.vehicle_type_id ?? provider.vehicleTypeId);
  if (src === 'borzo' || vehicleTypeId != null) return TRANSPORT_KIND.TRUCKING;

  const courierCompanyId = positiveInt(provider.courier_company_id ?? provider.courierCompanyId);
  if (courierCompanyId != null) return TRANSPORT_KIND.COURIER;

  return null;
}

/**
 * Resolve which booking API to call. `transportMode` from the UI is authoritative when present.
 *
 * @returns {{
 *   kind: 'courier'|'trucking'|null,
 *   courierCompanyId?: number,
 *   vehicleTypeId?: number|null,
 *   carrier?: string,
 *   pickupLat?: number,
 *   pickupLng?: number,
 *   deliveryLat?: number,
 *   deliveryLng?: number,
 *   inferred?: boolean,
 *   error?: string
 * }}
 */
export function resolveBookingIntent({
  transportMode = null,
  courierCompanyId = null,
  vehicleTypeId = null,
  source = null,
  carrier = null,
  pickupLat = null,
  pickupLng = null,
  deliveryLat = null,
  deliveryLng = null
} = {}) {
  const mode = String(transportMode || '').trim().toLowerCase();

  if (mode === TRANSPORT_KIND.COURIER) {
    const id = positiveInt(courierCompanyId);
    if (id == null) {
      return {
        kind: null,
        error:
          'transportMode is courier but courier_company_id is missing. Re-select a Shiprocket courier on Transport suggestion.'
      };
    }
    return { kind: TRANSPORT_KIND.COURIER, courierCompanyId: id };
  }

  if (mode === TRANSPORT_KIND.TRUCKING) {
    const plat = finiteCoord(pickupLat);
    const plng = finiteCoord(pickupLng);
    const dlat = finiteCoord(deliveryLat);
    const dlng = finiteCoord(deliveryLng);
    if ([plat, plng, dlat, dlng].some((n) => n == null)) {
      return {
        kind: null,
        error:
          'transportMode is trucking but pickup/delivery coordinates are missing. Re-open Transport suggestion and pick a trucking quote.'
      };
    }
    const vid = positiveInt(vehicleTypeId);
    const src = String(source || '').toLowerCase();
    const resolvedCarrier =
      String(carrier || '').trim() ||
      (src === 'borzo' ? 'Borzo' : 'Borzo');
    return {
      kind: TRANSPORT_KIND.TRUCKING,
      vehicleTypeId: vid,
      carrier: resolvedCarrier,
      pickupLat: plat,
      pickupLng: plng,
      deliveryLat: dlat,
      deliveryLng: dlng
    };
  }

  // Legacy path when transportMode was not sent (deprecated).
  const cc = positiveInt(courierCompanyId);
  if (cc != null) {
    return { kind: TRANSPORT_KIND.COURIER, courierCompanyId: cc, inferred: true };
  }

  const vid = positiveInt(vehicleTypeId);
  const src = String(source || '').toLowerCase();
  if (src === 'borzo' || vid != null) {
    const plat = finiteCoord(pickupLat);
    const plng = finiteCoord(pickupLng);
    const dlat = finiteCoord(deliveryLat);
    const dlng = finiteCoord(deliveryLng);
    if ([plat, plng, dlat, dlng].some((n) => n == null)) {
      return {
        kind: null,
        error: 'Trucking selection requires pickup and delivery coordinates.'
      };
    }
    return {
      kind: TRANSPORT_KIND.TRUCKING,
      vehicleTypeId: vid,
      carrier: String(carrier || '').trim() || 'Borzo',
      pickupLat: plat,
      pickupLng: plng,
      deliveryLat: dlat,
      deliveryLng: dlng,
      inferred: true
    };
  }

  return { kind: null };
}
