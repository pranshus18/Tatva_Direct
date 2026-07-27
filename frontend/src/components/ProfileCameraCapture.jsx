import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Loader2, X } from 'lucide-react';
import './ProfileCameraCapture.css';

async function attachStreamToVideo(video, stream) {
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', 'true');
  video.setAttribute('webkit-playsinline', 'true');
  await video.play();
}

export default function ProfileCameraCapture({ open, onClose, onCapture }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const [starting, setStarting] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
    setVideoReady(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopStream();
      setError('');
      setStarting(false);
      setCapturing(false);
      return undefined;
    }

    let cancelled = false;
    setStarting(true);
    setVideoReady(false);
    setError('');

    const startCamera = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!cancelled) {
          setError('Camera is not supported in this browser. Use “Choose from gallery” instead.');
          setStarting(false);
        }
        return;
      }

      const videoConstraints = [
        { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
        { video: { facingMode: 'user' }, audio: false },
        { video: true, audio: false }
      ];

      let stream = null;
      let lastError = null;

      for (const constraints of videoConstraints) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!stream) {
        if (cancelled) return;
        const err = lastError;
        let message = 'Could not access your camera.';
        if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
          message =
            'Camera permission was denied. Allow camera access in your browser settings and try again.';
        } else if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
          message = 'No camera was found on this device.';
        } else if (err?.name === 'NotReadableError') {
          message = 'Your camera is in use by another app. Close it and try again.';
        }
        setError(message);
        setStarting(false);
        return;
      }

      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        if (!cancelled) {
          setError('Camera preview failed to start. Please close and try again.');
          setStarting(false);
        }
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      try {
        await attachStreamToVideo(video, stream);
        if (cancelled) return;
        setStarting(false);
        setVideoReady(true);
      } catch (playError) {
        if (cancelled) return;
        console.error('Camera preview play failed:', playError);
        setError('Could not start the camera preview. Try “Choose from gallery” instead.');
        setStarting(false);
        stopStream();
      }
    };

    const frame = requestAnimationFrame(() => {
      startCamera();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stopStream();
    };
  }, [open, stopStream]);

  useEffect(() => {
    if (!open) return undefined;

    const scrollY = window.scrollY;
    const { style } = document.body;
    const previousOverflow = style.overflow;
    const previousPosition = style.position;
    const previousTop = style.top;
    const previousWidth = style.width;

    style.overflow = 'hidden';
    style.position = 'fixed';
    style.top = `-${scrollY}px`;
    style.width = '100%';

    const preventBackgroundTouch = (event) => {
      if (!event.target.closest('.profile-camera-dialog')) {
        event.preventDefault();
      }
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onCloseRef.current();
    };

    document.addEventListener('touchmove', preventBackgroundTouch, { passive: false });
    window.addEventListener('keydown', onKeyDown);

    return () => {
      style.overflow = previousOverflow;
      style.position = previousPosition;
      style.top = previousTop;
      style.width = previousWidth;
      window.scrollTo(0, scrollY);
      document.removeEventListener('touchmove', preventBackgroundTouch);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const handleCapture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError('Camera is not ready yet. Wait a moment and try again.');
      return;
    }

    setCapturing(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error('Capture failed'))),
          'image/jpeg',
          0.92
        );
      });

      const file = new File([blob], `profile-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      stopStream();
      onCapture(file);
      onClose();
    } catch {
      setError('Could not capture photo. Please try again.');
    } finally {
      setCapturing(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="profile-camera-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Take profile photo"
    >
      <div className="profile-camera-dialog" onClick={(event) => event.stopPropagation()}>
        <div className="profile-camera-dialog__header">
          <h3>Take a photo</h3>
          <button type="button" className="profile-camera-dialog__close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="profile-camera-dialog__preview">
          <video
            ref={videoRef}
            className={`profile-camera-dialog__video${videoReady ? ' profile-camera-dialog__video--ready' : ''}`}
            playsInline
            muted
            autoPlay
            onLoadedData={() => setVideoReady(true)}
          />
          {starting ? (
            <div className="profile-camera-dialog__status profile-camera-dialog__status--overlay">
              <Loader2 className="profile-camera-dialog__spinner" />
              <span>Starting camera…</span>
            </div>
          ) : null}
          {error ? (
            <div className="profile-camera-dialog__status profile-camera-dialog__status--overlay profile-camera-dialog__status--error">
              <p>{error}</p>
            </div>
          ) : null}
        </div>

        <div className="profile-camera-dialog__actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleCapture}
            disabled={starting || Boolean(error) || capturing || !videoReady}
          >
            <Camera size={18} aria-hidden />
            {capturing ? 'Saving…' : 'Capture photo'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
