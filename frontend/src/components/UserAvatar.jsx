import React, { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getApiUrl } from '@/config/api';
import { cacheProfilePhotoUrl, getCachedProfilePhotoUrl, getProfileInitials } from '@/utils/profilePhoto';

export default function UserAvatar({ user, className, fallbackClassName }) {
  const userId = String(user?.id || '').trim();
  const [photoUrl, setPhotoUrl] = useState(() => getCachedProfilePhotoUrl(userId));
  const initials = getProfileInitials(user?.name);

  useEffect(() => {
    const refresh = (event) => {
      const eventUserId = String(event?.detail?.userId || '').trim();
      if (eventUserId && userId && eventUserId !== userId) return;
      if (Object.prototype.hasOwnProperty.call(event?.detail || {}, 'url')) {
        setPhotoUrl(String(event.detail.url || '').trim());
        return;
      }
      setPhotoUrl(getCachedProfilePhotoUrl(userId));
    };
    window.addEventListener('profile-photo-updated', refresh);
    return () => window.removeEventListener('profile-photo-updated', refresh);
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setPhotoUrl('');
      return undefined;
    }

    setPhotoUrl(getCachedProfilePhotoUrl(userId));

    const token = localStorage.getItem('token');
    if (!token) {
      setPhotoUrl('');
      return undefined;
    }

    let cancelled = false;
    fetch(getApiUrl('/api/profile'), {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || data?.status !== 'success') return;
        const url = String(data?.profile?.profilePhotoUrl || '').trim();
        cacheProfilePhotoUrl(url, userId);
        setPhotoUrl(url);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <Avatar className={className}>
      {photoUrl ? <AvatarImage src={photoUrl} alt={user?.name || 'Profile'} /> : null}
      <AvatarFallback className={fallbackClassName}>{initials}</AvatarFallback>
    </Avatar>
  );
}
