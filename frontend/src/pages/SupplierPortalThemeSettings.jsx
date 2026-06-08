import React, { useMemo, useRef, useState } from 'react';
import { Crop, ImagePlus, Paintbrush, RotateCcw, Upload } from 'lucide-react';
import {
  SUPPLIER_PORTAL_THEMES,
  getSupplierPortalThemePrefs,
  loadSupplierPortalThemePrefsFromApi,
  saveSupplierPortalThemePrefsToApi,
  resolveSupplierPortalThemeBackground
} from '../utils/supplierPortalTheme';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import './ServiceProviderThemeSettings.css';

const SupplierPortalThemeSettings = () => {
  const [prefs, setPrefs] = useState(() => getSupplierPortalThemePrefs());
  const [uploadError, setUploadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState('');
  const [cropXPercent, setCropXPercent] = useState(50);
  const [cropYPercent, setCropYPercent] = useState(50);
  const [cropZoom, setCropZoom] = useState(1.4);
  const fileRef = useRef(null);

  const previewBackground = useMemo(
    () => resolveSupplierPortalThemeBackground(prefs),
    [prefs]
  );

  React.useEffect(() => {
    let cancelled = false;
    loadSupplierPortalThemePrefsFromApi()
      .then((remotePrefs) => {
        if (!cancelled && remotePrefs) {
          setPrefs(remotePrefs);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const applyTheme = (themeId) => {
    setSaving(true);
    saveSupplierPortalThemePrefsToApi({
      ...prefs,
      themeId
    })
      .then((nextPrefs) => {
        setPrefs(nextPrefs);
        setUploadError('');
      })
      .finally(() => setSaving(false));
  };

  const handleUploadClick = () => {
    setUploadError('');
    fileRef.current?.click();
  };

  const handleImageUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setUploadError('Please upload a valid image file.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setUploadError('Image is too large. Please upload up to 3MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) {
        setUploadError('Could not read uploaded image.');
        return;
      }
      setPendingImageDataUrl(dataUrl);
      setCropXPercent(50);
      setCropYPercent(50);
      setCropZoom(1.4);
      setUploadError('');
    };
    reader.onerror = () => setUploadError('Could not read uploaded image.');
    reader.readAsDataURL(file);
  };

  const resetToDefault = () => {
    setSaving(true);
    saveSupplierPortalThemePrefsToApi({
      themeId: 'default',
      customImageDataUrl: ''
    })
      .then((nextPrefs) => {
        setPrefs(nextPrefs);
        setUploadError('');
      })
      .finally(() => setSaving(false));
  };

  const buildCroppedImageDataUrl = async ({ sourceDataUrl, xPercent, yPercent, zoom }) => {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image for cropping.'));
      img.src = sourceDataUrl;
    });

    const imageWidth = image.width;
    const imageHeight = image.height;
    const aspectRatio = 16 / 9;

    const maxCropWidth = imageWidth / zoom;
    const maxCropHeight = imageHeight / zoom;
    let cropWidth = maxCropWidth;
    let cropHeight = cropWidth / aspectRatio;
    if (cropHeight > maxCropHeight) {
      cropHeight = maxCropHeight;
      cropWidth = cropHeight * aspectRatio;
    }

    const maxX = Math.max(0, imageWidth - cropWidth);
    const maxY = Math.max(0, imageHeight - cropHeight);
    const sx = (Math.max(0, Math.min(100, xPercent)) / 100) * maxX;
    const sy = (Math.max(0, Math.min(100, yPercent)) / 100) * maxY;

    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not initialize canvas for cropping.');
    ctx.drawImage(image, sx, sy, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.92);
  };

  const applyCroppedImage = async () => {
    if (!pendingImageDataUrl) return;
    setSaving(true);
    try {
      const croppedDataUrl = await buildCroppedImageDataUrl({
        sourceDataUrl: pendingImageDataUrl,
        xPercent: cropXPercent,
        yPercent: cropYPercent,
        zoom: cropZoom
      });
      const nextPrefs = await saveSupplierPortalThemePrefsToApi({
        themeId: 'custom',
        customImageDataUrl: croppedDataUrl
      });
      setPrefs(nextPrefs);
      setPendingImageDataUrl('');
      setUploadError('');
    } catch (error) {
      setUploadError(error?.message || 'Could not crop image.');
    } finally {
      setSaving(false);
    }
  };

  const useFullImageWithoutCrop = async () => {
    if (!pendingImageDataUrl) return;
    setSaving(true);
    try {
      const nextPrefs = await saveSupplierPortalThemePrefsToApi({
        themeId: 'custom',
        customImageDataUrl: pendingImageDataUrl
      });
      setPrefs(nextPrefs);
      setPendingImageDataUrl('');
      setUploadError('');
    } catch {
      setUploadError('Could not save uploaded image.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SpPageLayout showStepper={false}>
      <SpPageHeader
        title="Portal Theme"
        description="Choose a sky-blue background variant or upload a custom wallpaper for your supplier portal."
        icon={Paintbrush}
      />
      <div className="sp-theme-settings !max-w-3xl">
        <div className="sp-theme-settings__preview" style={{ backgroundImage: previewBackground }}>
          <div className="sp-theme-settings__preview-overlay">
            <strong>Live preview</strong>
            <span>
              Current theme:{' '}
              {SUPPLIER_PORTAL_THEMES.find((theme) => theme.id === prefs.themeId)?.label || 'Default'}
            </span>
          </div>
        </div>

        <div className="sp-theme-settings__section">
          <h2>Background presets</h2>
          <div className="sp-theme-settings__themes">
            {SUPPLIER_PORTAL_THEMES.filter((theme) => theme.id !== 'custom').map((theme) => (
              <button
                key={theme.id}
                type="button"
                className={`sp-theme-card ${prefs.themeId === theme.id ? 'active' : ''}`}
                style={{ backgroundImage: theme.backgroundImage }}
                onClick={() => applyTheme(theme.id)}
                disabled={saving}
              >
                <span>{theme.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sp-theme-settings__section">
          <h2>Custom wallpaper</h2>
          <div className="sp-theme-settings__actions">
            <button type="button" className="btn-primary" onClick={handleUploadClick} disabled={saving}>
              <Upload size={16} /> Upload image
            </button>
            <button type="button" className="btn-secondary" onClick={resetToDefault} disabled={saving}>
              <RotateCcw size={16} /> Reset to default
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="sp-theme-settings__file-input"
            onChange={handleImageUpload}
          />
          {pendingImageDataUrl ? (
            <div className="sp-theme-settings__cropper">
              <h3>
                <Crop size={16} /> Crop your image
              </h3>
              <p>Select the exact portion you want as wallpaper.</p>
              <div
                className="sp-theme-settings__crop-preview"
                style={{
                  backgroundImage: `url('${pendingImageDataUrl}')`,
                  backgroundSize: `${cropZoom * 100}%`,
                  backgroundPosition: `${cropXPercent}% ${cropYPercent}%`
                }}
              />
              <div className="sp-theme-settings__crop-controls">
                <label>
                  Horizontal
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={cropXPercent}
                    onChange={(event) => setCropXPercent(Number(event.target.value))}
                  />
                </label>
                <label>
                  Vertical
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={cropYPercent}
                    onChange={(event) => setCropYPercent(Number(event.target.value))}
                  />
                </label>
                <label>
                  Zoom
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.05"
                    value={cropZoom}
                    onChange={(event) => setCropZoom(Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="sp-theme-settings__actions">
                <button type="button" className="btn-primary" onClick={applyCroppedImage} disabled={saving}>
                  <Crop size={16} /> Apply cropped image
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={useFullImageWithoutCrop}
                  disabled={saving}
                >
                  Use full image
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setPendingImageDataUrl('')}
                  disabled={saving}
                >
                  Cancel crop
                </button>
              </div>
            </div>
          ) : null}
          {prefs.themeId === 'custom' && prefs.customImageDataUrl ? (
            <p className="sp-theme-settings__hint">
              <ImagePlus size={15} /> Custom wallpaper is active.
            </p>
          ) : null}
          {uploadError ? <p className="sp-theme-settings__error">{uploadError}</p> : null}
          {saving ? <p className="sp-theme-settings__hint">Saving theme...</p> : null}
        </div>
      </div>
    </SpPageLayout>
  );
};

export default SupplierPortalThemeSettings;
