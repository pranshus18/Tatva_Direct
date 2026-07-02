import React, { useMemo, useState } from 'react';

const ProductImageCarousel = ({
  images = [],
  alt = 'Product',
  height = 120,
  rounded = 8,
  stopPropagation = false,
  objectFit = 'contain'
}) => {
  const imageList = useMemo(
    () => [...new Set((Array.isArray(images) ? images : []).filter(Boolean))],
    [images]
  );
  const [index, setIndex] = useState(0);
  const [brokenUrls, setBrokenUrls] = useState(() => new Set());

  const visibleImages = imageList.filter((url) => !brokenUrls.has(url));
  if (visibleImages.length === 0) return null;
  const safeIndex = Math.max(0, Math.min(index, visibleImages.length - 1));

  const eatEvent = (e) => {
    if (!stopPropagation) return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div style={{ position: 'relative' }}>
      <img
        src={visibleImages[safeIndex]}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={() => {
          const failed = visibleImages[safeIndex];
          if (!failed) return;
          setBrokenUrls((prev) => {
            const next = new Set(prev);
            next.add(failed);
            return next;
          });
          setIndex(0);
        }}
        style={{
          width: '100%',
          height: `${height}px`,
          objectFit,
          borderRadius: `${rounded}px`,
          border: '1px solid #e5e7eb',
          background: '#f8fafc'
        }}
      />
      {visibleImages.length > 1 && (
        <>
          <button
            type="button"
            onMouseDown={eatEvent}
            onClick={(e) => {
              eatEvent(e);
              setIndex((prev) => (prev - 1 + visibleImages.length) % visibleImages.length);
            }}
            style={{
              position: 'absolute',
              left: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '28px',
              height: '28px',
              borderRadius: '999px',
              border: '1px solid #cbd5e1',
              background: 'rgba(255,255,255,0.95)',
              cursor: 'pointer',
              fontWeight: 700
            }}
            aria-label="Previous image"
          >
            ‹
          </button>
          <button
            type="button"
            onMouseDown={eatEvent}
            onClick={(e) => {
              eatEvent(e);
              setIndex((prev) => (prev + 1) % visibleImages.length);
            }}
            style={{
              position: 'absolute',
              right: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '28px',
              height: '28px',
              borderRadius: '999px',
              border: '1px solid #cbd5e1',
              background: 'rgba(255,255,255,0.95)',
              cursor: 'pointer',
              fontWeight: 700
            }}
            aria-label="Next image"
          >
            ›
          </button>
          <div
            style={{
              position: 'absolute',
              bottom: '8px',
              left: '50%',
              transform: 'translateX(-50%)',
              fontSize: '0.72rem',
              padding: '0.2rem 0.45rem',
              borderRadius: '999px',
              background: 'rgba(15,23,42,0.65)',
              color: '#fff'
            }}
          >
            {safeIndex + 1}/{visibleImages.length}
          </div>
        </>
      )}
    </div>
  );
};

export default ProductImageCarousel;
