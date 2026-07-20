export function normalizePortalRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function getRegisteredRoles(user) {
  if (Array.isArray(user?.registeredRoles) && user.registeredRoles.length > 0) {
    return [...new Set(user.registeredRoles.map(normalizePortalRole).filter(Boolean))];
  }

  const profileRoles = user?.profile?.registeredRoles;
  if (Array.isArray(profileRoles) && profileRoles.length > 0) {
    return [...new Set(profileRoles.map(normalizePortalRole).filter(Boolean))];
  }

  const activeType = normalizePortalRole(user?.userType);
  if (activeType === 'service_provider' || activeType === 'supplier') {
    return [activeType];
  }

  return [];
}

export function hasRegisteredRole(user, role) {
  return getRegisteredRoles(user).includes(normalizePortalRole(role));
}

export function isSupplierRegistered(user) {
  if (user?.supplierRegistered === false) return false;
  if (user?.supplierRegistered === true) return true;
  if (!hasRegisteredRole(user, 'supplier')) return false;

  const profile = user?.profile || {};
  if (profile.supplierProfileIncomplete === false) return true;
  if (profile.pmVendorLead) return true;

  return false;
}

export function isServiceProviderRegistered(user) {
  return user?.serviceProviderRegistered === true || hasRegisteredRole(user, 'service_provider');
}

export function isPmPlaceholderEmail(email) {
  return /@phone\.tatvadirect\.local$/i.test(String(email || '').trim());
}
