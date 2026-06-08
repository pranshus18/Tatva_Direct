export const PROFILE_PHOTO_CACHE_KEY = 'profilePhotoUrl';
export const PROFILE_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const PROFILE_PHOTO_MAX_SIZE_LABEL = '20MB';

export function getProfileInitials(name) {
  return String(name || 'U')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function getCachedProfilePhotoUrl() {
  try {
    return String(localStorage.getItem(PROFILE_PHOTO_CACHE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function cacheProfilePhotoUrl(url) {
  const next = String(url || '').trim();
  try {
    if (next) {
      localStorage.setItem(PROFILE_PHOTO_CACHE_KEY, next);
    } else {
      localStorage.removeItem(PROFILE_PHOTO_CACHE_KEY);
    }
  } catch {
    // ignore quota errors
  }
  window.dispatchEvent(new CustomEvent('profile-photo-updated', { detail: { url: next } }));
}
