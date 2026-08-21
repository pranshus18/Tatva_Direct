import {
  buildPmPlatformHeaders,
  PM_ADDRESS_URL,
  withPmPlatformFlagQuery
} from '../config/pmApi.js';
import { getPmAuthFromUser } from './pmUserService.js';
import { ensurePmVaultAuth } from './pmVaultService.js';

const PRESET_SUBTYPES = new Set(['HOME', 'WORK', 'OTHER']);

function clean(value) {
  return String(value || '').trim();
}

function pickFirst(...values) {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return '';
}

export function inferPmAddressSubType(input = {}) {
  const raw = pickFirst(input.subType, input.label, input.name).toUpperCase();
  if (PRESET_SUBTYPES.has(raw)) return raw;
  if (clean(input.subType) || clean(input.label)) {
    return clean(input.subType || input.label);
  }
  return 'HOME';
}

export function buildFormattedPmAddress(fields = {}) {
  return [
    fields.building,
    fields.buildingName,
    fields.floor,
    fields.street,
    fields.locality,
    fields.district,
    fields.state,
    fields.zip
  ]
    .map((part) => clean(part))
    .filter(Boolean)
    .join(', ');
}

export function toPmShippingAddressPayload(input = {}, pmUserId) {
  const userId = clean(pmUserId);
  const building = pickFirst(input.building, input.line1);
  const street = pickFirst(
    input.street,
    input.building ? input.line1 : '',
    input.building ? '' : clean(input.line1).split(',').slice(1).join(', ')
  );
  const locality = pickFirst(input.locality, input.city);
  const zip = pickFirst(input.zip, input.pincode, input.zipCode, input.postalCode);
  const state = pickFirst(input.state);
  const payload = {
    userId,
    type: pickFirst(input.type) || 'SHIPPING',
    subType: inferPmAddressSubType(input),
    building,
    buildingName: clean(input.buildingName),
    floor: clean(input.floor),
    street: street || (building && building !== clean(input.line1) ? clean(input.line1) : ''),
    locality,
    district: clean(input.district),
    zip,
    state,
    formatted_address: clean(input.formatted_address) || buildFormattedPmAddress({
      building,
      buildingName: clean(input.buildingName),
      floor: clean(input.floor),
      street: street || clean(input.line1),
      locality,
      district: clean(input.district),
      state,
      zip
    }),
    isDefault: input.isDefault === true
  };

  if (!payload.street && payload.building && payload.building !== clean(input.line1)) {
    payload.street = clean(input.line1);
  }

  return payload;
}

export function isPmShippingAddressPayloadComplete(payload = {}) {
  return Boolean(clean(payload.userId) && clean(payload.building) && clean(payload.zip) && clean(payload.state));
}

export function pmAddressToLocalShippingEntry(pmAddress = {}, fallback = {}) {
  const source = { ...fallback, ...(pmAddress && typeof pmAddress === 'object' ? pmAddress : {}) };
  const building = pickFirst(source.building);
  const buildingName = pickFirst(source.buildingName);
  const floor = pickFirst(source.floor);
  const street = pickFirst(source.street);
  const locality = pickFirst(source.locality, source.city);
  const district = pickFirst(source.district);
  const zip = pickFirst(source.zip, source.pincode, source.zipCode);
  const state = pickFirst(source.state);
  const formatted = pickFirst(source.formatted_address) || buildFormattedPmAddress({
    building,
    buildingName,
    floor,
    street,
    locality,
    district,
    state,
    zip
  });
  const line1 = [building, buildingName, floor, street].filter(Boolean).join(', ') || pickFirst(source.line1, formatted);
  const pmAddressId = pickFirst(source.pmAddressId, source._id, source.id);
  const subType = inferPmAddressSubType(source);

  return {
    id: pmAddressId || pickFirst(fallback.id),
    pmAddressId: pmAddressId || undefined,
    type: pickFirst(source.type) || 'SHIPPING',
    subType,
    label: pickFirst(source.label, subType),
    building,
    buildingName,
    floor,
    street,
    locality,
    district,
    zip,
    formatted_address: formatted,
    isDefault: source.isDefault === true,
    line1,
    city: locality || district || pickFirst(source.city) || 'India',
    state,
    pincode: zip,
    country: pickFirst(source.country) || 'India',
    ...(source.latitude != null ? { latitude: source.latitude } : {}),
    ...(source.longitude != null ? { longitude: source.longitude } : {}),
    ...(source.geoLocation ? { geoLocation: source.geoLocation } : {})
  };
}

function extractPmAddressRecord(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.data?.address && typeof payload.data.address === 'object' && !Array.isArray(payload.data.address)) {
    return payload.data.address;
  }
  if (payload.address && typeof payload.address === 'object' && !Array.isArray(payload.address)) {
    return payload.address;
  }
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    if (payload.data._id || payload.data.id || payload.data.building || payload.data.zip) {
      return payload.data;
    }
  }
  if (payload._id || payload.id || payload.building || payload.zip) {
    return payload;
  }
  return null;
}

function extractPmAddressList(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const candidates = [
    payload.data?.addresses,
    payload.data?.address,
    payload.addresses,
    payload.address,
    payload.data
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

async function parsePmJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function pmRequestError(response, payload, fallback) {
  const message =
    payload?.message ||
    payload?.error ||
    payload?.data?.message ||
    fallback ||
    `PM address request failed (${response.status})`;
  const error = new Error(message);
  error.status = response.status;
  error.code = response.status === 401 ? 'PM_AUTH_REQUIRED' : 'PM_ADDRESS_ERROR';
  return error;
}

export async function createPmShippingAddress({ pmUserId, accessToken, input = {} }) {
  const payload = toPmShippingAddressPayload(input, pmUserId);
  if (!isPmShippingAddressPayloadComplete(payload)) {
    const error = new Error('Building/House No, ZIP/Pincode, and State are required.');
    error.code = 'PM_ADDRESS_INCOMPLETE';
    throw error;
  }

  const token = clean(accessToken);
  const response = await fetch(withPmPlatformFlagQuery(PM_ADDRESS_URL), {
    method: 'POST',
    headers: buildPmPlatformHeaders({ accessToken: token, json: true }),
    body: JSON.stringify(payload)
  });
  const body = await parsePmJson(response);
  if (!response.ok || body.success === false) {
    throw pmRequestError(response, body, 'Failed to save shipping address to the PM platform.');
  }

  const created = extractPmAddressRecord(body) || payload;
  return pmAddressToLocalShippingEntry(created, payload);
}

export async function listPmShippingAddresses({ pmUserId, accessToken }) {
  const userId = clean(pmUserId);
  const token = clean(accessToken);
  if (!userId) return [];

  const urls = [
    withPmPlatformFlagQuery(`${PM_ADDRESS_URL}?userId=${encodeURIComponent(userId)}&type=SHIPPING`),
    withPmPlatformFlagQuery(`${PM_ADDRESS_URL}?userId=${encodeURIComponent(userId)}`)
  ];

  for (const url of urls) {
    const response = await fetch(url, {
      headers: buildPmPlatformHeaders({ accessToken: token, json: false })
    });
    const body = await parsePmJson(response);
    if (!response.ok || body.success === false) {
      if (response.status === 404) continue;
      if (response.status >= 500) continue;
      if (response.status === 401) {
        throw pmRequestError(response, body, 'PM session expired. Sign in again with phone OTP.');
      }
      continue;
    }
    const rows = extractPmAddressList(body)
      .filter((row) => !clean(row?.type) || clean(row.type).toUpperCase() === 'SHIPPING')
      .map((row) => pmAddressToLocalShippingEntry(row));
    if (rows.length > 0 || response.ok) {
      return rows.filter((row) => row.building || row.line1 || row.formatted_address);
    }
  }

  return [];
}

export function mergeLocalAndPmShippingAddresses(localAddresses = [], pmAddresses = []) {
  const merged = [];
  const seen = new Set();

  const remember = (entry) => {
    if (!entry) return;
    const keys = [clean(entry.pmAddressId), clean(entry.id)].filter(Boolean);
    if (keys.some((key) => seen.has(key))) return;
    keys.forEach((key) => seen.add(key));
    merged.push(entry);
  };

  pmAddresses.forEach((entry) => remember(entry));
  localAddresses.forEach((entry) => remember(entry));
  return merged;
}

export async function resolvePmAddressAuth(user, credentials = {}) {
  const stored = getPmAuthFromUser(user);
  const pmUserId = clean(
    stored?.pmUserId || user?.profile?.pmCustomerProfile?.pmUserId || credentials?.pmUserId
  );
  const accessToken = clean(credentials?.pmAccessToken || credentials?.accessToken || stored?.accessToken);

  if (pmUserId && accessToken) {
    return { pmUserId, accessToken };
  }

  return ensurePmVaultAuth(user, credentials);
}
