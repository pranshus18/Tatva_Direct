import React from 'react';
import ProductImageCarousel from './ProductImageCarousel';
import { parseSpecificationsForDisplay, resolveSupplierOfferDisplaySpecifications } from '../utils/specifications';
import { resolveSupplierPortalDisplayDescription } from '../utils/productDisplay';
import { getProductImageList } from '../utils/productImages';

export const collectProductImages = (product) => getProductImageList(product);

const renderSpecEntries = (specEntries, specLayout) => {
  if (specLayout === 'grid') {
    return (
      <dl className="upstream-spec-grid">
        {specEntries.map((entry) => (
          <div key={`${entry.label}-${entry.value}`} className="upstream-spec-grid__item">
            <dt>{entry.label}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
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
  );
};

const UpstreamProductDisplay = ({
  product,
  imageHeight = 88,
  maxSpecs = 10,
  showDescription = true,
  showSpecifications = true,
  showImage = true,
  compact = false,
  specLayout = 'pills',
  collapsibleSpecs = false
}) => {
  if (!product) return null;

  const images = collectProductImages(product);
  const displaySpecs = resolveSupplierOfferDisplaySpecifications(product);
  const specEntries = parseSpecificationsForDisplay(displaySpecs, { maxEntries: maxSpecs });
  const description = resolveSupplierPortalDisplayDescription(product);
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
            collapsibleSpecs ? (
              <details className="upstream-specs-details">
                <summary>
                  {specEntries.length} specification{specEntries.length !== 1 ? 's' : ''}
                </summary>
                {renderSpecEntries(specEntries, specLayout)}
              </details>
            ) : (
              renderSpecEntries(specEntries, specLayout)
            )
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default UpstreamProductDisplay;
