import { normalizeUserType } from './userType';

export function getPostAuthRedirectPath(userType) {
  const normalized = normalizeUserType(userType);

  if (normalized === 'admin') {
    return '/admin-dashboard';
  }
  if (normalized === 'service_provider') {
    return '/dashboard';
  }
  if (normalized === 'supplier') {
    return '/supplier-dashboard';
  }

  return '/dashboard';
}
