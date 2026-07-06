import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyQuoteProvider,
  resolveBookingIntent,
  TRANSPORT_KIND
} from '../utils/logisticsTransportIntent.js';
import { computeGroupWeightKg } from '../controllers/logisticsController.js';
import { resolveShipmentQuoteStrategy } from '../utils/logisticsQuotePolicy.js';
import {
  buildBookCourierCheckoutPayload,
  buildTruckingBookPayload,
  buildQuoteTransportGroupBody,
  buildScheduleCourierPayload,
  mapShipmentToLogisticsQuoteBody
} from '../utils/logisticsApiPayload.js';

test('classifyQuoteProvider prefers trucking when vehicle_type_id is set', () => {
  assert.equal(
    classifyQuoteProvider({ source: 'shiprocket', vehicle_type_id: 12, courier_company_id: 99 }),
    TRANSPORT_KIND.TRUCKING
  );
});

test('classifyQuoteProvider marks Shiprocket rows as courier', () => {
  assert.equal(classifyQuoteProvider({ courier_company_id: 42, source: 'shiprocket' }), TRANSPORT_KIND.COURIER);
});

test('resolveBookingIntent uses transportMode courier strictly', () => {
  const intent = resolveBookingIntent({
    transportMode: 'courier',
    courierCompanyId: 10
  });
  assert.equal(intent.kind, TRANSPORT_KIND.COURIER);
  assert.equal(intent.courierCompanyId, 10);
});

test('resolveBookingIntent rejects courier mode without courier_company_id', () => {
  const intent = resolveBookingIntent({ transportMode: 'courier' });
  assert.equal(intent.kind, null);
  assert.match(intent.error || '', /courier_company_id/i);
});

test('resolveBookingIntent uses transportMode trucking with coordinates', () => {
  const intent = resolveBookingIntent({
    transportMode: 'trucking',
    vehicleTypeId: 3,
    pickupLat: 12.9,
    pickupLng: 77.6,
    deliveryLat: 12.95,
    deliveryLng: 77.65,
    carrier: 'Borzo'
  });
  assert.equal(intent.kind, TRANSPORT_KIND.TRUCKING);
  assert.equal(intent.vehicleTypeId, 3);
  assert.equal(intent.carrier, 'Borzo');
});

test('resolveBookingIntent rejects trucking mode without coordinates', () => {
  const intent = resolveBookingIntent({ transportMode: 'trucking', vehicleTypeId: 1 });
  assert.equal(intent.kind, null);
  assert.match(intent.error || '', /coordinates/i);
});

test('resolveBookingIntent supports self ship without external provider IDs', () => {
  const intent = resolveBookingIntent({ transportMode: 'self_ship' });
  assert.equal(intent.kind, TRANSPORT_KIND.SELF_SHIP);
});

test('inter-city light lane requests courier quotes only', () => {
  const s = resolveShipmentQuoteStrategy({
    weightKg: 5,
    category: 'general',
    pickupPincode: '110001',
    deliveryPincode: '400001',
    pickupCity: 'Delhi',
    deliveryCity: 'Mumbai'
  });
  assert.equal(s.mode, 'courier');
  assert.equal(s.intercity, true);
  assert.equal(s.allowCourierFallback, false);
});

test('same-city heavy lane requests trucking quotes', () => {
  const s = resolveShipmentQuoteStrategy({
    weightKg: 50,
    category: 'paint',
    pickupPincode: '560001',
    deliveryPincode: '560002',
    pickupCity: 'Bengaluru',
    deliveryCity: 'Bengaluru'
  });
  assert.equal(s.mode, 'trucking');
  assert.equal(s.sameCity, true);
  assert.equal(s.heavy, true);
});

test('buildBookCourierCheckoutPayload rejects missing/invalid weight', () => {
  assert.throws(
    () =>
      buildBookCourierCheckoutPayload({
        courierCompanyId: 7,
        deliveryAddress: {
          line1: '12 MG Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001'
        },
        sessionBuyer: { name: 'Buyer', email: 'b@test.com', phone: '9876543210' },
        lines: [{ name: 'Paint', quantity: 1, unit_price: 100, total_price: 100 }],
        weightKg: 0,
        orderNumber: 'PO-1'
      }),
    /weight_kg must be a positive number/
  );
});

test('buildTruckingBookPayload requires coordinates', () => {
  assert.throws(
    () =>
      buildTruckingBookPayload({
        pickupLat: 1,
        pickupLng: 2,
        deliveryLat: null,
        deliveryLng: 4,
        contactPhone: '9876543210',
        weightKg: 40
      }),
    /delivery_lat/
  );
});

test('computeGroupWeightKg supports decimal kilogram values', () => {
  const weight = computeGroupWeightKg({
    items: [
      { quantity: 2, specifications: { Weight: '1.25 kg' } }
    ]
  });
  assert.equal(weight, 2.5);
});

test('computeGroupWeightKg parses gram values into decimal kg', () => {
  const weight = computeGroupWeightKg({
    items: [
      { quantity: 3, specifications: { weight: '250 g' } }
    ]
  });
  assert.equal(weight, 0.75);
});

test('mapShipmentToLogisticsQuoteBody uses supplier UUID as vendorId and snake_case coords', () => {
  const body = mapShipmentToLogisticsQuoteBody(
    {
      vendorId: '88b2ad28-0120-4bcb-a0d2-99dc922bed62',
      supplierVendorId: '88b2ad28-0120-4bcb-a0d2-99dc922bed62',
      transportGroupId: '88b2ad28-0120-4bcb-a0d2-99dc922bed62::hsr-560102',
      vendorName: 'karthik',
      pickupPincode: '411026',
      pickupAddress: { line1: 'Pune', city: 'Pune', state: 'Maharashtra', country: 'India', pincode: '411026' },
      pickupLat: 18.6374972,
      pickupLng: 73.8360251,
      deliveryLat: 12.9347862,
      deliveryLng: 77.6341896,
      weightKg: 1.5,
      items: [{ name: 'Mac Air M2', quantity: 1, price: 85, specifications: { Weight: '1.5 kg' } }]
    },
    {
      line1: '384, 9th Main Road, HSR Layout',
      city: 'Bengaluru',
      state: 'Karnataka',
      country: 'India',
      pincode: '560102'
    }
  );
  assert.equal(body.vendorId, '88b2ad28-0120-4bcb-a0d2-99dc922bed62');
  assert.notEqual(body.vendorId, body.transportGroupId);
  assert.equal(body.pickup_lat, 18.6374972);
  assert.equal(body.delivery_lng, 77.6341896);
  assert.equal(body.weight_kg, 1.5);
  assert.equal(body.shippingAddress.pincode, '560102');
});

test('buildQuoteTransportGroupBody preserves groups[] camelCase shape', () => {
  const body = buildQuoteTransportGroupBody(
    {
      vendorId: 'vendor-a',
      transportGroupId: 'vendor-a::hsr-560102',
      vendorName: 'karthik',
      total: 167,
      pickupPincode: '411026',
      pickupAddress: { line1: 'Pune', city: 'Pune', state: 'Maharashtra', country: 'India', pincode: '411026' },
      items: [{ name: 'Mac Air M2', quantity: 2, price: 85, specifications: { Weight: '1.5 kg' } }]
    },
    {
      shippingAddress: {
        line1: 'HSR',
        city: 'Bengaluru',
        state: 'Karnataka',
        country: 'India',
        pincode: '560102'
      },
      pickupLat: 18.5,
      pickupLng: 73.8,
      deliveryLat: 12.9,
      deliveryLng: 77.6,
      weightKg: 3,
      correlationId: 'vendor-a::hsr-560102'
    }
  );
  assert.equal(body.vendorId, 'vendor-a');
  assert.equal(body.transportGroupId, 'vendor-a::hsr-560102');
  assert.equal(body.weight_kg, 3);
  assert.equal(body.pickup_lat, 18.5);
  assert.equal(body.delivery_lng, 77.6);
  assert.equal(body.items.length, 1);
  assert.equal(body.correlation_id, 'vendor-a::hsr-560102');
});

test('buildScheduleCourierPayload uses schedule-courier field names', () => {
  const body = buildScheduleCourierPayload({
    courierCompanyId: 43,
    courierDisplayName: 'Delhivery Surface',
    deliveryAddress: {
      line1: 'Site Plot 12',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001'
    },
    sessionBuyer: { name: 'Builder Co', email: 'builder@test.com', phone: '9876543210' },
    weightKg: 20,
    expectedDeliveryDate: '2026-07-15',
    transitDays: 3,
    pickupPincode: '562123',
    clientReference: 'vendor-a::hsr-560102',
    orderId: 'uuid-from-ecommerce'
  });
  assert.equal(body.customer_name, 'Builder Co');
  assert.equal(body.phone, '9876543210');
  assert.equal(body.expected_delivery_date, '2026-07-15');
  assert.equal(body.transit_days, 3);
  assert.equal(body.pickup_pincode, '562123');
  assert.equal(body.client_reference, 'vendor-a::hsr-560102');
  assert.equal(body.ecommerce_order_id, 'uuid-from-ecommerce');
});

test('buildBookCourierCheckoutPayload accepts clientReference override', () => {
  const body = buildBookCourierCheckoutPayload({
    courierCompanyId: 7,
    deliveryAddress: {
      line1: '12 MG Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001'
    },
    sessionBuyer: { name: 'Buyer', email: 'b@test.com', phone: '9876543210' },
    lines: [{ name: 'Paint', quantity: 1, unit_price: 100, total_price: 100 }],
    weightKg: 5,
    clientReference: 'vendor-a::hsr-560102'
  });
  assert.equal(body.client_reference, 'vendor-a::hsr-560102');
});
