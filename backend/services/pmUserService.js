import { supabase } from '../config/supabase.js';
import {
  buildPmUserUrl,
  buildPmPlatformHeaders,
  PM_USER_FLAG_SERVICE_PROVIDER,
  PM_USER_FLAG_SUPPLIER,
  pmUrl,
  withPmPlatformFlagQuery
} from '../config/pmApi.js';

function normalizeIndianMobile(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

function phonesMatch(left, right) {
  const a = normalizeIndianMobile(left);
  const b = normalizeIndianMobile(right);
  return Boolean(a && b && a.length === 10 && a === b);
}

function isPmPlaceholderEmail(email) {
  return /@phone\.tatvadirect\.local$/i.test(String(email || '').trim());
}

function mergePmUserRecords(...records) {
  const merged = {};

  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    Object.entries(record).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        merged[key] = value;
      }
    });
  }

  return Object.keys(merged).length > 0 ? merged : null;
}

export function mapPmUserToCustomerProfile(pmUser) {
  if (!pmUser || typeof pmUser !== 'object') return null;

  return {
    pmUserId: String(pmUser._id || pmUser.id || '').trim() || null,
    fullName: String(pmUser.fullName || pmUser.name || '').trim(),
    userName: String(pmUser.userName || pmUser.username || '').trim(),
    email: String(pmUser.email || '').trim().toLowerCase(),
    phoneNumber: normalizeIndianMobile(pmUser.phoneNumber || pmUser.phone),
    status: String(pmUser.status || 'active').trim() || 'active',
    isEmailVerified: pmUser.isEmailVerified === true,
    flag: String(pmUser.flag || '').trim(),
    role: String(pmUser.role || 'user').trim() || 'user',
    profileImageUrl: String(pmUser.profileImage?.url || '').trim()
  };
}

function buildPmCustomerUpdatePayload(fields = {}) {
  const payload = {};

  const fullName = String(fields.fullName || '').trim();
  const userName = String(fields.userName || '').trim();
  const email = String(fields.email || '').trim().toLowerCase();
  const phoneNumber = normalizeIndianMobile(fields.phoneNumber);
  const status = String(fields.status || 'active').trim() || 'active';
  const flag = String(fields.flag || '').trim();

  if (fullName) payload.fullName = fullName;
  if (userName) payload.userName = userName;
  if (email) payload.email = email;
  if (phoneNumber) payload.phoneNumber = phoneNumber;
  if (status) payload.status = status;
  if (flag) payload.flag = flag;

  return payload;
}

export function resolvePmPortalFlag(user) {
  const portal = String(user?.user_type || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (portal === 'supplier') return PM_USER_FLAG_SUPPLIER;
  if (portal === 'service_provider') return PM_USER_FLAG_SERVICE_PROVIDER;
  return null;
}

export function getPmAuthFromUser(user) {
  const auth = user?.profile?.pmCustomerAuth;
  if (!auth || typeof auth !== 'object') return null;

  const pmUserId =
    String(auth.pmUserId || user?.profile?.pmCustomerProfile?.pmUserId || '').trim() || null;
  const accessToken = String(auth.accessToken || '').trim() || null;
  const refreshToken = String(auth.refreshToken || '').trim() || null;

  if (!pmUserId && !accessToken) return null;

  return { pmUserId, accessToken, refreshToken };
}

export function isTatvaCustomerProfileEstablished(user, localFields = null) {
  const name = String(localFields?.fullName || user?.name || '').trim();
  const email = String(localFields?.email || user?.email || '').trim().toLowerCase();
  const phone = normalizeIndianMobile(localFields?.phoneNumber || user?.phone);

  if (user?.profile?.profileIncomplete === false) {
    return true;
  }

  return (
    Boolean(name && name !== 'User') &&
    Boolean(phone && phone.length === 10) &&
    Boolean(email && !isPmPlaceholderEmail(email))
  );
}

function resolveLocalCustomerFields(user, localCustomerFields = null) {
  const pmStored = user?.profile?.pmCustomerProfile || {};
  const portalFlag = resolvePmPortalFlag(user);

  return {
    fullName: String(localCustomerFields?.fullName || pmStored.fullName || user?.name || '').trim(),
    userName: String(localCustomerFields?.userName || pmStored.userName || '').trim(),
    email: String(localCustomerFields?.email || pmStored.email || user?.email || '')
      .trim()
      .toLowerCase(),
    phoneNumber: normalizeIndianMobile(
      localCustomerFields?.phoneNumber || pmStored.phoneNumber || user?.phone
    ),
    status: String(localCustomerFields?.status || pmStored.status || 'active').trim() || 'active',
    flag: String(localCustomerFields?.flag || portalFlag || pmStored.flag || '').trim(),
    pmUserId: String(
      localCustomerFields?.pmUserId || pmStored.pmUserId || getPmAuthFromUser(user)?.pmUserId || ''
    ).trim()
  };
}

export async function fetchPmCurrentUser(accessToken, options = {}) {
  const token = String(accessToken || '').trim();
  if (!token) return null;

  const response = await fetch(withPmPlatformFlagQuery(pmUrl('usersMe')), {
    headers: buildPmPlatformHeaders({ accessToken: token })
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.success === false) {
    if (options.throwOnUnauthorized && response.status === 401) {
      const error = new Error('PM session expired. Sign in again with phone OTP.');
      error.code = 'PM_AUTH_REQUIRED';
      throw error;
    }
    return null;
  }

  return payload?.data?.user || payload?.data || payload?.user || null;
}

export async function fetchPmUserById(pmUserId, accessToken = null) {
  const url = withPmPlatformFlagQuery(buildPmUserUrl(pmUserId));
  if (!url) return null;

  const token = String(accessToken || '').trim();
  const response = await fetch(url, {
    headers: buildPmPlatformHeaders({ accessToken: token })
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.success === false) {
    return null;
  }

  return payload?.data?.user || payload?.data || payload?.user || null;
}

export async function fetchPmUserByPhone(phoneNumber) {
  const normalizedPhone = normalizeIndianMobile(phoneNumber);
  if (!normalizedPhone || normalizedPhone.length !== 10) {
    return null;
  }

  let page = 1;
  let totalPages = 1;
  const limit = 100;

  while (page <= totalPages) {
    const url = withPmPlatformFlagQuery(`${pmUrl('users')}?page=${page}&limit=${limit}`);
    const response = await fetch(url, {
      headers: buildPmPlatformHeaders()
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok || payload.success === false) {
      break;
    }

    const users = Array.isArray(payload?.data?.users) ? payload.data.users : [];
    totalPages = Math.max(1, Number(payload?.data?.totalPages || 1));

    const match = users.find((entry) => phonesMatch(entry?.phoneNumber, normalizedPhone));
    if (match) {
      return match;
    }

    page += 1;
  }

  return null;
}

export async function resolvePmUserForPhone({ phoneNumber, pmProfile = null, pmAccessToken = null } = {}) {
  const normalizedPhone = normalizeIndianMobile(phoneNumber);
  if (!normalizedPhone) return null;

  const fromToken = pmAccessToken ? await fetchPmCurrentUser(pmAccessToken) : null;
  const fromDirectory = await fetchPmUserByPhone(normalizedPhone);
  const fromProfile = pmProfile
    ? {
        _id: pmProfile.pmUserId,
        fullName: pmProfile.fullName || pmProfile.name,
        userName: pmProfile.userName,
        email: pmProfile.email,
        phoneNumber: normalizeIndianMobile(pmProfile.phoneNumber || normalizedPhone),
        status: pmProfile.status,
        isEmailVerified: pmProfile.isEmailVerified,
        flag: pmProfile.flag,
        role: pmProfile.role
      }
    : null;

  return mergePmUserRecords(fromProfile, fromDirectory, fromToken);
}

export async function updatePmCustomerProfileOnPlatform({ pmUserId, accessToken, fields = {} }) {
  const id = String(pmUserId || '').trim();
  const token = String(accessToken || '').trim();
  const url = buildPmUserUrl(id);

  if (!url) {
    throw new Error('PM user id is missing. Sign in again with phone OTP.');
  }
  if (!token) {
    throw new Error('PM session expired. Sign in again with phone OTP to sync profile changes.');
  }

  const body = buildPmCustomerUpdatePayload(fields);
  if (Object.keys(body).length === 0) {
    throw new Error('No customer profile fields to sync with PM.');
  }

  const response = await fetch(withPmPlatformFlagQuery(url), {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    // Body `flag` stays portal role (service_provider/supplier).
    // Query `flag=tatvadirect` selects the PM tenant database.
    body: JSON.stringify(body)
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok || payload.success === false) {
    const message =
      payload?.message ||
      payload?.error ||
      `PM profile update failed (${response.status})`;
    throw new Error(message);
  }

  return payload?.data?.user || payload?.data || payload?.user || payload;
}

export async function persistPmAuthCredentials(user, credentials = {}) {
  if (!user?.id) return user;

  const pmUserId = String(
    credentials.pmUserId || user?.profile?.pmCustomerProfile?.pmUserId || ''
  ).trim();
  const accessToken = String(credentials.accessToken || '').trim();
  const refreshToken = String(credentials.refreshToken || '').trim();

  if (!pmUserId && !accessToken) {
    return user;
  }

  const nextProfile = {
    ...(user.profile || {}),
    pmCustomerAuth: {
      ...(user.profile?.pmCustomerAuth || {}),
      ...(pmUserId ? { pmUserId } : {}),
      ...(accessToken ? { accessToken } : {}),
      ...(refreshToken ? { refreshToken } : {}),
      updatedAt: new Date().toISOString()
    }
  };

  if (pmUserId) {
    nextProfile.pmCustomerProfile = {
      ...(user.profile?.pmCustomerProfile || {}),
      pmUserId
    };
  }

  const { data: updatedUser, error } = await supabase
    .from('users')
    .update({ profile: nextProfile })
    .eq('id', user.id)
    .select()
    .single();

  if (error || !updatedUser) {
    console.error('persistPmAuthCredentials error:', error);
    return user;
  }

  return updatedUser;
}

export async function pushPmPortalFlagToPlatform(user) {
  const auth = getPmAuthFromUser(user);
  const flag = resolvePmPortalFlag(user);
  const phoneNumber = normalizeIndianMobile(user?.phone);
  const pmUserId = String(
    user?.profile?.pmCustomerProfile?.pmUserId || auth?.pmUserId || ''
  ).trim();
  const accessToken = String(auth?.accessToken || '').trim();

  if (!flag || !pmUserId || !accessToken) {
    return null;
  }

  return updatePmCustomerProfileOnPlatform({
    pmUserId,
    accessToken,
    fields: {
      flag,
      phoneNumber
    }
  });
}

export async function pushLocalCustomerProfileToPm(user, localCustomerFields = null) {
  const auth = getPmAuthFromUser(user);
  const fields = resolveLocalCustomerFields(user, localCustomerFields);
  const pmUserId = String(fields.pmUserId || auth?.pmUserId || '').trim();
  const accessToken = String(auth?.accessToken || '').trim();

  if (!pmUserId || !accessToken) {
    throw new Error('PM credentials missing. Sign in again with phone OTP.');
  }

  return updatePmCustomerProfileOnPlatform({
    pmUserId,
    accessToken,
    fields: {
      ...fields,
      flag: resolvePmPortalFlag(user) || fields.flag
    }
  });
}

export async function applyPmCustomerProfileToUser(user, pmUser, options = {}) {
  if (!user?.id || !pmUser) return user;

  const pmCustomerProfile = mapPmUserToCustomerProfile(pmUser);
  if (!pmCustomerProfile) return user;

  const syncIdentityFromPm = options.syncIdentityFromPm !== false;

  const nextProfile = {
    ...(user.profile || {}),
    pmCustomerProfile,
    pmCustomerProfileSyncedAt: new Date().toISOString()
  };

  if (
    user.profile?.profileIncomplete === true &&
    pmCustomerProfile.fullName &&
    pmCustomerProfile.email &&
    !isPmPlaceholderEmail(pmCustomerProfile.email)
  ) {
    nextProfile.profileIncomplete = false;
  }

  const updates = { profile: nextProfile };

  if (syncIdentityFromPm) {
    if (pmCustomerProfile.fullName) {
      updates.name = pmCustomerProfile.fullName;
    }

    if (pmCustomerProfile.email && !isPmPlaceholderEmail(pmCustomerProfile.email)) {
      updates.email = pmCustomerProfile.email;
    }

    if (pmCustomerProfile.phoneNumber) {
      updates.phone = pmCustomerProfile.phoneNumber;
    }
  } else {
    if (
      pmCustomerProfile.fullName &&
      (!String(user.name || '').trim() || user.name === 'User')
    ) {
      updates.name = pmCustomerProfile.fullName;
    }

    if (pmCustomerProfile.email && isPmPlaceholderEmail(user.email)) {
      updates.email = pmCustomerProfile.email;
    }

    if (pmCustomerProfile.phoneNumber && !normalizeIndianMobile(user.phone)) {
      updates.phone = pmCustomerProfile.phoneNumber;
    }
  }

  const { data: updatedUser, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', user.id)
    .select()
    .single();

  if (error || !updatedUser) {
    console.error('applyPmCustomerProfileToUser error:', error);
    return user;
  }

  return updatedUser;
}

export async function syncPmCustomerProfileForUser(user, options = {}) {
  const phone = normalizeIndianMobile(user?.phone);
  if (!phone) return user;

  const auth = getPmAuthFromUser(user);
  const pmAccessToken = options.pmAccessToken || auth?.accessToken || null;
  const localCustomerFields = options.localCustomerFields || null;
  const pushLocalFirst = options.pushLocalFirst === true;
  const shouldPush =
    pushLocalFirst ||
    (options.pushIfEstablished === true &&
      isTatvaCustomerProfileEstablished(user, localCustomerFields));

  let pmUser = null;

  if (shouldPush && pmAccessToken) {
    try {
      await pushLocalCustomerProfileToPm(user, localCustomerFields);
      const pmUserId = String(
        localCustomerFields?.pmUserId ||
          user?.profile?.pmCustomerProfile?.pmUserId ||
          auth?.pmUserId ||
          ''
      ).trim();
      pmUser =
        (pmUserId ? await fetchPmUserById(pmUserId, pmAccessToken) : null) ||
        (pmAccessToken ? await fetchPmCurrentUser(pmAccessToken) : null);
    } catch (pushError) {
      console.warn('[PM sync] push failed:', pushError?.message || pushError);
      if (options.failOnPushError) {
        throw pushError;
      }
    }
  } else if (options.pushPortalFlagAlways && pmAccessToken && resolvePmPortalFlag(user)) {
    try {
      await pushPmPortalFlagToPlatform(user);
      const pmUserId = String(
        user?.profile?.pmCustomerProfile?.pmUserId || auth?.pmUserId || ''
      ).trim();
      pmUser =
        (pmUserId ? await fetchPmUserById(pmUserId, pmAccessToken) : null) ||
        (pmAccessToken ? await fetchPmCurrentUser(pmAccessToken) : null);
    } catch (pushError) {
      console.warn('[PM sync] portal flag push failed:', pushError?.message || pushError);
      if (options.failOnPushError) {
        throw pushError;
      }
    }
  }

  if (!pmUser) {
    pmUser = await resolvePmUserForPhone({
      phoneNumber: phone,
      pmProfile: options.pmProfile || null,
      pmAccessToken
    });
  }

  if (!pmUser) return user;

  return applyPmCustomerProfileToUser(user, pmUser, {
    syncIdentityFromPm: options.syncIdentityFromPm !== false
  });
}

export async function persistPmAuthAndSyncCustomerProfile(
  user,
  { pmProfile = null, pmAccessToken = null, pmRefreshToken = null, phoneNumber } = {}
) {
  if (!user?.id) return user;

  const normalizedPhone = normalizeIndianMobile(phoneNumber || user.phone);
  const resolvedPmUser = await resolvePmUserForPhone({
    phoneNumber: normalizedPhone,
    pmProfile,
    pmAccessToken
  });

  const pmUserId = String(
    pmProfile?.pmUserId || resolvedPmUser?._id || resolvedPmUser?.id || ''
  ).trim();

  let nextUser = user;

  if (pmUserId || pmAccessToken || pmRefreshToken) {
    nextUser = await persistPmAuthCredentials(user, {
      pmUserId,
      accessToken: pmAccessToken,
      refreshToken: pmRefreshToken
    });
  }

  return syncPmCustomerProfileForUser(nextUser, {
    pmProfile,
    pmAccessToken,
    pushIfEstablished: true,
    pushPortalFlagAlways: true,
    syncIdentityFromPm: !isTatvaCustomerProfileEstablished(nextUser)
  });
}

export function resolveServiceProviderDisplayFromPm(user) {
  const pmCustomer = user?.profile?.pmCustomerProfile || null;
  if (!pmCustomer) {
    return {
      contactPerson: user?.name || '',
      email: isPmPlaceholderEmail(user?.email) ? '' : user?.email || '',
      phone: normalizeIndianMobile(user?.phone) || '',
      pmCustomerAccount: null
    };
  }

  return {
    contactPerson: pmCustomer.fullName || user?.name || '',
    email: pmCustomer.email || (isPmPlaceholderEmail(user?.email) ? '' : user?.email || ''),
    phone: pmCustomer.phoneNumber || normalizeIndianMobile(user?.phone) || '',
    pmCustomerAccount: pmCustomer
  };
}
