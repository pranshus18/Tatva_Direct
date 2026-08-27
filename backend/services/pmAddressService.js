import {
  buildPmPlatformHeaders,
  pmUrl,
  withPmPlatformFlagQuery
} from '../config/pmApi.js';
import { supabase } from '../config/supabase.js';
import {
  fetchPmCurrentUser,
  fetchPmUserByPhone,
  getPmAuthFromUser,
  persistPmAuthCredentials
} from './pmUserService.js';

const PRESET_SUBTYPES = new Set(['HOME', 'WORK', 'OTHER']);

function clean(value) {
  return String(value || '').trim();
}

function normalizeIndianMobile(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function addressFingerprint(entry = {}) {
  return [
    clean(entry.building),
    clean(entry.zip || entry.pincode),
    clean(entry.state),
    clean(entry.locality || entry.city),
    clean(entry.street),
    clean(entry.line1),
    clean(entry.formatted_address)
  ]
    .join('|')
    .toLowerCase();
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
  const response = await fetch(withPmPlatformFlagQuery(pmUrl('address')), {
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

async function fetchPmAddressRowsFromUrl(url, accessToken, { usePlatformFlag = true } = {}) {
  const token = clean(accessToken);
  const headers = usePlatformFlag
    ? buildPmPlatformHeaders({ accessToken: token || undefined, json: false })
    : {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      };

  const response = await fetch(
    usePlatformFlag ? withPmPlatformFlagQuery(url) : url,
    { headers }
  );
  const body = await parsePmJson(response);

  if (!response.ok || body.success === false) {
    if (response.status === 401) {
      throw pmRequestError(response, body, 'PM session expired. Sign in again with phone OTP.');
    }
    return [];
  }

  return extractPmAddressList(body)
    .filter((row) => !clean(row?.type) || clean(row.type).toUpperCase() === 'SHIPPING')
    .map((row) => pmAddressToLocalShippingEntry(row))
    .filter((row) => row.building || row.line1 || row.formatted_address);
}

function buildPmAddressListUrls(userId) {
  const id = clean(userId);
  if (!id) return [];
  // PM list route is GET /api/address/user/:userId (not ?userId= query params).
  return [
    `${pmUrl('address')}/user/${encodeURIComponent(id)}?type=SHIPPING`,
    `${pmUrl('address')}/user/${encodeURIComponent(id)}`
  ];
}

export { buildPmAddressListUrls };

export async function listPmShippingAddresses({ pmUserId, accessToken, phoneNumber } = {}) {
  let userId = clean(pmUserId);
  const token = clean(accessToken);
  const phone = normalizeIndianMobile(phoneNumber);

  if (!userId && phone.length === 10) {
    const pmUser = await fetchPmUserByPhone(phone);
    userId = clean(pmUser?._id || pmUser?.id);
  }
  if (!userId) return [];

  const urls = buildPmAddressListUrls(userId);
  const attempts = [];

  for (const url of urls) {
    if (token) {
      attempts.push({ url, token, usePlatformFlag: true });
    }
    attempts.push({ url, token: token || null, usePlatformFlag: true });
  }

  let lastRows = [];
  for (const attempt of attempts) {
    try {
      const rows = await fetchPmAddressRowsFromUrl(attempt.url, attempt.token, {
        usePlatformFlag: attempt.usePlatformFlag
      });
      if (rows.length > 0) return rows;
      lastRows = rows;
    } catch (error) {
      if (error.code === 'PM_AUTH_REQUIRED') continue;
      throw error;
    }
  }

  return lastRows;
}

function localAddressExistsOnPm(localEntry = {}, pmAddresses = []) {
  const pmIds = new Set(
    pmAddresses
      .flatMap((entry) => [clean(entry.pmAddressId), clean(entry.id)])
      .filter(Boolean)
  );
  const localPmId = clean(localEntry.pmAddressId || localEntry.id);
  if (localPmId && pmIds.has(localPmId)) return true;

  const fingerprint = addressFingerprint(localEntry);
  if (!fingerprint) return false;
  return pmAddresses.some((entry) => addressFingerprint(entry) === fingerprint);
}

async function pushMissingLocalAddressesToPm(localAddresses = [], pmAddresses = [], auth = {}) {
  const token = clean(auth.accessToken);
  const pmUserId = clean(auth.pmUserId);
  if (!token || !pmUserId) return localAddresses;

  const nextLocal = [];
  for (const entry of localAddresses) {
    if (localAddressExistsOnPm(entry, pmAddresses)) {
      nextLocal.push(entry);
      continue;
    }

    try {
      const pmSaved = await createPmShippingAddress({
        pmUserId,
        accessToken: token,
        input: entry
      });
      nextLocal.push({
        ...entry,
        ...pmSaved,
        id: String(pmSaved.pmAddressId || pmSaved.id || entry.id || '').trim() || entry.id,
        pmAddressId: pmSaved.pmAddressId || pmSaved.id || entry.pmAddressId
      });
    } catch (pushError) {
      console.warn('[PM address] push local failed:', pushError?.message || pushError);
      nextLocal.push(entry);
    }
  }

  return nextLocal;
}

export function mergeLocalAndPmShippingAddresses(localAddresses = [], pmAddresses = []) {
  const merged = [];
  const seen = new Set();

  const remember = (entry) => {
    if (!entry) return;
    const keys = [clean(entry.pmAddressId), clean(entry.id)].filter(Boolean);
    const fingerprint = addressFingerprint(entry);
    if (keys.some((key) => seen.has(key))) return;
    if (fingerprint && seen.has(`fp:${fingerprint}`)) return;
    keys.forEach((key) => seen.add(key));
    if (fingerprint) seen.add(`fp:${fingerprint}`);
    merged.push(entry);
  };

  pmAddresses.forEach((entry) => remember(entry));
  localAddresses.forEach((entry) => remember(entry));
  return merged;
}

export async function resolvePmAddressAuth(user, credentials = {}, options = {}) {
  const requireToken = options.requireToken === true;
  const stored = getPmAuthFromUser(user) || {};
  let accessToken = clean(
    credentials?.pmAccessToken || credentials?.accessToken || stored.accessToken
  );
  let pmUserId = clean(
    stored.pmUserId ||
      user?.profile?.pmCustomerProfile?.pmUserId ||
      credentials?.pmUserId
  );

  if (accessToken) {
    const pmUserFromToken = await fetchPmCurrentUser(accessToken);
    if (pmUserFromToken) {
      pmUserId = clean(pmUserFromToken._id || pmUserFromToken.id) || pmUserId;
    } else if (requireToken) {
      const error = new Error('PM session expired. Sign in again with phone OTP.');
      error.code = 'PM_AUTH_REQUIRED';
      throw error;
    } else {
      accessToken = '';
    }
  }

  if (!pmUserId) {
    const phone = normalizeIndianMobile(
      user?.phone || user?.profile?.pmCustomerProfile?.phoneNumber
    );
    if (phone.length === 10) {
      const pmUser = await fetchPmUserByPhone(phone);
      pmUserId = clean(pmUser?._id || pmUser?.id);
    }
  }

  if (!pmUserId) {
    const error = new Error(
      requireToken
        ? 'Could not resolve your PM account. Sign in again with phone OTP.'
        : 'No PM account found for this phone number.'
    );
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }

  const refreshToken = clean(
    credentials?.pmRefreshToken || credentials?.refreshToken || stored.refreshToken
  );

  if (
    user?.id &&
    (pmUserId !== stored.pmUserId ||
      (accessToken && accessToken !== stored.accessToken) ||
      (!stored.pmUserId && pmUserId))
  ) {
    await persistPmAuthCredentials(user, {
      pmUserId,
      ...(accessToken ? { accessToken } : {}),
      ...(refreshToken ? { refreshToken } : {})
    });
  }

  if (requireToken && !accessToken) {
    const error = new Error(
      'Sign in with phone OTP to sync shipping addresses with the PM platform.'
    );
    error.code = 'PM_AUTH_REQUIRED';
    throw error;
  }

  return { pmUserId, accessToken: accessToken || null };
}

/** Pull PM shipping addresses for a phone-linked account and persist merged profile rows. */
export async function syncPmShippingAddressesOnProfile(user, credentials = {}) {
  const userType = String(user?.user_type || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (userType !== 'service_provider' && userType !== 'supplier') {
    return user;
  }

  const phone = normalizeIndianMobile(user?.phone || user?.profile?.pmCustomerProfile?.phoneNumber);
  if (phone.length !== 10) return user;

  try {
    let auth = null;
    try {
      auth = await resolvePmAddressAuth(user, credentials);
    } catch (authError) {
      const pmUser = await fetchPmUserByPhone(phone);
      const pmUserId = clean(pmUser?._id || pmUser?.id);
      if (!pmUserId) {
        console.warn('[PM address] sync skipped:', authError?.message || authError);
        return user;
      }
      const stored = getPmAuthFromUser(user) || {};
      auth = {
        pmUserId,
        accessToken:
          clean(credentials?.pmAccessToken || credentials?.accessToken || stored.accessToken) || null
      };
    }

    let localAddresses = Array.isArray(user?.profile?.shippingAddresses)
      ? user.profile.shippingAddresses
      : [];
    let pmList = await listPmShippingAddresses({
      pmUserId: auth.pmUserId,
      accessToken: auth.accessToken,
      phoneNumber: phone
    });

    if (auth.accessToken) {
      localAddresses = await pushMissingLocalAddressesToPm(localAddresses, pmList, auth);
      pmList = await listPmShippingAddresses({
        pmUserId: auth.pmUserId,
        accessToken: auth.accessToken,
        phoneNumber: phone
      });
    }

    const merged = mergeLocalAndPmShippingAddresses(localAddresses, pmList);
    const localJson = JSON.stringify(localAddresses);
    const mergedJson = JSON.stringify(merged);
    if (localJson === mergedJson) return user;

    const nextProfile = {
      ...(user.profile || {}),
      shippingAddresses: merged
    };
    if (userType === 'supplier') {
      nextProfile.branches = [];
    }

    const { data: updatedUser, error } = await supabase
      .from('users')
      .update({ profile: nextProfile })
      .eq('id', user.id)
      .select()
      .single();

    if (error || !updatedUser) {
      console.warn('[PM address] profile persist failed:', error?.message || error);
      return user;
    }

    return updatedUser;
  } catch (pmError) {
    console.warn('[PM address] sync skipped:', pmError?.message || pmError);
    return user;
  }
}
