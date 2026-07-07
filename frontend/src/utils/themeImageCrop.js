export const THEME_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const THEME_IMAGE_MAX_SIZE_LABEL = '10MB';
export const THEME_WALLPAPER_ASPECT = 16 / 9;
export const THEME_WALLPAPER_WIDTH = 1920;
export const THEME_WALLPAPER_HEIGHT = 1080;

export function validateThemeImageFile(file) {
  if (!file?.type?.startsWith('image/')) {
    return 'Please upload a valid image file.';
  }
  if (file.size > THEME_IMAGE_MAX_BYTES) {
    return `Image is too large. Please upload up to ${THEME_IMAGE_MAX_SIZE_LABEL}.`;
  }
  return '';
}

export function readThemeImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) {
        reject(new Error('Could not read uploaded image.'));
        return;
      }
      resolve(dataUrl);
    };
    reader.onerror = () => reject(new Error('Could not read uploaded image.'));
    reader.readAsDataURL(file);
  });
}

function createImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image for cropping.'));
    image.src = url;
  });
}

export async function getCroppedImageDataUrl(imageSrc, pixelCrop) {
  const image = await createImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = THEME_WALLPAPER_WIDTH;
  canvas.height = THEME_WALLPAPER_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not initialize canvas for cropping.');
  }
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    THEME_WALLPAPER_WIDTH,
    THEME_WALLPAPER_HEIGHT
  );
  return canvas.toDataURL('image/jpeg', 0.92);
}
