/**
 * Strict request bodies for Tatva Logistics module (openapi.json).
 * Courier: BookCourierCheckoutRequest → POST /api/logistics/book-courier-checkout
 * Trucking: TruckingBookRequest → POST /carrier/trucking-book
 */

function pickStr(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

/** Indian mobile for logistics APIs (10 digits, starts 6–9). */
export function normalizeIndianLogisticsPhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 12 && digits.startsWith('91')) digits = digits.slice(-10);
  else if (digits.length > 10) digits = digits.slice(-10);
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) return digits;
  return '9876543210';
}

function assertPositiveWeightKg(raw, label = 'weight_kg') {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.round(n * 1000) / 1000;
  const err = new Error(`${label} must be a positive number`);
  err.code = 'LOGISTICS_VALIDATION';
  throw err;
}

function assertBookCourierAddress(addr) {
  const line1 = String(addr?.line1 || '').trim();
  const city = String(addr?.city || '').trim();
  const state = String(addr?.state || '').trim();
  const pincode = String(addr?.pincode || '').replace(/\D/g, '').slice(0, 6);
  const missing = [];
  if (!line1) missing.push('line1');
  if (!city) missing.push('city');
  if (!state) missing.push('state');
  if (pincode.length !== 6) missing.push('pincode');
  if (missing.length > 0) {
    const err = new Error(
      `Delivery address incomplete for courier booking (missing: ${missing.join(', ')}).`
    );
    err.code = 'LOGISTICS_VALIDATION';
    throw err;
  }
  return {
    line1,
    city,
    state,
    pincode,
    country: String(addr?.country || 'India').trim() || 'India'
  };
}

/**
 * @throws {Error} when required BookCourierCheckoutRequest fields are invalid
 */
export function buildBookCourierCheckoutPayload({
  courierCompanyId,
  courierDisplayName = null,
  deliveryAddress,
  sessionBuyer,
  lines,
  weightKg,
  orderId,
  orderNumber,
  vendorId = null
}) {
  const id = Number(courierCompanyId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('courier_company_id must be a positive integer');
    err.code = 'LOGISTICS_VALIDATION';
    throw err;
  }

  const buyerName = pickStr(sessionBuyer?.name, sessionBuyer?.company) || 'Customer';
  const buyerPhone = normalizeIndianLogisticsPhone(sessionBuyer?.phone);
  const buyerEmail = pickStr(sessionBuyer?.email) || 'noreply@tatva.local';
  const clientRef =
    pickStr(orderNumber) || (orderId ? `tatva-order:${orderId}` : `tatva-booking:${Date.now()}`);

  const delivery_address = assertBookCourierAddress(deliveryAddress);

  const items = (Array.isArray(lines) ? lines : []).map((row) => ({
    name: row.name,
    quantity: row.quantity,
    unit_price: row.unit_price,
    total_price: row.total_price,
    product_id: row.product_id,
    sku: row.sku
  }));

  const body = {
    client_reference: clientRef.slice(0, 240),
    courier_company_id: Math.trunc(id),
    buyer_name: buyerName.slice(0, 200),
    buyer_phone: buyerPhone.slice(0, 32),
    buyer_email: buyerEmail.slice(0, 200),
    delivery_address,
    weight_kg: assertPositiveWeightKg(weightKg, 'weight_kg'),
    items
  };

  const cn = pickStr(courierDisplayName);
  if (cn) body.courier_name = cn.slice(0, 200);
  if (vendorId) body.vendor_id = String(vendorId);

  return body;
}

/**
 * @throws {Error} when required TruckingBookRequest fields are invalid
 */
export function buildTruckingBookPayload({
  vehicleTypeId = null,
  carrier = 'Borzo',
  pickupLat,
  pickupLng,
  deliveryLat,
  deliveryLng,
  contactPhone,
  weightKg,
  matter = null
}) {
  const coords = [pickupLat, pickupLng, deliveryLat, deliveryLng];
  if (coords.some((v) => v === null || v === undefined || v === '')) {
    const err = new Error(
      'pickup_lat, pickup_lng, delivery_lat, and delivery_lng are required for trucking booking'
    );
    err.code = 'LOGISTICS_VALIDATION';
    throw err;
  }
  const plat = Number(pickupLat);
  const plng = Number(pickupLng);
  const dlat = Number(deliveryLat);
  const dlng = Number(deliveryLng);
  if (![plat, plng, dlat, dlng].every((n) => Number.isFinite(n))) {
    const err = new Error(
      'pickup_lat, pickup_lng, delivery_lat, and delivery_lng are required for trucking booking'
    );
    err.code = 'LOGISTICS_VALIDATION';
    throw err;
  }

  const resolvedCarrier = String(carrier || 'Borzo').trim() || 'Borzo';
  const body = {
    carrier: resolvedCarrier,
    pickup_lat: plat,
    pickup_lng: plng,
    delivery_lat: dlat,
    delivery_lng: dlng,
    contact_phone: normalizeIndianLogisticsPhone(contactPhone),
    weight_kg: assertPositiveWeightKg(weightKg, 'weight_kg')
  };

  const vid = Number(vehicleTypeId);
  if (Number.isFinite(vid) && vid > 0) {
    body.vehicle_type_id = Math.trunc(vid);
  }

  const m = pickStr(matter);
  if (m) body.matter = m.slice(0, 500);

  return body;
}
