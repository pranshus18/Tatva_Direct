import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, ImagePlus, Loader2, Trash2, User, X } from 'lucide-react';
import {
  EMPTY_PROFILE_PHOTO_DRAFT,
  getProfileInitials,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_MAX_SIZE_LABEL,
  resolveProfilePhotoDisplayUrl,
  revokeProfilePhotoPreviewUrl
} from '@/utils/profilePhoto';
import ProfileCameraCapture from './ProfileCameraCapture';
import './ProfilePhotoSection.css';

export default function ProfilePhotoSection({
  profile,
  editing = false,
  photoDraft = EMPTY_PROFILE_PHOTO_DRAFT,
  onPhotoDraftChange
}) {
  const galleryInputRef = useRef(null);
  const cameraFallbackInputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const closePreviewRef = useRef(null);

  useEffect(() => {
    if (!editing) {
      setCameraOpen(false);
      setError('');
    }
  }, [editing]);

  const displayName =
    profile?.pmCustomerAccount?.fullName || profile?.contactPerson || profile?.companyName || 'User';
  const initials = getProfileInitials(displayName);
  const resolvedPhoto = resolveProfilePhotoDisplayUrl(profile?.profilePhotoUrl, photoDraft);

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
    if (!resolvedPhoto || busy) return;
    setPreviewOpen(true);
  };

  const updateDraft = (nextDraft) => {
    if (typeof onPhotoDraftChange !== 'function') return;
    onPhotoDraftChange(nextDraft);
  };

  const stageFile = (file) => {
    if (!editing) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPEG, PNG, WebP, or GIF).');
      return;
    }
    if (file.size > PROFILE_PHOTO_MAX_BYTES) {
      setError(`Image must be ${PROFILE_PHOTO_MAX_SIZE_LABEL} or smaller.`);
      return;
    }

    setBusy(true);
    setError('');
    try {
      revokeProfilePhotoPreviewUrl(photoDraft.previewUrl);
      const previewUrl = URL.createObjectURL(file);
      updateDraft({
        previewUrl,
        pendingFile: file,
        remove: false
      });
    } catch (stageError) {
      setError(stageError?.message || 'Could not prepare photo preview.');
    } finally {
      setBusy(false);
    }
  };

  const canEditPhoto = editing && !busy;

  const handlePickGallery = () => {
    if (!editing) return;
    setError('');
    galleryInputRef.current?.click();
  };

  const handleOpenCamera = () => {
    if (!editing) return;
    setError('');
    if (navigator.mediaDevices?.getUserMedia) {
      setCameraOpen(true);
      return;
    }
    cameraFallbackInputRef.current?.click();
  };

  const handleFileChange = (event) => {
    if (!editing) {
      event.target.value = '';
      return;
    }
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    stageFile(file);
  };

  const handleRemove = () => {
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      revokeProfilePhotoPreviewUrl(photoDraft.previewUrl);
      updateDraft({
        previewUrl: null,
        pendingFile: null,
        remove: true
      });
    } catch (removeError) {
      setError(removeError?.message || 'Failed to remove photo preview.');
    } finally {
      setBusy(false);
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
              disabled={busy}
              aria-label={`View profile photo for ${displayName}`}
              title="View full photo"
            >
              <img src={resolvedPhoto} alt="" className="profile-photo-section__img" />
              {busy ? (
                <div className="profile-photo-section__overlay">
                  <Loader2 className="profile-photo-section__spinner" />
                </div>
              ) : null}
            </button>
          ) : (
            <div className="profile-photo-section__avatar" aria-hidden>
              <span className="profile-photo-section__initials">{initials}</span>
              {busy ? (
                <div className="profile-photo-section__overlay">
                  <Loader2 className="profile-photo-section__spinner" />
                </div>
              ) : null}
            </div>
          )}
          {editing ? (
            <button
              type="button"
              className="profile-photo-section__camera-btn"
              onClick={(event) => {
                event.stopPropagation();
                handleOpenCamera();
              }}
              disabled={!canEditPhoto}
              aria-label="Take profile photo with camera"
              title="Take photo with camera"
            >
              <Camera size={16} />
            </button>
          ) : null}
        </div>

        <div className="profile-photo-section__meta">
          <h2 className="profile-photo-section__name">{displayName}</h2>
          {profile?.userType === 'supplier' && profile?.companyName && profile?.contactPerson ? (
            <p className="profile-photo-section__company">{profile.companyName}</p>
          ) : null}
          <p className="profile-photo-section__hint">
            <User size={14} aria-hidden />
            {editing
              ? 'Use the camera icon to take a photo, or choose one from your device. Click Save Changes to keep it.'
              : 'Click Edit Profile to update your photo.'}
          </p>
          {editing ? (
            <div className="profile-photo-section__actions">
              <button type="button" className="btn-primary" onClick={handleOpenCamera} disabled={!canEditPhoto}>
                <Camera size={16} aria-hidden />
                Take photo
              </button>
              <button type="button" className="btn-secondary" onClick={handlePickGallery} disabled={!canEditPhoto}>
                <ImagePlus size={16} aria-hidden />
                {resolvedPhoto ? 'Choose from gallery' : 'Upload from device'}
              </button>
              {resolvedPhoto ? (
                <button type="button" className="btn-secondary" onClick={handleRemove} disabled={!canEditPhoto}>
                  <Trash2 size={16} aria-hidden />
                  Remove
                </button>
              ) : null}
            </div>
          ) : null}
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
        onCapture={stageFile}
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
