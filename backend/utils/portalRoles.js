export function normalizePortalRole(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

export function getRegisteredRoles(user) {
  const profileRoles = user?.profile?.registeredRoles;
  if (Array.isArray(profileRoles) && profileRoles.length > 0) {
    return [...new Set(profileRoles.map(normalizePortalRole).filter(Boolean))];
  }

  const activeType = normalizePortalRole(user?.user_type);
  if (activeType === 'service_provider' || activeType === 'supplier') {
    return [activeType];
  }

  return [];
}

export function hasRegisteredRole(user, role) {
  return getRegisteredRoles(user).includes(normalizePortalRole(role));
}

export function mergeRegisteredRoles(user, roles = []) {
  const next = new Set(getRegisteredRoles(user));
  roles.forEach((role) => {
    const normalized = normalizePortalRole(role);
    if (normalized) next.add(normalized);
  });
  return [...next];
}

export function isSupplierRegistrationComplete(user) {
  if (!hasRegisteredRole(user, 'supplier')) return false;

  const profile = user?.profile || {};
  if (profile.supplierProfileIncomplete === false) return true;
  if (profile.pmVendorLead) return true;

  return false;
}

export function getEffectiveRegisteredRoles(user) {
  const roles = getRegisteredRoles(user);
  if (hasRegisteredRole(user, 'supplier') && !isSupplierRegistrationComplete(user)) {
    return roles.filter((role) => role !== 'supplier');
  }
  return roles;
}

export function hasEffectiveRegisteredRole(user, role) {
  return getEffectiveRegisteredRoles(user).includes(normalizePortalRole(role));
}
