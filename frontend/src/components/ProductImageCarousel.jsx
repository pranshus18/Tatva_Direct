import React, { useMemo, useState } from 'react';

const ProductImageCarousel = ({
  images = [],
  alt = 'Product',
  height = 120,
  rounded = 8,
  stopPropagation = false
}) => {
  const imageList = useMemo(
    () => [...new Set((Array.isArray(images) ? images : []).filter(Boolean))],
    [images]
  );
  const [index, setIndex] = useState(0);

  if (imageList.length === 0) return null;
  const safeIndex = Math.max(0, Math.min(index, imageList.length - 1));

  const eatEvent = (e) => {
    if (!stopPropagation) return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div style={{ position: 'relative' }}>
      <img
        src={imageList[safeIndex]}
        alt={alt}
        style={{
          width: '100%',
          height: `${height}px`,
          objectFit: 'contain',
          borderRadius: `${rounded}px`,
          border: '1px solid #e5e7eb',
          background: '#f8fafc'
        }}
      />
      {imageList.length > 1 && (
        <>
          <button
            type="button"
            onMouseDown={eatEvent}
            onClick={(e) => {
              eatEvent(e);
              setIndex((prev) => (prev - 1 + imageList.length) % imageList.length);
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
              setIndex((prev) => (prev + 1) % imageList.length);
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
            {safeIndex + 1}/{imageList.length}
          </div>
        </>
      )}
    </div>
  );
};

export default ProductImageCarousel;
