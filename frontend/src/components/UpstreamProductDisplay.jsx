import React from 'react';
import ProductImageCarousel from './ProductImageCarousel';
import { parseSpecificationsForDisplay } from '../utils/specifications';

export const collectProductImages = (product) => {
  if (!product) return [];
  const fromArray = Array.isArray(product.images) ? product.images : [];
  const single = product.image ? [product.image] : [];
  return [...new Set([...fromArray, ...single].filter(Boolean))];
};

const UpstreamProductDisplay = ({
  product,
  imageHeight = 88,
  maxSpecs = 10,
  showDescription = true,
  showSpecifications = true,
  showImage = true,
  compact = false
}) => {
  if (!product) return null;

  const images = collectProductImages(product);
  const specEntries = parseSpecificationsForDisplay(product.specifications, { maxEntries: maxSpecs });
  const description = String(product.description || '').trim();
  const hasBody = (showDescription && description) || (showSpecifications && specEntries.length > 0);
  const hasMedia = showImage && images.length > 0;

  if (!hasMedia && !hasBody) return null;

  return (
    <div className={`upstream-product-display ${compact ? 'upstream-product-display-compact' : ''}`}>
      {hasMedia ? (
        <div className="upstream-product-display-media">
          <ProductImageCarousel
            images={images}
            alt={product.name || 'Product'}
            height={compact ? 72 : imageHeight}
            rounded={8}
          />
        </div>
      ) : null}
      {hasBody ? (
        <div className="upstream-product-display-body">
          {showDescription && description ? (
            <p className="upstream-product-display-description">{description}</p>
          ) : null}
          {showSpecifications && specEntries.length > 0 ? (
            <div className="upstream-product-display-specs">
              {specEntries.map((entry) => (
                <span
                  key={`${entry.label}-${entry.value}`}
                  className="upstream-product-display-spec-pill"
                  title={`${entry.label}: ${entry.value}`}
                >
                  <strong>{entry.label}:</strong> {entry.value}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default UpstreamProductDisplay;
