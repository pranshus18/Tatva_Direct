import React, { useMemo, useRef, useState } from 'react';
import { ImagePlus, RotateCcw, Upload } from 'lucide-react';
import {
  SERVICE_PROVIDER_THEMES,
  getServiceProviderThemePrefs,
  loadServiceProviderThemePrefsFromApi,
  saveServiceProviderThemePrefsToApi,
  resolveServiceProviderThemeBackground
} from '../utils/serviceProviderTheme';
import { readThemeImageFile, validateThemeImageFile } from '../utils/themeImageCrop';
import ThemeImageCropper from '../components/ThemeImageCropper';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import { Paintbrush } from 'lucide-react';
import './ServiceProviderThemeSettings.css';

const ServiceProviderThemeSettings = () => {
  const [prefs, setPrefs] = useState(() => getServiceProviderThemePrefs());
  const [uploadError, setUploadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingImageDataUrl, setPendingImageDataUrl] = useState('');
  const fileRef = useRef(null);

  const previewBackground = useMemo(
    () => resolveServiceProviderThemeBackground(prefs),
    [prefs]
  );

  React.useEffect(() => {
    let cancelled = false;
    loadServiceProviderThemePrefsFromApi()
      .then((remotePrefs) => {
        if (!cancelled && remotePrefs) {
          setPrefs(remotePrefs);
        }
      })
      .catch(() => {
        // Ignore and keep local fallback.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyTheme = (themeId) => {
    setSaving(true);
    saveServiceProviderThemePrefsToApi({
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

  const handleImageUpload = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const validationError = validateThemeImageFile(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }

    try {
      const dataUrl = await readThemeImageFile(file);
      setPendingImageDataUrl(dataUrl);
      setUploadError('');
    } catch (error) {
      setUploadError(error?.message || 'Could not read uploaded image.');
    }
  };

  const resetToDefault = () => {
    setSaving(true);
    saveServiceProviderThemePrefsToApi({
      themeId: 'default',
      customImageDataUrl: ''
    })
      .then((nextPrefs) => {
        setPrefs(nextPrefs);
        setUploadError('');
      })
      .finally(() => setSaving(false));
  };

  const saveCustomWallpaper = async (customImageDataUrl) => {
    setSaving(true);
    try {
      const nextPrefs = await saveServiceProviderThemePrefsToApi({
        themeId: 'custom',
        customImageDataUrl
      });
      setPrefs(nextPrefs);
      setPendingImageDataUrl('');
      setUploadError('');
    } catch (error) {
      setUploadError(error?.message || 'Could not save uploaded image.');
      throw error;
    } finally {
      setSaving(false);
    }
  };

  const cancelPendingImage = () => {
    setPendingImageDataUrl('');
  };

  return (
    <SpPageLayout showStepper={false}>
    <SpPageHeader
      title="Portal Theme"
      description="Choose a sky-blue background variant matching the Tatva Direct supplier portal."
      icon={Paintbrush}
    />
    <div className="sp-theme-settings !max-w-3xl">

      <div className="sp-theme-settings__preview" style={{ backgroundImage: previewBackground }}>
        <div className="sp-theme-settings__preview-overlay">
          <strong>Live preview</strong>
          <span>
            Current theme: {
              SERVICE_PROVIDER_THEMES.find((theme) => theme.id === prefs.themeId)?.label || 'Default'
            }
          </span>
        </div>
      </div>

      <div className="sp-theme-settings__section">
        <h2>Background presets</h2>
        <div className="sp-theme-settings__themes">
          {SERVICE_PROVIDER_THEMES.filter((theme) => theme.id !== 'custom').map((theme) => (
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
          <ThemeImageCropper
            key={pendingImageDataUrl}
            imageSrc={pendingImageDataUrl}
            saving={saving}
            onCancel={cancelPendingImage}
            onApplyFull={(fullImageDataUrl) => saveCustomWallpaper(fullImageDataUrl)}
            onApplyCrop={(croppedDataUrl) => saveCustomWallpaper(croppedDataUrl)}
          />
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

export default ServiceProviderThemeSettings;
