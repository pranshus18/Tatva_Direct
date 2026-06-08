import React, { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getApiUrl } from '@/config/api';
import { cacheProfilePhotoUrl, getCachedProfilePhotoUrl, getProfileInitials } from '@/utils/profilePhoto';

export default function UserAvatar({ user, className, fallbackClassName }) {
  const [photoUrl, setPhotoUrl] = useState(() => getCachedProfilePhotoUrl());
  const initials = getProfileInitials(user?.name);

  useEffect(() => {
    const refresh = () => setPhotoUrl(getCachedProfilePhotoUrl());
    refresh();
    window.addEventListener('profile-photo-updated', refresh);
    return () => window.removeEventListener('profile-photo-updated', refresh);
  }, []);

  useEffect(() => {
    if (photoUrl) return undefined;
    const token = localStorage.getItem('token');
    if (!token) return undefined;

    let cancelled = false;
    fetch(getApiUrl('/api/profile'), {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || data?.status !== 'success') return;
        const url = String(data?.profile?.profilePhotoUrl || '').trim();
        if (url) {
          cacheProfilePhotoUrl(url);
          setPhotoUrl(url);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [photoUrl]);

  return (
    <Avatar className={className}>
      {photoUrl ? <AvatarImage src={photoUrl} alt={user?.name || 'Profile'} /> : null}
      <AvatarFallback className={fallbackClassName}>{initials}</AvatarFallback>
    </Avatar>
  );
}
