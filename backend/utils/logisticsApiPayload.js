/**
 * Strict request bodies for Tatva Logistics module (openapi.json).
 * Quote: TransportGroupQuoteRequest → POST /api/logistics/quote-transport-group(s)
 * Courier: BookCourierCheckoutRequest → POST /api/logistics/book-courier-checkout
 * Schedule: ScheduleCourierRequest → POST /api/logistics/schedule-courier
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
/**
 * Map one Tatva Direct shipment/group meta → logistics quote-transport-group body.
 * vendorId must be the supplier UUID (not transportGroupId). Coordinates are snake_case.
 */
export function mapShipmentToLogisticsQuoteBody(shipmentMeta = {}, deliveryAddress = null) {
  const supplierVendorId = String(
    shipmentMeta.supplierVendorId || shipmentMeta.vendorId || ''
  ).trim();
  const transportGroupId = String(shipmentMeta.transportGroupId || '').trim();
  const shippingAddress =
    (shipmentMeta.shippingAddress && typeof shipmentMeta.shippingAddress === 'object'
      ? shipmentMeta.shippingAddress
      : null) ||
    (shipmentMeta.deliveryAddress && typeof shipmentMeta.deliveryAddress === 'object'
      ? shipmentMeta.deliveryAddress
      : null) ||
    deliveryAddress;

  const items = (Array.isArray(shipmentMeta.items) ? shipmentMeta.items : []).map((item) => ({
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    specifications:
      item.specifications && typeof item.specifications === 'object' && !Array.isArray(item.specifications)
        ? item.specifications
        : {}
  }));

  const body = {
    vendorId: supplierVendorId,
    transportGroupId: transportGroupId || supplierVendorId,
    vendorName: String(shipmentMeta.vendorName || ''),
    pickupPincode: String(shipmentMeta.pickupPincode || shipmentMeta.pickupAddress?.pincode || '')
      .replace(/\D/g, '')
      .slice(0, 6),
    pickupAddress: shipmentMeta.pickupAddress || null,
    shippingAddress,
    items,
    pickup_lat: shipmentMeta.pickupLat ?? shipmentMeta.pickup_lat ?? null,
    pickup_lng: shipmentMeta.pickupLng ?? shipmentMeta.pickup_lng ?? null,
    delivery_lat: shipmentMeta.deliveryLat ?? shipmentMeta.delivery_lat ?? null,
    delivery_lng: shipmentMeta.deliveryLng ?? shipmentMeta.delivery_lng ?? null
  };

  const w = Number(shipmentMeta.weightKg ?? shipmentMeta.weight_kg);
  if (Number.isFinite(w) && w > 0) body.weight_kg = Math.round(w * 1000) / 1000;

  const cat = pickStr(shipmentMeta.category);
  if (cat) body.category = cat;

  const corr = pickStr(shipmentMeta.correlationId, transportGroupId);
  if (corr) body.correlation_id = corr.slice(0, 240);

  return body;
}

/**
 * One object from POST /api/po/group `groups[]` → quote-transport-group body (camelCase).
 */
export function buildQuoteTransportGroupBody(
  group,
  {
    shippingAddress,
    pickupLat = null,
    pickupLng = null,
    deliveryLat = null,
    deliveryLng = null,
    weightKg = null,
    category = null,
    correlationId = null
  } = {}
) {
  const items = (Array.isArray(group?.items) ? group.items : []).map((item) => ({
    name: item.name,
    quantity: item.quantity,
    price: item.price,
    specifications:
      item.specifications && typeof item.specifications === 'object' && !Array.isArray(item.specifications)
        ? item.specifications
        : {}
  }));

  const body = {
    vendorId: String(group.vendorId || ''),
    transportGroupId: String(group.transportGroupId || group.vendorId || ''),
    vendorName: String(group.vendorName || ''),
    total: Number(group.total) || 0,
    pickupPincode: String(group.pickupPincode || group.pickupAddress?.pincode || '').replace(/\D/g, '').slice(0, 6),
    pickupAddress: group.pickupAddress || null,
    shippingAddress: shippingAddress || group.shippingAddress || null,
    items,
    pickup_lat: pickupLat,
    pickup_lng: pickupLng,
    delivery_lat: deliveryLat,
    delivery_lng: deliveryLng
  };

  const w = Number(weightKg);
  if (Number.isFinite(w) && w > 0) body.weight_kg = Math.round(w * 1000) / 1000;
  const cat = pickStr(category);
  if (cat) body.category = cat;
  const corr = pickStr(correlationId, group.transportGroupId);
  if (corr) body.correlation_id = corr.slice(0, 240);

  return body;
}

function formatIsoDateYmd(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * @throws {Error} when required ScheduleCourierRequest fields are invalid
 */
export function buildScheduleCourierPayload({
  courierCompanyId,
  courierDisplayName = null,
  deliveryAddress,
  sessionBuyer,
  weightKg,
  expectedDeliveryDate,
  transitDays,
  bufferDays = 1,
  pickupPincode,
  clientReference = null,
  orderId = null,
  orderNumber = null,
  ecommerceOrderId = null,
  etdRaw = null
}) {
  const id = Number(courierCompanyId);
  if (!Number.isFinite(id) || id <= 0) {
    const err = new Error('courier_company_id must be a positive integer');
    err.code = 'LOGISTICS_VALIDATION';
    throw err;
  }

  const deliveryDate = formatIsoDateYmd(expectedDeliveryDate);
  if (!deliveryDate) {
    const err = new Error('expected_delivery_date must be a valid YYYY-MM-DD date');
    err.code = 'LOGISTICS_VALIDATION';
    throw err;
  }

  const td = Number(transitDays);
  if (!Number.isFinite(td) || td < 0) {
    const err = new Error('transit_days must be a non-negative number');
    err.code = 'LOGISTICS_VALIDATION';
    throw err;
  }

  const pin = String(pickupPincode || '').replace(/\D/g, '').slice(0, 6);
  if (pin.length !== 6) {
    const err = new Error('pickup_pincode must be a 6-digit Indian pincode');
    err.code = 'LOGISTICS_VALIDATION';
    throw err;
  }

  const customerName = pickStr(sessionBuyer?.name, sessionBuyer?.company) || 'Customer';
  const phone = normalizeIndianLogisticsPhone(sessionBuyer?.phone);
  const email = pickStr(sessionBuyer?.email) || 'noreply@tatva.local';
  const clientRef =
    pickStr(clientReference, orderNumber) ||
    (orderId ? `tatva-order:${orderId}` : `tatva-schedule:${Date.now()}`);

  const body = {
    client_reference: clientRef.slice(0, 240),
    courier_company_id: Math.trunc(id),
    customer_name: customerName.slice(0, 200),
    phone: phone.slice(0, 32),
    email: email.slice(0, 200),
    expected_delivery_date: deliveryDate,
    transit_days: Math.trunc(td),
    buffer_days: Math.max(0, Math.trunc(Number(bufferDays) || 0)),
    pickup_pincode: pin,
    delivery_address: assertBookCourierAddress(deliveryAddress),
    weight_kg: assertPositiveWeightKg(weightKg, 'weight_kg')
  };

  const cn = pickStr(courierDisplayName);
  if (cn) body.courier_name = cn.slice(0, 200);
  if (orderId) body.ecommerce_order_id = String(orderId);
  else if (ecommerceOrderId) body.ecommerce_order_id = String(ecommerceOrderId);
  const etd = pickStr(etdRaw);
  if (etd) body.etd_raw = etd.slice(0, 120);

  return body;
}

export function buildBookCourierCheckoutPayload({
  courierCompanyId,
  courierDisplayName = null,
  deliveryAddress,
  sessionBuyer,
  lines,
  weightKg,
  orderId,
  orderNumber,
  vendorId = null,
  clientReference = null,
  transportAmount = null
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
    pickStr(clientReference, orderNumber) ||
    (orderId ? `tatva-order:${orderId}` : `tatva-booking:${Date.now()}`);

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
  if (orderId) body.ecommerce_order_id = String(orderId);

  const freight = Number(transportAmount);
  if (Number.isFinite(freight) && freight > 0) {
    body.transport_amount = Math.round(freight * 100) / 100;
    body.charge_logistics_vault = true;
  }

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
  matter = null,
  orderId = null,
  transportAmount = null
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

  if (orderId) body.ecommerce_order_id = String(orderId);
  const freight = Number(transportAmount);
  if (Number.isFinite(freight) && freight > 0) {
    body.transport_amount = Math.round(freight * 100) / 100;
    body.charge_logistics_vault = true;
  }

  return body;
}
