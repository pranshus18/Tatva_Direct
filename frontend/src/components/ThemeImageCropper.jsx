import React, { useState } from 'react';
import Cropper from 'react-easy-crop';
import { Crop } from 'lucide-react';
import { getCroppedImageDataUrl, THEME_WALLPAPER_ASPECT } from '../utils/themeImageCrop';
import 'react-easy-crop/react-easy-crop.css';

const ThemeImageCropper = ({
  imageSrc,
  saving = false,
  onCancel,
  onApplyFull,
  onApplyCrop
}) => {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [applyMode, setApplyMode] = useState(null);
  const [applying, setApplying] = useState(false);

  const isFullImageMode = applyMode === 'full';
  const canApply = applyMode === 'full' || applyMode === 'crop';

  const handleSelectFullImage = () => {
    setApplyMode('full');
  };

  const handleSelectCropImage = () => {
    if (applyMode === 'full') {
      setApplyMode(null);
    }
  };

  const handleCropInteraction = () => {
    if (isFullImageMode) return;
    setApplyMode('crop');
  };

  const handleCropperZoomChange = (value) => {
    setZoom(value);
  };

  const handleZoomSliderChange = (value) => {
    setZoom(value);
    setApplyMode('crop');
  };

  const handleApply = async () => {
    if (!canApply || applying || saving) return;
    setApplying(true);
    try {
      if (applyMode === 'full') {
        await onApplyFull(imageSrc);
        return;
      }
      if (applyMode === 'crop' && croppedAreaPixels) {
        const croppedDataUrl = await getCroppedImageDataUrl(imageSrc, croppedAreaPixels);
        await onApplyCrop(croppedDataUrl);
      }
    } finally {
      setApplying(false);
    }
  };

  const isBusy = saving || applying;

  return (
    <div className="sp-theme-settings__cropper">
      <h3>
        <Crop size={16} /> Crop your image
      </h3>
      <p>
        {isFullImageMode
          ? 'The full uploaded image will be used as your wallpaper.'
          : 'Drag the image to reposition it. Scroll or use the zoom slider to adjust the crop area.'}
      </p>
      {isFullImageMode ? (
        <div className="sp-theme-settings__full-preview">
          <img src={imageSrc} alt="Full wallpaper preview" />
        </div>
      ) : (
        <>
          <div
            className={`sp-theme-settings__crop-area ${
              applyMode === 'crop' ? 'sp-theme-settings__crop-area--active' : ''
            }`}
          >
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={THEME_WALLPAPER_ASPECT}
              onCropChange={setCrop}
              onZoomChange={handleCropperZoomChange}
              onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
              onInteractionStart={handleCropInteraction}
              showGrid
              objectFit="contain"
            />
          </div>
          <label className="sp-theme-settings__zoom-control">
            Zoom
            <input
              type="range"
              min="1"
              max="3"
              step="0.05"
              value={zoom}
              onChange={(event) => handleZoomSliderChange(Number(event.target.value))}
              disabled={isBusy}
            />
          </label>
        </>
      )}
      <div className="sp-theme-settings__actions">
        <button
          type="button"
          className={`btn-secondary sp-theme-settings__mode-btn ${
            isFullImageMode ? 'active' : ''
          }`}
          onClick={handleSelectFullImage}
          disabled={isBusy}
        >
          Full Image
        </button>
        <button
          type="button"
          className={`btn-secondary sp-theme-settings__mode-btn ${
            !isFullImageMode && applyMode === 'crop' ? 'active' : ''
          }`}
          onClick={handleSelectCropImage}
          disabled={isBusy}
        >
          Crop Image
        </button>
      </div>
      <div className="sp-theme-settings__actions">
        <button
          type="button"
          className="btn-primary"
          onClick={handleApply}
          disabled={isBusy || !canApply}
        >
          Apply
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={isBusy}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export default ThemeImageCropper;
