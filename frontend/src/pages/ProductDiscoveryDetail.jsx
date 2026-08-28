import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  Tag,
  X,
  ZoomIn
} from 'lucide-react';
import { getApiUrl } from '../config/api';
import { getSelectedListingImages } from '../utils/productImages';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpEmptyState from '../components/sp/SpEmptyState';
import DiscoveryAddToCartDialog from '../components/sp/DiscoveryAddToCartDialog';
import SupplierTsinLine from '../components/SupplierTsinLine';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  formatDiscoveryMrp,
  formatDiscoveryPrice,
  resolveDiscoveryDisplayPricing
} from '../utils/discoveryPricing';
import {
  specificationEntriesForCustomerDisplay
} from '../utils/specifications';
import {
  buildOptionSelectionsForVariant,
  pickPrimaryVariantOption,
  resolveActiveDiscoveryVariant,
  resolveDiscoveryVariantLabel,
  resolveViewerListingForVariant,
  resolveVariantDisplaySpecifications,
  variantMatchesSelections,
  variantSelectionKey
} from '../utils/discoveryVariantSelection';
import { resolveDiscoveryProductDescription } from '../utils/productDisplay';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity';
import {
  emitSupplierCartUpdated,
  readLastOrderedQuantity,
  subscribeSupplierCartUpdated
} from '../utils/supplierUpstreamCartSession';
import {
  buildUpstreamSourcingUrl,
  returnToDiscovery,
  returnToUpstreamSourcing
} from '../utils/discoveryNavigation';
import './ProductDiscoveryDetail.css';
import './ProductDiscovery.css';
import './SupplierUpstream.css';

function formatPrice(price, unit) {
  return formatDiscoveryPrice(price, unit);
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

export default function ProductDiscoveryDetail({ portal = 'service_provider' }) {
  const { productId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isUpstreamPortal = portal === 'supplier';
  const mineSupplierProductId = String(searchParams.get('mine') || '').trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [selectedVariantKey, setSelectedVariantKey] = useState('');
  const [optionSelections, setOptionSelections] = useState({});
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [cartAdded, setCartAdded] = useState(false);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [procurementQty, setProcurementQty] = useState(1);
  const [upstreamCartBusy, setUpstreamCartBusy] = useState(false);
  const [upstreamCartQty, setUpstreamCartQty] = useState(null);
  const [pendingRemoveFromCart, setPendingRemoveFromCart] = useState(false);
  const upstreamCartQtyRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in again to view product details.');
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setDetail(null);
    setSelectedVariantKey('');
    setOptionSelections({});
    setActiveImageIndex(0);

    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const detailPath = isUpstreamPortal
          ? `/api/supplier/upstream/products/${productId}/detail`
          : `/api/supplier/products/${productId}/detail`;
        const response = await fetch(getApiUrl(detailPath), {
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
  }, [productId, isUpstreamPortal]);

  const variants = useMemo(
    () => (Array.isArray(detail?.variants) ? detail.variants : []),
    [detail?.variants]
  );
  const viewerListings = useMemo(
    () => (Array.isArray(detail?.viewerListings) ? detail.viewerListings : []),
    [detail?.viewerListings]
  );

  const allVariantOptions = Array.isArray(detail?.variantOptions) ? detail.variantOptions : [];
  const selectorOptions = useMemo(
    () => pickPrimaryVariantOption(allVariantOptions),
    [allVariantOptions]
  );

  const selectedVariant = useMemo(
    () =>
      resolveActiveDiscoveryVariant({
        variants,
        selectedVariantKey,
        optionSelections,
        urlVariantToken: searchParams.get('variant'),
        mineSupplierProductId,
        viewerListings: isUpstreamPortal ? viewerListings : []
      }),
    [
      variants,
      searchParams,
      selectedVariantKey,
      optionSelections,
      mineSupplierProductId,
      viewerListings,
      isUpstreamPortal
    ]
  );

  // Hydrate option chips from URL / default / explicit variant so first paint matches the active listing.
  useEffect(() => {
    if (!variants.length || !selectorOptions.length) return;
    if (Object.keys(optionSelections || {}).length > 0) return;
    const source =
      selectedVariant ||
      resolveActiveDiscoveryVariant({
        variants,
        selectedVariantKey,
        optionSelections: {},
        urlVariantToken: searchParams.get('variant'),
        mineSupplierProductId,
        viewerListings: isUpstreamPortal ? viewerListings : []
      });
    if (!source) return;
    const next = buildOptionSelectionsForVariant(source, selectorOptions);
    if (Object.keys(next).length === 0) return;
    setOptionSelections(next);
    if (!selectedVariantKey) {
      setSelectedVariantKey(variantSelectionKey(source));
    }
  }, [
    variants,
    selectorOptions,
    optionSelections,
    selectedVariant,
    selectedVariantKey,
    searchParams,
    mineSupplierProductId,
    viewerListings,
    isUpstreamPortal
  ]);

  useEffect(() => {
    setActiveImageIndex(0);
  }, [selectedVariantKey, searchParams, optionSelections]);

  const syncVariantToUrl = (variant) => {
    if (!variant) return;
    const token =
      variant.variantKey ||
      variant.variantAsin ||
      variant.supplierProductId ||
      variant.productId;
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
  // Do not fall back to variants[0] when option chips form an incompatible combo.
  const activeListing = selectedVariant;
  const viewerListing = useMemo(
    () =>
      isUpstreamPortal
        ? resolveViewerListingForVariant(viewerListings, activeListing, mineSupplierProductId)
        : null,
    [isUpstreamPortal, viewerListings, activeListing, mineSupplierProductId, selectedVariantKey]
  );
  const displayUnit =
    viewerListing?.unit || activeListing?.unit || productSummary.unit;
  const displayPrice = isUpstreamPortal
    ? viewerListing?.price ?? activeListing?.price
    : activeListing?.price;
  // Upstream portal: Product_COV applies to the selected upstream/catalog listing being sourced,
  // not to the viewer's own listing price.
  const displayPricing = resolveDiscoveryDisplayPricing(
    isUpstreamPortal
      ? activeListing?.bcovApplied
        ? activeListing
        : { price: displayPrice, bcovApplied: false }
      : activeListing || {}
  );
  const displayStock = isUpstreamPortal
    ? viewerListing?.stock ?? activeListing?.stock
    : activeListing?.stock;
  const upstreamMineId = useMemo(() => {
    if (!isUpstreamPortal) return '';
    return String(
      viewerListing?.id ||
        activeListing?.supplierProductId ||
        mineSupplierProductId ||
        ''
    ).trim();
  }, [
    isUpstreamPortal,
    viewerListing?.id,
    activeListing?.supplierProductId,
    mineSupplierProductId
  ]);
  const upstreamMinQty = Math.max(
    1,
    Number(activeListing?.min_order_quantity ?? viewerListing?.min_order_quantity ?? 1) || 1
  );

  useEffect(() => {
    if (!isUpstreamPortal) return;
    // Default stepper on listing/variant change. Do not copy cart qty or bump to MOQ —
    // refresh/navigation must not rewrite the field; the user sets quantity explicitly.
    setProcurementQty(1);
  }, [isUpstreamPortal, upstreamMineId]);

  useEffect(() => {
    if (!isUpstreamPortal || !upstreamMineId) {
      setUpstreamCartQty(null);
      return undefined;
    }
    let cancelled = false;
    const loadCartQty = async () => {
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const response = await fetch(getApiUrl('/api/supplier/upstream/cart'), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-cache'
        });
        const data = await response.json();
        if (!response.ok || data.status !== 'success' || cancelled) return;
        const projects = Array.isArray(data?.cart?.draft?.projects) ? data.cart.draft.projects : [];
        let found = null;
        for (const project of projects) {
          const items = Array.isArray(project?.items) ? project.items : [];
          for (const item of items) {
            const mineId = String(item?.mineSupplierProductId || item?.mineId || '').trim();
            if (mineId === upstreamMineId) {
              found = parseSupplierStockQuantity(item?.quantity);
              break;
            }
          }
          if (found != null) break;
          const selected = project?.selectedMine && typeof project.selectedMine === 'object'
            ? project.selectedMine
            : {};
          if (selected[upstreamMineId] != null) {
            found = parseSupplierStockQuantity(selected[upstreamMineId]);
            break;
          }
        }
        if (!cancelled) {
          const liveQty = found != null && found > 0 ? found : null;
          setUpstreamCartQty(liveQty);
          const prevQty = upstreamCartQtyRef.current;
          if (prevQty != null && prevQty > 0 && liveQty == null) {
            // Ordered or removed from cart: start a new order qty. Do not keep
            // the previous cart quantity attached to Add / Continue sourcing.
            setProcurementQty(1);
            setCartAdded(false);
          }
          upstreamCartQtyRef.current = liveQty;
        }
      } catch {
        if (!cancelled) setUpstreamCartQty(null);
      }
    };
    loadCartQty();
    const unsubscribe = subscribeSupplierCartUpdated(
      () => {
        void loadCartQty();
      },
      { includeFocus: false }
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [isUpstreamPortal, upstreamMineId, upstreamMinQty]);

  const displaySpecifications = useMemo(
    () => resolveVariantDisplaySpecifications(activeListing),
    [activeListing, selectedVariantKey]
  );
  // Active variant first; upstream viewer listing name is a fallback when the offer row
  // carries a display name and the catalog variant record does not.
  const displayProductName =
    activeListing?.name ||
    (isUpstreamPortal ? viewerListing?.name : null) ||
    productSummary.name ||
    'Product';
  const displayBrand = isUpstreamPortal
    ? viewerListing?.brand || activeListing?.brand || productSummary.brand
    : productSummary.brand;
  const displayCategory = isUpstreamPortal
    ? viewerListing?.category || activeListing?.category || productSummary.category
    : productSummary.category;
  const images = getSelectedListingImages(activeListing);
  const safeImageIndex = images.length ? Math.min(activeImageIndex, images.length - 1) : 0;

  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setLightboxOpen(false);
        return;
      }
      if (images.length < 2) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setActiveImageIndex((prev) => (prev - 1 + images.length) % images.length);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setActiveImageIndex((prev) => (prev + 1) % images.length);
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [lightboxOpen, images.length]);
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
  const priceLabel = useMemo(
    () => formatPrice(displayPricing.price ?? displayPrice, displayUnit),
    [displayPricing.price, displayPrice, displayUnit, selectedVariantKey]
  );
  const mrpLabel = useMemo(
    () =>
      displayPricing.bcovApplied ? formatDiscoveryMrp(displayPricing.mrp) : null,
    [displayPricing.bcovApplied, displayPricing.mrp, selectedVariantKey]
  );
  const rangeLabel = isUpstreamPortal
    ? null
    : formatPriceRange(productSummary.priceRange, productSummary.unit);
  const inStock = Number(displayStock) > 0;
  const lastOrderedQty =
    isUpstreamPortal && upstreamMineId && upstreamCartQty == null
      ? readLastOrderedQuantity(upstreamMineId)
      : null;

  const backLabel = isUpstreamPortal ? 'Back to upstream sourcing' : 'Back to discovery';

  const handleBackToList = () => {
    if (isUpstreamPortal) {
      returnToUpstreamSourcing({ navigate, searchParams });
      return;
    }
    returnToDiscovery({ navigate, searchParams });
  };

  const persistUpstreamCartQuantity = async (offerId, nextQty) => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in again to update cart quantity.');
      return false;
    }
    setUpstreamCartBusy(true);
    setError('');
    try {
      const response = await fetch(getApiUrl('/api/supplier/upstream/cart/items'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          mineSupplierProductId: offerId,
          quantity: nextQty,
          replaceQuantity: true,
          ...(activeListing?.variantKey ? { variantKey: String(activeListing.variantKey) } : {}),
          ...(activeListing?.variantAsin
            ? { variantAsin: String(activeListing.variantAsin) }
            : {}),
          ...(displayProductName ? { variantLabel: String(displayProductName) } : {})
        })
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        const message = String(data?.message || '');
        if (
          /not in your upstream cart/i.test(message) ||
          /project not found/i.test(message)
        ) {
          setUpstreamCartQty(null);
          if (nextQty <= 0) {
            setProcurementQty(1);
            return true;
          }
          navigate(
            buildUpstreamSourcingUrl({
              addSupplierProductId: offerId,
              quantity: nextQty
            })
          );
          return false;
        }
        throw new Error(message || 'Failed to update cart quantity.');
      }
      if (data?.item?.removed === true || nextQty === 0) {
        setUpstreamCartQty(null);
        setProcurementQty(1);
        setCartAdded(false);
        emitSupplierCartUpdated();
        return true;
      }
      const savedQty = parseSupplierStockQuantity(data?.item?.quantity) ?? nextQty;
      setUpstreamCartQty(savedQty);
      setProcurementQty(1);
      setCartAdded(true);
      window.setTimeout(() => setCartAdded(false), 1400);
      emitSupplierCartUpdated();
      return true;
    } catch (updateError) {
      setError(updateError?.message || 'Failed to update cart quantity.');
      return false;
    } finally {
      setUpstreamCartBusy(false);
    }
  };

  const handleCancelRemoveFromCart = () => {
    setPendingRemoveFromCart(false);
    if (upstreamCartQty != null && upstreamCartQty > 0) {
      setProcurementQty(upstreamCartQty);
    }
  };

  const handleConfirmRemoveFromCart = async () => {
    setPendingRemoveFromCart(false);
    const offerId = upstreamMineId;
    if (!offerId) return;
    await persistUpstreamCartQuantity(offerId, 0);
  };

  const openAddToCart = async () => {
    // Upstream: set/update procurement qty here, then continue sourcing with that qty —
    // do not force users back to the catalog grid just to change quantity.
    if (isUpstreamPortal) {
      const offerId = upstreamMineId;
      if (!offerId) {
        setError('This listing could not be linked for upstream sourcing.');
        return;
      }
      const parsedQty = parseSupplierStockQuantity(procurementQty);
      if (upstreamCartQty != null && parsedQty === 0) {
        setPendingRemoveFromCart(true);
        return;
      }
      if (parsedQty == null || parsedQty <= 0) {
        setError(
          upstreamMinQty > 1
            ? `Quantity must be at least ${upstreamMinQty} (minimum order quantity). Quantity 0 cannot be added to the cart.`
            : 'Quantity must be at least 1. Set a quantity greater than 0 to add this product to the cart.'
        );
        return;
      }
      if (parsedQty < upstreamMinQty) {
        setError(
          `Quantity must be at least ${upstreamMinQty} (minimum order quantity).`
        );
        return;
      }
      const nextQty = parsedQty;

      // Additional quantity is added from Upstream Sourcing so the user can choose
      // the same project or a different one. This page never rewrites cart qty on load.
      navigate(
        buildUpstreamSourcingUrl({
          addSupplierProductId: offerId,
          quantity: nextQty
        })
      );
      return;
    }
    if (!activeListing) {
      setError('Choose a valid combination of options to continue.');
      return;
    }
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
    const nextSelections = { ...optionSelections, [optionKey]: value };
    setOptionSelections(nextSelections);
    const matched = variants.find((variant) => variantMatchesSelections(variant, nextSelections));
    if (matched) {
      setSelectedVariantKey(variantSelectionKey(matched));
      syncVariantToUrl(matched);
      return;
    }
    // Leave chips as partial combo; active listing becomes null until a match exists.
    setSelectedVariantKey('');
  };

  const handleVariantChipSelect = (variant) => {
    setSelectedVariantKey(variantSelectionKey(variant));
    if (selectorOptions.length > 0) {
      setOptionSelections(buildOptionSelectionsForVariant(variant, selectorOptions));
    } else {
      setOptionSelections({});
    }
    syncVariantToUrl(variant);
  };

  const buyBox = activeListing ? (
    <aside className="pdd-buybox">
      <div className="pdd-buybox__price-block">
        {priceLabel ? (
          <div className="pdd-buybox__price">
            {mrpLabel ? (
              <span className="pdd-buybox__mrp" aria-label={`MRP ${mrpLabel}`}>
                {mrpLabel}
              </span>
            ) : null}
            <span className="pdd-buybox__offer-price">{priceLabel}</span>
          </div>
        ) : null}
        {!priceLabel && rangeLabel ? <div className="pdd-buybox__price">{rangeLabel}</div> : null}
        {!priceLabel && !rangeLabel ? (
          <div className="pdd-buybox__price pdd-buybox__price--na">
            {isUpstreamPortal ? 'Your listing price n/a' : 'Price on request'}
          </div>
        ) : null}
        {priceLabel && rangeLabel && rangeLabel !== priceLabel ? (
          <p className="pdd-buybox__range-note">All variants: {rangeLabel}</p>
        ) : null}
      </div>

      <div className={`pdd-buybox__stock ${inStock ? 'pdd-buybox__stock--in' : 'pdd-buybox__stock--out'}`}>
        {inStock ? `${displayStock} in stock` : 'Product is out of stock'}
      </div>

      {isUpstreamPortal ? (
        <div className="pdd-buybox__qty">
          <span className="pdd-buybox__qty-label">Procurement quantity</span>
          <div className="pdd-buybox__qty-control">
            <button
              type="button"
              className="pdd-buybox__qty-btn"
              onClick={() =>
                setProcurementQty((prev) => {
                  const floor = upstreamCartQty != null ? 0 : upstreamMinQty;
                  return Math.max(floor, (parseSupplierStockQuantity(prev) ?? floor) - 1);
                })
              }
              disabled={
                upstreamCartBusy ||
                (parseSupplierStockQuantity(procurementQty) ??
                  (upstreamCartQty != null ? 0 : upstreamMinQty)) <=
                  (upstreamCartQty != null ? 0 : upstreamMinQty)
              }
              aria-label="Decrease procurement quantity"
            >
              −
            </button>
            <span className="pdd-buybox__qty-value">
              {parseSupplierStockQuantity(procurementQty) ??
                (upstreamCartQty != null ? 0 : upstreamMinQty)}
            </span>
            <button
              type="button"
              className="pdd-buybox__qty-btn"
              onClick={() =>
                setProcurementQty((prev) =>
                  Math.max(upstreamMinQty, (parseSupplierStockQuantity(prev) ?? upstreamMinQty) + 1)
                )
              }
              disabled={upstreamCartBusy}
              aria-label="Increase procurement quantity"
            >
              +
            </button>
          </div>
          {upstreamCartQty != null && (parseSupplierStockQuantity(procurementQty) ?? 0) <= 0 ? (
            <p className="pdd-buybox__qty-hint">
              Quantity 0 removes this product from the cart. Click Remove from Cart to confirm.
            </p>
          ) : upstreamCartQty != null ? (
            <p className="pdd-buybox__qty-hint">
              In cart: {upstreamCartQty}. Set an additional quantity, then continue sourcing to add it
              to the same project or a different one.
            </p>
          ) : lastOrderedQty != null ? (
            <p className="pdd-buybox__qty-hint">
              Last ordered: {lastOrderedQty}. Set a new quantity here to place another order — this is not in your cart.
            </p>
          ) : (
            <p className="pdd-buybox__qty-hint">Set qty here, then continue sourcing — no need to revisit the catalog grid.</p>
          )}
        </div>
      ) : null}

      <dl className="pdd-buybox__facts">
        {displayUnit ? (
          <div className="pdd-buybox__fact">
            <dt>Unit</dt>
            <dd>{displayUnit}</dd>
          </div>
        ) : null}
        {Number(activeListing?.min_order_quantity ?? viewerListing?.min_order_quantity) > 1 ? (
          <div className="pdd-buybox__fact">
            <dt>MOQ</dt>
            <dd>{activeListing?.min_order_quantity ?? viewerListing?.min_order_quantity}</dd>
          </div>
        ) : null}
        {(activeListing?.location || viewerListing?.location) ? (
          <div className="pdd-buybox__fact">
            <dt>Ships from</dt>
            <dd>{activeListing?.location || viewerListing?.location}</dd>
          </div>
        ) : null}
        {Number(activeListing.supplierCount) > 0 ? (
          <div className="pdd-buybox__fact">
            <dt>{isUpstreamPortal ? 'Listings' : 'Suppliers'}</dt>
            <dd>{activeListing.supplierCount}</dd>
          </div>
        ) : null}
      </dl>

      <Button
        type="button"
        className="pdd-buybox__cta"
        size="lg"
        onClick={openAddToCart}
        disabled={
          upstreamCartBusy ||
          (!isUpstreamPortal &&
            (!inStock || (!activeListing.canAddToCart && !productSummary.canAddToCart)))
        }
        title={!isUpstreamPortal && !inStock ? 'Product is out of stock' : undefined}
      >
        {isUpstreamPortal ? (
          upstreamCartBusy ? (
            <>Updating…</>
          ) : cartAdded && upstreamCartQty != null ? (
            <>
              <Check className="mr-2 h-4 w-4" /> Added to cart
            </>
          ) : upstreamCartQty != null && (parseSupplierStockQuantity(procurementQty) ?? 0) <= 0 ? (
            <>
              <ShoppingCart className="mr-2 h-4 w-4" /> Remove from Cart
            </>
          ) : (
            <>
              <ShoppingCart className="mr-2 h-4 w-4" /> Continue sourcing
            </>
          )
        ) : cartAdded ? (
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
        {isUpstreamPortal
          ? upstreamCartQty != null
            ? 'Cart quantity stays as saved until you add more from Upstream Sourcing or change it in Cart.'
            : lastOrderedQty != null
              ? 'Previously ordered quantity is shown for reference only. Set a new quantity to start another order.'
              : 'Choose quantity here, then continue to Upstream Sourcing and click Add to Cart to choose a project.'
          : 'Prices and stock reflect eligible supplier listings for your supply chain.'}
      </p>
    </aside>
  ) : variants.length > 0 ? (
    <aside className="pdd-buybox">
      <div className="pdd-buybox__price pdd-buybox__price--na">Select a valid option combination</div>
      <p className="pdd-buybox__note">
        That combination is not available. Choose options that match a listed variant.
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
          <Button variant="outline" type="button" onClick={handleBackToList}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            {backLabel}
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
          description={
            isUpstreamPortal
              ? 'This product may have been removed or is no longer available in the catalog.'
              : 'This product may have been removed or is not available for discovery.'
          }
          action={
            <Button type="button" onClick={handleBackToList}>
              {isUpstreamPortal ? 'Return to upstream sourcing' : 'Return to discovery'}
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
                        <img src={url} alt={`${displayProductName} ${index + 1}`} />
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="pdd-main-image-wrap">
                  {images.length > 0 ? (
                    <>
                      <button
                        type="button"
                        className="pdd-main-image-btn"
                        onClick={() => setLightboxOpen(true)}
                        aria-label={`View larger image of ${displayProductName}`}
                      >
                        <img
                          src={images[safeImageIndex]}
                          alt={displayProductName}
                          className="pdd-main-image"
                        />
                        <span className="pdd-zoom-hint">
                          <ZoomIn size={16} />
                          Click to enlarge
                        </span>
                      </button>
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
                      const thumb = getSelectedListingImages(variant)[0];
                      const active = variantSelectionKey(variant) === variantSelectionKey(selectedVariant);
                      return (
                        <button
                          key={variantSelectionKey(variant)}
                          type="button"
                          className={`pdd-thumb ${active ? 'pdd-thumb--active' : ''}`}
                          onClick={() => handleVariantChipSelect(variant)}
                          title={resolveDiscoveryVariantLabel(variant, allVariantOptions)}
                        >
                          {thumb ? (
                            <img src={thumb} alt={resolveDiscoveryVariantLabel(variant, allVariantOptions)} />
                          ) : (
                            <span className="pdd-thumb__placeholder">{resolveDiscoveryVariantLabel(variant, allVariantOptions).slice(0, 2)}</span>
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
                {displayCategory ? <Badge variant="secondary">{displayCategory}</Badge> : null}
                {detail.hasVariants ? <Badge>{detail.variantCount} variants available</Badge> : null}
                {inStock ? <Badge className="pdd-badge--stock">In stock</Badge> : null}
              </div>

              <h1 className="pdd-info__title">{displayProductName}</h1>
              {displayBrand ? (
                <p className="pdd-info__brand">
                  Brand: <strong>{displayBrand}</strong>
                </p>
              ) : null}

              <RatingStars rating={activeListing?.average_rating} reviews={activeListing?.total_reviews} />
              <SupplierTsinLine asin={activeListing?.asin} variantAsin={activeListing?.variantAsin} />

              {selectorOptions.length > 0 ? (
                <div className="pdd-options">
                  {selectorOptions.map((option) => {
                    const selectedValue = optionSelections[option.key];
                    return (
                      <div key={option.key} className="pdd-option-group">
                        <span className="pdd-option-group__label">
                          {option.label}
                          {selectedValue ? (
                            <>
                              {': '}
                              <strong className="pdd-option-group__selected">{selectedValue}</strong>
                            </>
                          ) : null}
                        </span>
                        <div className="pdd-option-group__values">
                          {option.values.map((value) => {
                            const active = selectedValue === value;
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
                    );
                  })}
                </div>
              ) : null}

              {detail.hasVariants && allVariantOptions.length === 0 ? (
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
                          {resolveDiscoveryVariantLabel(variant, allVariantOptions)}
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
                    key={`${section.id}-${variantSelectionKey(selectedVariant)}`}
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
                            const rowPricing = resolveDiscoveryDisplayPricing(variant);
                            const rowPrice = formatPrice(rowPricing.price, variant.unit);
                            const rowMrp = rowPricing.bcovApplied
                              ? formatDiscoveryMrp(rowPricing.mrp)
                              : null;
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
                                    {resolveDiscoveryVariantLabel(variant, allVariantOptions)}
                                  </button>
                                </td>
                                <td>
                                  {rowPrice ? (
                                    <span className="pdd-variant-table__price">
                                      {rowMrp ? (
                                        <span className="pdd-variant-table__mrp">{rowMrp}</span>
                                      ) : null}
                                      <span>{rowPrice}</span>
                                    </span>
                                  ) : (
                                    'On request'
                                  )}
                                </td>
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

      {isUpstreamPortal ? (
        <Dialog
          open={pendingRemoveFromCart}
          onOpenChange={(open) => {
            if (!open) setPendingRemoveFromCart(false);
          }}
        >
          <DialogContent className="inset-auto left-1/2 top-1/2 h-auto w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg">
            <DialogHeader className="pr-8">
              <DialogTitle>Delete product</DialogTitle>
              <DialogDescription>
                Quantity 0 is not a valid cart quantity. Do you want to delete this product from the cart?
                {displayProductName ? (
                  <span className="mt-2 block font-medium text-foreground">{displayProductName}</span>
                ) : null}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCancelRemoveFromCart}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={() => void handleConfirmRemoveFromCart()}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        <DiscoveryAddToCartDialog
          open={projectPickerOpen}
          onOpenChange={setProjectPickerOpen}
          product={
            activeListing
              ? {
                  id: activeListing.productId,
                  productId: activeListing.productId,
                  name: displayProductName,
                  stock: activeListing.stock,
                  variantKey: activeListing.variantKey || undefined,
                  variantAsin: activeListing.variantAsin || undefined,
                  variantLabel: resolveDiscoveryVariantLabel(activeListing, allVariantOptions)
                }
              : null
          }
          onAdded={() => {
            setCartAdded(true);
            setTimeout(() => setCartAdded(false), 1400);
          }}
        />
      )}
      {lightboxOpen && images.length > 0
        ? createPortal(
            <div
              className="pdd-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={`${displayProductName} image ${safeImageIndex + 1} of ${images.length}`}
              onClick={() => setLightboxOpen(false)}
            >
              <button
                type="button"
                className="pdd-lightbox__close"
                onClick={() => setLightboxOpen(false)}
                aria-label="Close enlarged image"
              >
                <X size={22} />
              </button>
              {images.length > 1 ? (
                <button
                  type="button"
                  className="pdd-lightbox__nav pdd-lightbox__nav--prev"
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveImageIndex((prev) => (prev - 1 + images.length) % images.length);
                  }}
                  aria-label="Previous image"
                >
                  <ChevronLeft size={28} />
                </button>
              ) : null}
              <img
                src={images[safeImageIndex]}
                alt={displayProductName}
                className="pdd-lightbox__image"
                onClick={(event) => event.stopPropagation()}
              />
              {images.length > 1 ? (
                <button
                  type="button"
                  className="pdd-lightbox__nav pdd-lightbox__nav--next"
                  onClick={(event) => {
                    event.stopPropagation();
                    setActiveImageIndex((prev) => (prev + 1) % images.length);
                  }}
                  aria-label="Next image"
                >
                  <ChevronRight size={28} />
                </button>
              ) : null}
              {images.length > 1 ? (
                <span className="pdd-lightbox__counter">
                  {safeImageIndex + 1} / {images.length}
                </span>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </SpPageLayout>
  );
}
