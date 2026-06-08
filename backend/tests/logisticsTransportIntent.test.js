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
  buildTruckingBookPayload
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
