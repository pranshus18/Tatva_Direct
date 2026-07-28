import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Package,
  ShoppingCart,
  Star,
  Tag
} from 'lucide-react';
import { getApiUrl } from '../config/api';
import { getProductImageList } from '../utils/productImages';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpEmptyState from '../components/sp/SpEmptyState';
import DiscoveryAddToCartDialog from '../components/sp/DiscoveryAddToCartDialog';
import SupplierTsinLine from '../components/SupplierTsinLine';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRupeePerUnit } from '../utils/formatRupee';
import {
  specificationEntriesForCustomerDisplay
} from '../utils/specifications';
import { resolveDiscoveryProductDescription } from '../utils/productDisplay';
import { returnToDiscovery } from '../utils/discoveryNavigation';
import './ProductDiscoveryDetail.css';
import './ProductDiscovery.css';

function formatPrice(price, unit) {
  const num = Number(price);
  if (!Number.isFinite(num) || num <= 0) return null;
  return formatRupeePerUnit(num, unit, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatPriceRange(range, unit) {
  if (!range) return null;
  const min = Number(range.min);
  const max = Number(range.max);
  if (!Number.isFinite(min) || min <= 0) return null;
  if (!Number.isFinite(max) || max <= 0 || min === max) {
    return formatPrice(min, unit);
  }
  const minLabel = formatPrice(min, unit);
  const maxLabel = formatPrice(max, unit);
  if (!minLabel || !maxLabel) return minLabel || maxLabel;
  return `${minLabel} – ${maxLabel}`;
}

function RatingStars({ rating, reviews, size = 16 }) {
  const num = Number(rating);
  if (!Number.isFinite(num) || num <= 0) return null;
  const full = Math.floor(num);
  const hasHalf = num - full >= 0.25;
  return (
    <div className="pdd-rating">
      <div className="pdd-rating__stars">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            size={size}
            className={i < full ? 'pdd-star--filled' : (i === full && hasHalf) ? 'pdd-star--half' : 'pdd-star--empty'}
          />
        ))}
      </div>
      <span className="pdd-rating__value">{num.toFixed(1)} out of 5</span>
      {Number(reviews) > 0 ? (
        <span className="pdd-rating__count">{reviews} rating{Number(reviews) === 1 ? '' : 's'}</span>
      ) : null}
    </div>
  );
}

function variantSelectionKey(variant) {
  return `${variant?.productId || ''}::${variant?.variantKey || ''}`;
}

function variantMatchesSelections(variant, selections) {
  const attrs = {
    ...(variant?.specifications || {}),
    ...(variant?.canonicalAttributes || {})
  };
  return Object.entries(selections).every(([key, value]) => {
    const normalizedKey = String(key || '').trim().toLowerCase();
    const matchEntry = Object.entries(attrs).find(
      ([attrKey]) => String(attrKey || '').trim().toLowerCase().replace(/\s+/g, '_') === normalizedKey
    );
    if (!matchEntry) return false;
    const [, rawValue] = matchEntry;
    if (Array.isArray(rawValue)) return rawValue.map(String).join(', ') === value;
    return String(rawValue).trim() === value;
  });
}

function variantLabel(variant) {
  const specs = variant?.specifications || {};
  const attrs = variant?.canonicalAttributes || {};
  const color = specs.color || specs.Color || attrs.color;
  const size = specs.size || specs.Size || attrs.size;
  const parts = [color, size].filter(Boolean).map(String);
  if (parts.length) return parts.join(' · ');
  return variant?.variantName || variant?.name || 'Variant';
}

function buildIdentificationRows(variant, product) {
  const rows = [
    { label: 'GTIN / UPC / EAN', value: variant?.gtin || product?.gtin },
    { label: 'Barcode', value: variant?.barcode || product?.barcode },
    { label: 'MPN', value: variant?.mpn || product?.mpn },
    { label: 'HSN code', value: variant?.hsnCode || product?.hsnCode },
    { label: 'LSA', value: variant?.lsa || product?.lsa }
  ];
  return rows.filter((row) => row.value !== null && row.value !== undefined && String(row.value).trim());
}

function buildProductInfoRows(variant, product) {
  const brand = String(product?.brand || variant?.brandModel || '').trim();
  const model = String(variant?.brandModel || '').trim();
  const rows = [
    {
      label: 'Model',
      value: model && model.toLowerCase() !== brand.toLowerCase() ? model : null
    }
  ];
  return rows.filter((row) => row.value !== null && row.value !== undefined && String(row.value).trim());
}

function buildDetailSections({
  description,
  specEntries,
  variant,
  product,
  hasVariants,
  variants
}) {
  const sections = [];

  if (description) {
    sections.push({
      id: 'description',
      title: 'Product description',
      type: 'text',
      content: description
    });
  }

  if (specEntries.length > 0) {
    sections.push({
      id: 'specifications',
      title: 'Specifications',
      type: 'spec-table',
      entries: specEntries
    });
  }

  const productInfoRows = buildProductInfoRows(variant, product);
  if (productInfoRows.length > 0) {
    sections.push({
      id: 'product-info',
      title: 'Product information',
      type: 'info-table',
      rows: productInfoRows
    });
  }

  const identificationRows = buildIdentificationRows(variant, product);
  if (identificationRows.length > 0) {
    sections.push({
      id: 'identification',
      title: 'Identification & codes',
      type: 'info-table',
      rows: identificationRows
    });
  }

  if (hasVariants && variants.length > 1) {
    sections.push({
      id: 'compare-variants',
      title: 'Compare variants',
      type: 'variants-table',
      variants
    });
  }

  return sections;
}

function CollapsibleSection({ id, title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const sectionId = `pdd-section-${id}`;

  return (
    <section className={`pdd-panel ${open ? 'pdd-panel--open' : 'pdd-panel--closed'}`}>
      <button
        type="button"
        className="pdd-panel__toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls={sectionId}
      >
        <span className="pdd-panel__title">{title}</span>
        <span className="pdd-panel__arrow-wrap" aria-hidden>
          <ChevronDown size={20} className={`pdd-panel__arrow ${open ? 'pdd-panel__arrow--open' : ''}`} />
        </span>
      </button>
      {open ? (
        <div id={sectionId} className="pdd-panel__body">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function InfoTable({ title, rows, sectionId = 'product-details' }) {
  if (!rows?.length) return null;
  return (
    <CollapsibleSection id={sectionId} title={title}>
      <table className="pdd-info-table">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CollapsibleSection>
  );
}

function SpecTable({ title, entries, sectionId = 'specifications' }) {
  if (!entries?.length) return null;
  return (
    <CollapsibleSection id={sectionId} title={title}>
      <table className="pdd-info-table pdd-info-table--specs">
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.key}>
              <th scope="row">{entry.label}</th>
              <td className={entry.hasValue ? '' : 'pdd-info-table__empty'}>{entry.displayValue}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </CollapsibleSection>
  );
}

export default function ProductDiscoveryDetail() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [selectedVariantKey, setSelectedVariantKey] = useState('');
  const [optionSelections, setOptionSelections] = useState({});
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [cartAdded, setCartAdded] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [displaySpecifications, setDisplaySpecifications] = useState({});

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in again to view product details.');
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(getApiUrl(`/api/supplier/products/${productId}/detail`), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok || data.status !== 'success') {
          throw new Error(data.message || 'Failed to load product details');
        }
        if (cancelled) return;
        setDetail(data);
      } catch (fetchError) {
        if (!cancelled) {
          setDetail(null);
          setError(fetchError.message || 'Failed to load product details');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const variants = useMemo(
    () => (Array.isArray(detail?.variants) ? detail.variants : []),
    [detail?.variants]
  );

  const selectedVariant = useMemo(() => {
    if (!variants.length) return null;
    const urlVariant = String(searchParams.get('variant') || '').trim();
    if (urlVariant) {
      const byKey = variants.find((v) => String(v.variantKey || '') === urlVariant);
      if (byKey) return byKey;
      const byProduct = variants.find((v) => String(v.productId || '') === urlVariant);
      if (byProduct) return byProduct;
    }
    if (selectedVariantKey) {
      const explicit = variants.find((v) => variantSelectionKey(v) === selectedVariantKey);
      if (explicit) return explicit;
    }
    if (Object.keys(optionSelections).length) {
      const matched = variants.find((v) => variantMatchesSelections(v, optionSelections));
      if (matched) return matched;
    }
    return variants[0];
  }, [variants, searchParams, selectedVariantKey, optionSelections]);

  useEffect(() => {
    setActiveImageIndex(0);
    setDisplaySpecifications(selectedVariant?.specifications || {});
  }, [
    selectedVariant?.productId,
    selectedVariant?.variantKey,
    selectedVariant?.specifications
  ]);

  const syncVariantToUrl = (variant) => {
    if (!variant) return;
    const token = variant.variantKey || variant.productId;
    if (!token) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (next.get('variant') === token) return prev;
        next.set('variant', token);
        return next;
      },
      { replace: true }
    );
  };

  const productSummary = detail?.product || {};
  const variantOptions = Array.isArray(detail?.variantOptions) ? detail.variantOptions : [];
  const activeListing = selectedVariant || (variants[0] ?? null);
  const images = getProductImageList(activeListing || productSummary);
  const safeImageIndex = images.length ? Math.min(activeImageIndex, images.length - 1) : 0;
  const productDescription = resolveDiscoveryProductDescription(productSummary, activeListing);
  const detailSections = useMemo(
    () =>
      buildDetailSections({
        description: productDescription,
        specEntries: specificationEntriesForCustomerDisplay(displaySpecifications),
        variant: activeListing || {},
        product: productSummary,
        hasVariants: Boolean(detail?.hasVariants),
        variants
      }),
    [
      activeListing,
      productSummary,
      displaySpecifications,
      detail?.hasVariants,
      variants,
      productDescription
    ]
  );
  const priceLabel = formatPrice(activeListing?.price, activeListing?.unit || productSummary.unit);
  const rangeLabel = formatPriceRange(productSummary.priceRange, productSummary.unit);
  const inStock = Number(activeListing?.stock) > 0;

  const handleBackToDiscovery = () => {
    returnToDiscovery({ navigate, searchParams });
  };

  const openAddToCart = () => {
    if (!inStock) {
      setError('Product is out of stock');
      return;
    }
    if (!activeListing?.canAddToCart && !productSummary.canAddToCart) {
      setError('This variant is not currently available from eligible suppliers.');
      return;
    }
    setProjectPickerOpen(true);
  };

  const handleOptionSelect = (optionKey, value) => {
    setOptionSelections((prev) => ({ ...prev, [optionKey]: value }));
    const matched = variants.find((variant) =>
      variantMatchesSelections(variant, { ...optionSelections, [optionKey]: value })
    );
    if (matched) {
      setSelectedVariantKey(variantSelectionKey(matched));
      syncVariantToUrl(matched);
    }
  };

  const handleVariantChipSelect = (variant) => {
    setSelectedVariantKey(variantSelectionKey(variant));
    setOptionSelections({});
    syncVariantToUrl(variant);
  };

  const buyBox = activeListing ? (
    <aside className="pdd-buybox">
      <div className="pdd-buybox__price-block">
        {priceLabel ? <div className="pdd-buybox__price">{priceLabel}</div> : null}
        {!priceLabel && rangeLabel ? <div className="pdd-buybox__price">{rangeLabel}</div> : null}
        {!priceLabel && !rangeLabel ? (
          <div className="pdd-buybox__price pdd-buybox__price--na">Price on request</div>
        ) : null}
        {priceLabel && rangeLabel && rangeLabel !== priceLabel ? (
          <p className="pdd-buybox__range-note">All variants: {rangeLabel}</p>
        ) : null}
      </div>

      <div className={`pdd-buybox__stock ${inStock ? 'pdd-buybox__stock--in' : 'pdd-buybox__stock--out'}`}>
        {inStock ? `${activeListing.stock} in stock` : 'Product is out of stock'}
      </div>

      <dl className="pdd-buybox__facts">
        {activeListing.unit ? (
          <div className="pdd-buybox__fact">
            <dt>Unit</dt>
            <dd>{activeListing.unit}</dd>
          </div>
        ) : null}
        {Number(activeListing.min_order_quantity) > 1 ? (
          <div className="pdd-buybox__fact">
            <dt>MOQ</dt>
            <dd>{activeListing.min_order_quantity}</dd>
          </div>
        ) : null}
        {activeListing.location ? (
          <div className="pdd-buybox__fact">
            <dt>Ships from</dt>
            <dd>{activeListing.location}</dd>
          </div>
        ) : null}
        {Number(activeListing.supplierCount) > 0 ? (
          <div className="pdd-buybox__fact">
            <dt>Suppliers</dt>
            <dd>{activeListing.supplierCount}</dd>
          </div>
        ) : null}
      </dl>

      <Button
        className="pdd-buybox__cta"
        size="lg"
        onClick={openAddToCart}
        disabled={
          !inStock ||
          (!activeListing.canAddToCart && !productSummary.canAddToCart)
        }
        title={!inStock ? 'Product is out of stock' : undefined}
      >
        {cartAdded ? (
          <>
            <Check className="mr-2 h-4 w-4" /> Added to cart
          </>
        ) : !inStock ? (
          <>Product is out of stock</>
        ) : (
          <>
            <ShoppingCart className="mr-2 h-4 w-4" /> Add to cart
          </>
        )}
      </Button>

      <p className="pdd-buybox__note">
        Prices and stock reflect eligible supplier listings for your supply chain.
      </p>
    </aside>
  ) : null;

  return (
    <SpPageLayout>
      <SpPageHeader
        title="Product Details"
        description=""
        icon={Package}
        actions={
          <Button variant="outline" type="button" onClick={handleBackToDiscovery}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to discovery
          </Button>
        }
      />

      {error ? (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="pdd-hero">
          <Skeleton className="h-[460px] rounded-xl" />
          <div className="space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-10 w-1/3" />
            <Skeleton className="h-32 w-full" />
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : !detail ? (
        <SpEmptyState
          icon={Package}
          title="Product not found"
          description="This product may have been removed or is not available for discovery."
          action={
            <Button type="button" onClick={handleBackToDiscovery}>
              Return to discovery
            </Button>
          }
        />
      ) : (
        <div className="pdd-page">
          <div className="pdd-hero">
            <section className="pdd-gallery-col">
              <div className="pdd-gallery">
                {images.length > 1 ? (
                  <div className="pdd-image-thumbs">
                    {images.map((url, index) => (
                      <button
                        key={`${url}-${index}`}
                        type="button"
                        className={`pdd-image-thumb ${index === safeImageIndex ? 'pdd-image-thumb--active' : ''}`}
                        onClick={() => setActiveImageIndex(index)}
                      >
                        <img src={url} alt={`${productSummary.name || 'Product'} ${index + 1}`} />
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="pdd-main-image-wrap">
                  {images.length > 0 ? (
                    <>
                      <img
                        src={images[safeImageIndex]}
                        alt={productSummary.name || 'Product'}
                        className="pdd-main-image"
                      />
                      {images.length > 1 ? (
                        <>
                          <button
                            type="button"
                            className="pdd-image-nav pdd-image-nav--prev"
                            onClick={() =>
                              setActiveImageIndex((prev) => (prev - 1 + images.length) % images.length)
                            }
                            aria-label="Previous image"
                          >
                            <ChevronLeft size={20} />
                          </button>
                          <button
                            type="button"
                            className="pdd-image-nav pdd-image-nav--next"
                            onClick={() => setActiveImageIndex((prev) => (prev + 1) % images.length)}
                            aria-label="Next image"
                          >
                            <ChevronRight size={20} />
                          </button>
                          <span className="pdd-image-counter">
                            {safeImageIndex + 1} / {images.length}
                          </span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <div className="pdd-gallery__empty">
                      <ImageOff size={48} />
                      <span>No image available</span>
                    </div>
                  )}
                </div>
              </div>

              {detail.hasVariants && variants.length > 1 ? (
                <div className="pdd-variant-strip">
                  <span className="pdd-variant-strip__label">All variants</span>
                  <div className="pdd-thumbs">
                    {variants.map((variant) => {
                      const thumb = getProductImageList(variant)[0];
                      const active = variantSelectionKey(variant) === variantSelectionKey(selectedVariant);
                      return (
                        <button
                          key={variantSelectionKey(variant)}
                          type="button"
                          className={`pdd-thumb ${active ? 'pdd-thumb--active' : ''}`}
                          onClick={() => handleVariantChipSelect(variant)}
                          title={variantLabel(variant)}
                        >
                          {thumb ? (
                            <img src={thumb} alt={variantLabel(variant)} />
                          ) : (
                            <span className="pdd-thumb__placeholder">{variantLabel(variant).slice(0, 2)}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>

            <section className="pdd-detail-col">
              <div className="pdd-info__badges">
                {productSummary.category ? <Badge variant="secondary">{productSummary.category}</Badge> : null}
                {detail.hasVariants ? <Badge>{detail.variantCount} variants available</Badge> : null}
                {inStock ? <Badge className="pdd-badge--stock">In stock</Badge> : null}
              </div>

              <h1 className="pdd-info__title">{productSummary.name}</h1>
              {productSummary.brand ? (
                <p className="pdd-info__brand">
                  Brand: <strong>{productSummary.brand}</strong>
                </p>
              ) : null}

              <RatingStars rating={activeListing?.average_rating} reviews={activeListing?.total_reviews} />
              <SupplierTsinLine asin={activeListing?.asin} variantAsin={activeListing?.variantAsin} />

              {variantOptions.length > 0 ? (
                <div className="pdd-options">
                  {variantOptions.map((option) => (
                    <div key={option.key} className="pdd-option-group">
                      <span className="pdd-option-group__label">{option.label}</span>
                      <div className="pdd-option-group__values">
                        {option.values.map((value) => {
                          const active = optionSelections[option.key] === value;
                          return (
                            <button
                              key={`${option.key}-${value}`}
                              type="button"
                              className={`pdd-option-chip ${active ? 'pdd-option-chip--active' : ''}`}
                              onClick={() => handleOptionSelect(option.key, value)}
                            >
                              {value}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {detail.hasVariants && variantOptions.length === 0 ? (
                <div className="pdd-options">
                  <span className="pdd-option-group__label">Select variant</span>
                  <div className="pdd-option-group__values">
                    {variants.map((variant) => {
                      const active = variantSelectionKey(variant) === variantSelectionKey(selectedVariant);
                      return (
                        <button
                          key={variantSelectionKey(variant)}
                          type="button"
                          className={`pdd-option-chip ${active ? 'pdd-option-chip--active' : ''}`}
                          onClick={() => handleVariantChipSelect(variant)}
                        >
                          {variantLabel(variant)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {Array.isArray(activeListing?.tags) && activeListing.tags.length > 0 ? (
                <div className="pdd-tags">
                  <Tag size={14} />
                  {activeListing.tags.map((tag) => (
                    <span key={tag} className="pdd-tag">{tag}</span>
                  ))}
                </div>
              ) : null}

              <div className="pdd-buybox pdd-buybox--mobile">{buyBox}</div>
            </section>

            <div className="pdd-buybox-col pdd-buybox--desktop">{buyBox}</div>
          </div>

          {detailSections.length > 0 ? (
            <div className="pdd-sections">
              {detailSections.map((section) => {
              if (section.type === 'text') {
                return (
                  <CollapsibleSection key={section.id} id={section.id} title={section.title}>
                    <p className="pdd-description">{section.content}</p>
                  </CollapsibleSection>
                );
              }

              if (section.type === 'spec-table') {
                return (
                  <SpecTable
                    key={section.id}
                    title={section.title}
                    entries={section.entries}
                    sectionId={section.id}
                  />
                );
              }

              if (section.type === 'info-table') {
                return (
                  <InfoTable
                    key={section.id}
                    title={section.title}
                    rows={section.rows}
                    sectionId={section.id}
                  />
                );
              }

              if (section.type === 'variants-table') {
                return (
                  <CollapsibleSection key={section.id} id={section.id} title={section.title}>
                    <div className="pdd-variant-table-wrap">
                      <table className="pdd-variant-table">
                        <thead>
                          <tr>
                            <th>Variant</th>
                            <th>Price</th>
                            <th>Stock</th>
                            <th>Unit</th>
                            <th>MOQ</th>
                            <th>TSIN</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.variants.map((variant) => {
                            const active =
                              variantSelectionKey(variant) === variantSelectionKey(selectedVariant);
                            const rowPrice = formatPrice(variant.price, variant.unit);
                            return (
                              <tr
                                key={variantSelectionKey(variant)}
                                className={active ? 'pdd-variant-table__row--active' : ''}
                              >
                                <td>
                                  <button
                                    type="button"
                                    className="pdd-variant-table__link"
                                    onClick={() => handleVariantChipSelect(variant)}
                                  >
                                    {variantLabel(variant)}
                                  </button>
                                </td>
                                <td>{rowPrice || 'On request'}</td>
                                <td>{Number(variant.stock) > 0 ? variant.stock : 'Out of stock'}</td>
                                <td>{variant.unit || '—'}</td>
                                <td>{variant.min_order_quantity || 1}</td>
                                <td>{variant.variantAsin || variant.asin || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CollapsibleSection>
                );
              }

              return null;
            })}
            </div>
          ) : null}
        </div>
      )}

      <DiscoveryAddToCartDialog
        open={projectPickerOpen}
        onOpenChange={setProjectPickerOpen}
        product={
          activeListing
            ? {
                id: activeListing.productId,
                productId: activeListing.productId,
                name: activeListing.name || productSummary.name,
                variantKey: activeListing.variantKey || undefined
              }
            : null
        }
        onAdded={() => {
          setCartAdded(true);
          setTimeout(() => setCartAdded(false), 1400);
        }}
      />
    </SpPageLayout>
  );
}
