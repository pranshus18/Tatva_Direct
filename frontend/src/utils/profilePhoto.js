import { getApiUrl } from '@/config/api';

export const PROFILE_PHOTO_CACHE_KEY = 'profilePhotoUrl';
export const PROFILE_PHOTO_USER_KEY = 'profilePhotoUserId';
export const PROFILE_PHOTO_MAX_BYTES = 20 * 1024 * 1024;
export const PROFILE_PHOTO_MAX_SIZE_LABEL = '20MB';

export const EMPTY_PROFILE_PHOTO_DRAFT = {
  previewUrl: null,
  pendingFile: null,
  remove: false
};

export function getProfileInitials(name) {
  return String(name || 'U')
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function getCachedProfilePhotoUrl(userId) {
  try {
    const cachedUserId = String(localStorage.getItem(PROFILE_PHOTO_USER_KEY) || '').trim();
    const requestedUserId = String(userId || '').trim();
    if (requestedUserId && cachedUserId && cachedUserId !== requestedUserId) {
      return '';
    }
    return String(localStorage.getItem(PROFILE_PHOTO_CACHE_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function cacheProfilePhotoUrl(url, userId) {
  const next = String(url || '').trim();
  const nextUserId = String(userId || '').trim();
  try {
    if (next) {
      localStorage.setItem(PROFILE_PHOTO_CACHE_KEY, next);
    } else {
      localStorage.removeItem(PROFILE_PHOTO_CACHE_KEY);
    }
    if (nextUserId) {
      localStorage.setItem(PROFILE_PHOTO_USER_KEY, nextUserId);
    } else if (!next) {
      localStorage.removeItem(PROFILE_PHOTO_USER_KEY);
    }
  } catch {
    // ignore quota errors
  }
  window.dispatchEvent(
    new CustomEvent('profile-photo-updated', { detail: { url: next, userId: nextUserId } })
  );
}

export function clearCachedProfilePhotoUrl() {
  try {
    localStorage.removeItem(PROFILE_PHOTO_CACHE_KEY);
    localStorage.removeItem(PROFILE_PHOTO_USER_KEY);
  } catch {
    // ignore storage errors
  }
  window.dispatchEvent(new CustomEvent('profile-photo-updated', { detail: { url: '', userId: '' } }));
}

export function resolveProfilePhotoDisplayUrl(profilePhotoUrl, photoDraft = EMPTY_PROFILE_PHOTO_DRAFT) {
  if (photoDraft?.remove) return '';
  const draftPreview = String(photoDraft?.previewUrl || '').trim();
  if (draftPreview) return draftPreview;
  return String(profilePhotoUrl || '').trim();
}

export function hasPendingProfilePhotoChanges(photoDraft = EMPTY_PROFILE_PHOTO_DRAFT) {
  return Boolean(photoDraft?.remove || photoDraft?.pendingFile);
}

export function revokeProfilePhotoPreviewUrl(url) {
  const value = String(url || '').trim();
  if (value.startsWith('blob:')) {
    URL.revokeObjectURL(value);
  }
}

export async function commitProfilePhotoDraft(photoDraft = EMPTY_PROFILE_PHOTO_DRAFT) {
  if (!hasPendingProfilePhotoChanges(photoDraft)) {
    return { changed: false, profilePhotoUrl: null };
  }

  const token = localStorage.getItem('token');
  if (!token) {
    throw new Error('You are not signed in. Please log in and try again.');
  }

  if (photoDraft.remove) {
    const response = await fetch(getApiUrl('/api/profile/photo'), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status !== 'success') {
      throw new Error(data.message || 'Failed to remove profile photo');
    }
    return { changed: true, profilePhotoUrl: '' };
  }

  if (photoDraft.pendingFile) {
    const formData = new FormData();
    formData.append('file', photoDraft.pendingFile);
    const response = await fetch(getApiUrl('/api/profile/photo'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.status !== 'success') {
      throw new Error(data.message || 'Failed to upload profile photo');
    }
    return { changed: true, profilePhotoUrl: String(data.profilePhotoUrl || '').trim() };
  }

  return { changed: false, profilePhotoUrl: null };
}
