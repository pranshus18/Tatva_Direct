import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFormattedPmAddress,
  buildPmAddressListUrls,
  inferPmAddressSubType,
  isPmShippingAddressPayloadComplete,
  mergeLocalAndPmShippingAddresses,
  pmAddressToLocalShippingEntry,
  toPmShippingAddressPayload
} from '../services/pmAddressService.js';
import { PM_ADDRESS_URL } from '../config/pmApi.js';

test('toPmShippingAddressPayload uses the PM shipping contract', () => {
  const payload = toPmShippingAddressPayload(
    {
      subType: 'WORK',
      building: '123',
      buildingName: '1',
      floor: '2',
      street: '9th Main Road',
      locality: 'Bengaluru',
      district: 'Bengaluru Urban',
      zip: '560102',
      state: 'Karnataka',
      isDefault: false
    },
    '6a7445675c7140e3f8230508'
  );

  assert.equal(payload.userId, '6a7445675c7140e3f8230508');
  assert.equal(payload.type, 'SHIPPING');
  assert.equal(payload.subType, 'WORK');
  assert.equal(payload.building, '123');
  assert.equal(payload.zip, '560102');
  assert.equal(
    payload.formatted_address,
    '123, 1, 2, 9th Main Road, Bengaluru, Bengaluru Urban, Karnataka, 560102'
  );
  assert.equal(isPmShippingAddressPayloadComplete(payload), true);
});

test('toPmShippingAddressPayload maps legacy Tatva line1/city/pincode fields', () => {
  const payload = toPmShippingAddressPayload(
    {
      label: 'Warehouse',
      line1: 'Plot 9 Industrial Area',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
      country: 'India'
    },
    'pm-user-1'
  );

  assert.equal(payload.subType, 'Warehouse');
  assert.equal(payload.building, 'Plot 9 Industrial Area');
  assert.equal(payload.locality, 'Pune');
  assert.equal(payload.zip, '411001');
  assert.equal(payload.type, 'SHIPPING');
});

test('pmAddressToLocalShippingEntry keeps PM fields for Tatva order flows', () => {
  const entry = pmAddressToLocalShippingEntry({
    _id: 'addr-1',
    type: 'SHIPPING',
    subType: 'HOME',
    building: '12',
    street: 'MG Road',
    locality: 'Bengaluru',
    district: 'Bengaluru Urban',
    zip: '560001',
    state: 'Karnataka'
  });

  assert.equal(entry.id, 'addr-1');
  assert.equal(entry.pmAddressId, 'addr-1');
  assert.equal(entry.line1, '12, MG Road');
  assert.equal(entry.city, 'Bengaluru');
  assert.equal(entry.pincode, '560001');
  assert.equal(entry.country, 'India');
});

test('mergeLocalAndPmShippingAddresses prefers PM ids and keeps extras', () => {
  const merged = mergeLocalAndPmShippingAddresses(
    [
      { id: 'local-1', pmAddressId: 'pm-1', line1: 'Old' },
      { id: 'local-only', line1: 'Keep me' }
    ],
    [{ id: 'pm-1', pmAddressId: 'pm-1', line1: 'From PM' }]
  );

  assert.equal(merged[0].line1, 'From PM');
  assert.equal(merged.some((entry) => entry.id === 'local-only'), true);
});

test('mergeLocalAndPmShippingAddresses dedupes by address fingerprint', () => {
  const merged = mergeLocalAndPmShippingAddresses(
    [{ id: 'local-1', building: '12', zip: '560001', state: 'Karnataka', locality: 'Bengaluru' }],
    [{ id: 'pm-99', pmAddressId: 'pm-99', building: '12', zip: '560001', state: 'Karnataka', locality: 'Bengaluru' }]
  );

  assert.equal(merged.length, 1);
  assert.equal(merged[0].pmAddressId, 'pm-99');
});

test('buildPmAddressListUrls uses PM user path routes', () => {
  const urls = buildPmAddressListUrls('pm-user-1');
  assert.equal(urls.length, 2);
  assert.equal(urls[0], `${PM_ADDRESS_URL}/user/pm-user-1?type=SHIPPING`);
  assert.equal(urls[1], `${PM_ADDRESS_URL}/user/pm-user-1`);
});

test('inferPmAddressSubType and formatted address helpers', () => {
  assert.equal(inferPmAddressSubType({ subType: 'home' }), 'HOME');
  assert.equal(inferPmAddressSubType({ label: 'Work' }), 'WORK');
  assert.equal(
    buildFormattedPmAddress({
      building: '123',
      street: '9th Main Road',
      locality: 'Bengaluru',
      state: 'Karnataka',
      zip: '560102'
    }),
    '123, 9th Main Road, Bengaluru, Karnataka, 560102'
  );
});
