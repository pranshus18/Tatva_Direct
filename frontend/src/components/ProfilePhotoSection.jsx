import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ImagePlus, Loader2, Trash2, User, X } from 'lucide-react';
import { getApiUrl } from '@/config/api';
import {
  cacheProfilePhotoUrl,
  getProfileInitials,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_MAX_SIZE_LABEL
} from '@/utils/profilePhoto';
import ProfileCameraCapture from './ProfileCameraCapture';
import './ProfilePhotoSection.css';

export default function ProfilePhotoSection({ profile }) {
  const galleryInputRef = useRef(null);
  const cameraFallbackInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(() => String(profile?.profilePhotoUrl || '').trim());
  const closePreviewRef = useRef(null);

  useEffect(() => {
    setPhotoUrl(String(profile?.profilePhotoUrl || '').trim());
  }, [profile?.profilePhotoUrl]);

  const displayName = profile?.contactPerson || profile?.companyName || 'User';
  const initials = getProfileInitials(displayName);
  const resolvedPhoto = photoUrl || String(profile?.profilePhotoUrl || '').trim();

  const closePreview = useCallback(() => setPreviewOpen(false), []);

  useEffect(() => {
    if (!resolvedPhoto) setPreviewOpen(false);
  }, [resolvedPhoto]);

  useEffect(() => {
    if (!previewOpen) return undefined;
    closePreviewRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closePreview();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [previewOpen, closePreview]);

  const handleOpenPreview = () => {
    if (!resolvedPhoto || uploading) return;
    setPreviewOpen(true);
  };

  const uploadFile = async (file) => {
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      setError(`Image must be ${PROFILE_PHOTO_MAX_SIZE_LABEL} or smaller.`);
      return;
    }

    setUploading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(getApiUrl('/api/profile/photo'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to upload photo');
      }

      const nextUrl = String(data.profilePhotoUrl || '').trim();
      setPhotoUrl(nextUrl);
      cacheProfilePhotoUrl(nextUrl);
    } catch (uploadError) {
      setError(uploadError?.message || 'Failed to upload photo. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const handlePickGallery = () => {
    setError('');
    galleryInputRef.current?.click();
  };

  const handleOpenCamera = () => {
    setError('');
    if (navigator.mediaDevices?.getUserMedia) {
      setCameraOpen(true);
      return;
    }
    cameraFallbackInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await uploadFile(file);
  };

  const handleRemove = async () => {
    setUploading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/profile/photo'), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to remove photo');
      }
      setPhotoUrl('');
      cacheProfilePhotoUrl('');
    } catch (removeError) {
      setError(removeError?.message || 'Failed to remove photo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <section className="profile-photo-section">
        <div className="profile-photo-section__avatar-wrap">
          {resolvedPhoto ? (
            <button
              type="button"
              className="profile-photo-section__avatar profile-photo-section__avatar--clickable"
              onClick={handleOpenPreview}
              disabled={uploading}
              aria-label={`View profile photo for ${displayName}`}
              title="View full photo"
            >
              <img src={resolvedPhoto} alt="" className="profile-photo-section__img" />
              {uploading ? (
                <div className="profile-photo-section__overlay">
                  <Loader2 className="profile-photo-section__spinner" />
                </div>
              ) : null}
            </button>
          ) : (
            <div className="profile-photo-section__avatar" aria-hidden>
              <span className="profile-photo-section__initials">{initials}</span>
              {uploading ? (
                <div className="profile-photo-section__overlay">
                  <Loader2 className="profile-photo-section__spinner" />
                </div>
              ) : null}
            </div>
          )}
          <button
            type="button"
            className="profile-photo-section__camera-btn"
            onClick={(event) => {
              event.stopPropagation();
              handleOpenCamera();
            }}
            disabled={uploading}
            aria-label="Take profile photo with camera"
            title="Take photo with camera"
          >
            <Camera size={16} />
          </button>
        </div>

        <div className="profile-photo-section__meta">
          <h2 className="profile-photo-section__name">{displayName}</h2>
          {profile?.companyName && profile?.contactPerson ? (
            <p className="profile-photo-section__company">{profile.companyName}</p>
          ) : null}
          <p className="profile-photo-section__hint">
            <User size={14} aria-hidden />
            Use the camera icon to take a photo, or choose one from your device.
          </p>
          <div className="profile-photo-section__actions">
            <button type="button" className="btn-primary" onClick={handleOpenCamera} disabled={uploading}>
              <Camera size={16} aria-hidden />
              Take photo
            </button>
            <button type="button" className="btn-secondary" onClick={handlePickGallery} disabled={uploading}>
              <ImagePlus size={16} aria-hidden />
              {resolvedPhoto ? 'Choose from gallery' : 'Upload from device'}
            </button>
            {resolvedPhoto ? (
              <button type="button" className="btn-secondary" onClick={handleRemove} disabled={uploading}>
                <Trash2 size={16} aria-hidden />
                Remove
              </button>
            ) : null}
          </div>
          {error ? <p className="profile-photo-section__error">{error}</p> : null}
        </div>

        <input
          ref={galleryInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="profile-photo-section__file-input"
          onChange={handleFileChange}
        />
        <input
          ref={cameraFallbackInputRef}
          type="file"
          accept="image/*"
          capture="user"
          className="profile-photo-section__file-input"
          onChange={handleFileChange}
        />
      </section>

      <ProfileCameraCapture
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={uploadFile}
      />

      {previewOpen && resolvedPhoto
        ? createPortal(
            <div
              className="profile-photo-preview"
              role="dialog"
              aria-modal="true"
              aria-label={`Profile photo for ${displayName}`}
              onClick={closePreview}
            >
              <div
                className="profile-photo-preview__dialog"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="profile-photo-preview__header">
                  <h3 className="profile-photo-preview__title">{displayName}</h3>
                  <button
                    ref={closePreviewRef}
                    type="button"
                    className="profile-photo-preview__close"
                    onClick={closePreview}
                    aria-label="Close photo preview"
                  >
                    <X size={20} aria-hidden />
                  </button>
                </div>
                <div className="profile-photo-preview__body">
                  <img
                    src={resolvedPhoto}
                    alt={`Profile photo of ${displayName}`}
                    className="profile-photo-preview__img"
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
