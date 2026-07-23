import { getApiUrl } from '../config/api';
import { normalizeUser } from '../utils/userType';
import { getVerifiedServiceProviderPhone } from '../utils/pmAuthSession';

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function fetchPortalStatus() {
  const token = localStorage.getItem('token');
  const response = await fetch(getApiUrl('/api/auth/portal-status'), {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  const data = await parseJson(response);
  if (!response.ok || data.status === 'error') {
    throw new Error(data.message || 'Could not load portal status');
  }
  return data;
}

/**
 * Complete supplier registration for an existing Service Provider.
 *
 * PM already owns this phone as the SP/vendor login identity — supplier signup
 * is a Tatva Direct form using that same phone (not a second PM onboarding).
 * Backend handles PM sync and treats "phone already exists" as expected.
 */
export async function registerAsSupplier(formData, options = {}) {
  const storedUser = (() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null');
    } catch {
      return null;
    }
  })();

  const verifiedPhone = getVerifiedServiceProviderPhone(
    options.user || storedUser,
    formData.get('phoneNumber')
  );

  if (!verifiedPhone || verifiedPhone.length !== 10) {
    throw new Error('Sign in with your Service Provider phone number before registering as a supplier.');
  }

  formData.set('phoneNumber', verifiedPhone);

  const token = localStorage.getItem('token');
  const response = await fetch(getApiUrl('/api/auth/register-supplier'), {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: formData
  });
  const data = await parseJson(response);
  if (!response.ok || data.status === 'error') {
    throw new Error(data.message || 'Could not complete supplier registration');
  }
  return data;
}

export async function switchPortal(portal) {
  const token = localStorage.getItem('token');
  const response = await fetch(getApiUrl('/api/auth/switch-portal'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ portal })
  });
  const data = await parseJson(response);
  if (!response.ok || data.status === 'error') {
    throw new Error(data.message || 'Could not switch portal');
  }
  return data;
}

export function persistPortalAuthResult(data) {
  if (data?.token) {
    localStorage.setItem('token', data.token);
  }
  if (data?.user) {
    localStorage.setItem('user', JSON.stringify(normalizeUser(data.user)));
  }
  return normalizeUser(data?.user);
}

export function mergePortalStatus(user, status) {
  if (!status) return normalizeUser(user);
  return normalizeUser({
    ...user,
    registeredRoles: status.registeredRoles,
    supplierRegistered: status.supplierRegistered,
    serviceProviderRegistered: status.serviceProviderRegistered,
    activePortal: status.activePortal
  });
}

export async function syncPortalUser(user) {
  const status = await fetchPortalStatus();
  return mergePortalStatus(user, status);
}
