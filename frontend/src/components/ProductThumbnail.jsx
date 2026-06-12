import React, { useState } from 'react';
import { ImageOff } from 'lucide-react';
import { getProductThumbnailUrl } from '../utils/productImages';

const ProductThumbnail = ({
  product,
  alt = 'Product',
  size = 52,
  className = '',
  rounded = 6,
  fit = 'cover'
}) => {
  const [broken, setBroken] = useState(false);
  const src = getProductThumbnailUrl(product);

  if (!src || broken) {
    return (
      <div
        className={`product-thumbnail product-thumbnail--empty ${className}`.trim()}
        style={{ width: size, height: size, borderRadius: rounded }}
        aria-hidden={!src}
      >
        <ImageOff size={Math.max(14, Math.round(size * 0.35))} />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`product-thumbnail ${className}`.trim()}
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        objectFit: fit
      }}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
};

export default ProductThumbnail;
