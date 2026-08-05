import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronRight, ImageOff, MapPin, Package, Search, ShoppingCart, Star, Tag, Users } from 'lucide-react';
import { getApiUrl } from '../config/api';
import ProductImageCarousel from '../components/ProductImageCarousel';
import { getProductImageList } from '../utils/productImages';
import VoiceGuidedBanner from '../components/VoiceGuidedBanner';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpEmptyState from '../components/sp/SpEmptyState';
import DiscoveryAddToCartDialog from '../components/sp/DiscoveryAddToCartDialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRupeePerUnit } from '../utils/formatRupee';
import { specificationEntriesForCustomerDisplay } from '../utils/specifications';
import { openProductDetailInNewTab } from '../utils/discoveryNavigation';
import { dedupeLabelsCaseInsensitive } from '../utils/categoryNormalize';
import './ProductDiscovery.css';

function formatPrice(price, unit) {
  const num = Number(price);
  if (!Number.isFinite(num) || num <= 0) return null;
  return formatRupeePerUnit(num, unit, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function RatingStars({ rating, reviews }) {
  const num = Number(rating);
  if (!Number.isFinite(num) || num <= 0) return null;
  const full = Math.floor(num);
  const hasHalf = num - full >= 0.25;
  return (
    <div className="pd-rating">
      <div className="pd-rating__stars">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            size={14}
            className={i < full ? 'pd-star--filled' : (i === full && hasHalf) ? 'pd-star--half' : 'pd-star--empty'}
          />
        ))}
      </div>
      <span className="pd-rating__value">{num.toFixed(1)}</span>
      {Number(reviews) > 0 && <span className="pd-rating__count">({reviews})</span>}
    </div>
  );
}

function SpecBadges({ specifications }) {
  const allEntries = specificationEntriesForCustomerDisplay(specifications);
  const entries = allEntries.slice(0, 4);
  if (!entries.length) return null;
  return (
    <div className="pd-specs">
      {entries.map((entry) => (
        <span key={entry.key} className="pd-spec-badge">
          <strong>{entry.label}:</strong> {entry.displayValue}
        </span>
      ))}
      {allEntries.length > 4 && (
        <span className="pd-spec-badge pd-spec-more">+{allEntries.length - 4} more</span>
      )}
    </div>
  );
}

function TagList({ tags }) {
  const list = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!list.length) return null;
  return (
    <div className="pd-tags">
      <Tag size={12} />
      {list.slice(0, 5).map((t) => (
        <span key={t} className="pd-tag">{t}</span>
      ))}
      {list.length > 5 && <span className="pd-tag pd-tag--more">+{list.length - 5}</span>}
    </div>
  );
}

const ProductDiscovery = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const searchQuery = searchParams.get('q') || '';
  const selectedCategory = searchParams.get('category') || '';
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recommendationMode, setRecommendationMode] = useState('');
  const [cartAddedByProductId, setCartAddedByProductId] = useState({});
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [pendingProduct, setPendingProduct] = useState(null);
  const pageSize = 24;

  const page = useMemo(() => {
    const parsed = Number.parseInt(String(searchParams.get('page') || ''), 10);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
  }, [searchParams]);

  const goToPage = (nextPage) => {
    const safe = Math.max(1, nextPage);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (safe <= 1) next.delete('page');
        else next.set('page', String(safe));
        return next;
      },
      { replace: true }
    );
  };

  const updateSelectedCategory = (value) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const trimmed = String(value || '').trim();
        if (trimmed) next.set('category', trimmed);
        else next.delete('category');
        next.delete('page');
        return next;
      },
      { replace: true }
    );
  };

  const categories = useMemo(() => {
    const merged = dedupeLabelsCaseInsensitive([
      ...categoryOptions.map((option) => ({
        value: String(option?.value || '').trim(),
        label: String(option?.label || option?.value || '').trim()
      })),
      ...products.map((product) => ({
        value: String(product?.category || '').trim(),
        label: String(product?.category || '').trim()
      })),
      ...(selectedCategory.trim()
        ? [{ value: selectedCategory.trim(), label: selectedCategory.trim() }]
        : [])
    ]);

    return merged.sort((a, b) => a.label.localeCompare(b.label));
  }, [categoryOptions, products, selectedCategory]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in again to discover products.');
      return undefined;
    }

    const controller = new AbortController();

    const timeoutId = setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        if (searchQuery.trim()) params.set('q', searchQuery.trim());
        if (selectedCategory.trim()) params.set('category', selectedCategory.trim());
        params.set('limit', String(pageSize));
        params.set('page', String(page));

        const response = await fetch(getApiUrl(`/api/supplier/products/search?${params.toString()}`), {
          headers: {
            Authorization: `Bearer ${token}`
          },
          signal: controller.signal
        });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok || data.status !== 'success') {
          throw new Error(data.message || 'Failed to fetch products');
        }
        setProducts(Array.isArray(data.suggestions) ? data.suggestions : []);
        setTotal(Number.isFinite(Number(data.total)) ? Number(data.total) : 0);
        setRecommendationMode(String(data.recommendationMode || ''));
        const discoveredCategories = (Array.isArray(data.categories) ? data.categories : [])
          .map((category) => {
            const value = String(category || '').trim();
            return value ? { value, label: value } : null;
          })
          .filter(Boolean);
        if (discoveredCategories.length > 0) {
          setCategoryOptions((prev) =>
            dedupeLabelsCaseInsensitive([...prev, ...discoveredCategories]).sort((a, b) =>
              a.label.localeCompare(b.label)
            )
          );
        }
      } catch (fetchError) {
        if (controller.signal.aborted || fetchError?.name === 'AbortError') return;
        setProducts([]);
        setTotal(0);
        setRecommendationMode('');
        setError(fetchError.message || 'Failed to fetch products');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [searchQuery, selectedCategory, page]);

  const pageCount = useMemo(() => {
    if (!total || total < 1) return 1;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [total]);

  const safePage = Math.min(Math.max(page, 1), pageCount);

  const openProjectPicker = (product) => {
    const pid = String(product?.id || '').trim();
    if (!pid) {
      setError('This product cannot be added because its id is missing.');
      return;
    }
    if (Number(product?.supplierCount || 0) <= 0) {
      setError("This product is approved but not currently listed by an eligible supplier.");
      return;
    }
    if (!(Number(product?.stock) > 0)) {
      setError('Product is out of stock');
      return;
    }
    setPendingProduct(product);
    setProjectPickerOpen(true);
  };

  const handleCartAdded = (productId) => {
    setCartAddedByProductId((prev) => ({ ...prev, [String(productId)]: true }));
    setTimeout(() => {
      setCartAddedByProductId((prev) => {
        const { [String(productId)]: _removed, ...rest } = prev;
        return rest;
      });
    }, 1400);
  };

  const imageArray = (product) => getProductImageList(product);

  return (
    <SpPageLayout>
      <VoiceGuidedBanner />
      <SpPageHeader
        title="Discover Products"
        description=""
        icon={Search}
        actions={
          <Button variant="outline" onClick={() => navigate('/boq-normalize')}>
            Upload BOQ
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className="h-10 min-w-[200px] rounded-md border border-input bg-background px-3 text-sm"
          value={selectedCategory}
          onChange={(event) => updateSelectedCategory(event.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.value} value={category.value}>
              {category.label}
            </option>
          ))}
        </select>
      </div>

      {error ? <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div> : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          <strong className="text-foreground">{Number.isFinite(total) ? total : 0}</strong> product{total === 1 ? '' : 's'}
          {recommendationMode === 'search-relevance' ? (
            <Badge className="ml-2" variant="secondary">Search relevance</Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={loading || safePage <= 1} onClick={() => goToPage(safePage - 1)}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="text-sm text-muted-foreground">{safePage} / {pageCount}</span>
          <Button variant="outline" size="sm" disabled={loading || safePage >= pageCount} onClick={() => goToPage(safePage + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3 pt-4">
                <Skeleton className="h-40 w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : products.length === 0 ? (
        <SpEmptyState
          icon={Package}
          title="No products found"
          description={
            searchQuery.trim()
              ? 'Try a different search or category, or start from a BOQ upload.'
              : 'Try a different category, or start from a BOQ upload.'
          }
          action={<Button onClick={() => navigate('/boq-normalize')}>Upload BOQ</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {products.map((product) => {
            const imgs = imageArray(product);
            const price = formatPrice(product?.price, product?.unit);
            const pid = String(product?.id || '');
            const inStock = Number(product?.stock) > 0;
            const hasEligibleSupplier = Number(product?.supplierCount || 0) > 0;
            const moq = Number(product?.min_order_quantity);

            const hasVariants = Boolean(product?.hasVariants) || Number(product?.variantCount || 0) > 1;
            const canViewDetails = Boolean(product?.id);

            return (
              <article
                className={`pd-card flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${canViewDetails ? 'pd-card--clickable' : ''}`}
                key={product.id || `${product.name}-${product.category}`}
                onClick={canViewDetails ? () => openProductDetailInNewTab(product.id) : undefined}
                onKeyDown={
                  canViewDetails
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          openProductDetailInNewTab(product.id);
                        }
                      }
                    : undefined
                }
                role={canViewDetails ? 'link' : undefined}
                tabIndex={canViewDetails ? 0 : undefined}
                title={canViewDetails ? 'View full product details in a new tab' : undefined}
              >
                <div className="pd-card__image">
                  {imgs.length > 0 ? (
                    <ProductImageCarousel images={imgs} alt={product.name} height={180} rounded={10} />
                  ) : (
                    <div className="pd-card__no-image">
                      <ImageOff size={36} />
                      <span>No image</span>
                    </div>
                  )}
                  {product.category && (
                    <span className="pd-card__category-badge">{product.category}</span>
                  )}
                  {hasVariants ? (
                    <span className="pd-card__variant-badge">
                      {Number(product.variantCount || 0)} variants
                    </span>
                  ) : null}
                </div>

                <div className="pd-card__body">
                  <div className="pd-card__header">
                    <h3 className="pd-card__name">{product.name || 'Unnamed Product'}</h3>
                    {product.brand && <span className="pd-card__brand">{product.brand}</span>}
                  </div>

                  <RatingStars rating={product.average_rating} reviews={product.total_reviews} />

                  <SpecBadges specifications={product.specifications} />
                  <TagList tags={product.tags} />

                  <div className="pd-card__details">
                    {price && <span className="pd-card__price">{price}</span>}
                    {!price && <span className="pd-card__price pd-card__price--na">Price on request</span>}

                    <div className="pd-card__meta-row">
                      {product.unit && <span className="pd-card__meta-item">Unit: {product.unit}</span>}
                      {moq > 1 && <span className="pd-card__meta-item">MOQ: {moq}</span>}
                      {product.stock != null && (
                        <span className={`pd-card__stock ${inStock ? 'pd-card__stock--in' : 'pd-card__stock--out'}`}>
                          {inStock ? `${product.stock} in stock` : 'Out of stock'}
                        </span>
                      )}
                    </div>

                    {product.location && (
                      <div className="pd-card__location">
                        <MapPin size={13} /> {product.location}
                      </div>
                    )}

                    {product.barcode && (
                      <span className="pd-card__barcode">Barcode: {product.barcode}</span>
                    )}
                  </div>
                </div>

                <div className="pd-card__footer">
                  <div className="pd-card__suppliers">
                    {canViewDetails ? (
                      <span className="pd-card__view-hint">View details</span>
                    ) : null}
                    {Number.isFinite(Number(product?.supplierCount)) && (
                      <>
                        <Users size={14} />
                        <span>{Number(product.supplierCount)} supplier{Number(product.supplierCount) === 1 ? '' : 's'}</span>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    className="pd-card__cart-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      openProjectPicker(product);
                    }}
                    disabled={!hasEligibleSupplier || !inStock}
                    title={
                      !hasEligibleSupplier
                        ? 'No eligible supplier is currently listing this product'
                        : !inStock
                          ? 'Product is out of stock'
                          : undefined
                    }
                  >
                    {cartAddedByProductId[pid] ? (
                      <><Check size={16} /> Added</>
                    ) : !hasEligibleSupplier ? (
                      <>No suppliers</>
                    ) : !inStock ? (
                      <>Out of stock</>
                    ) : (
                      <><ShoppingCart size={16} /> Add to Cart</>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      <DiscoveryAddToCartDialog
        open={projectPickerOpen}
        onOpenChange={(open) => {
          setProjectPickerOpen(open);
          if (!open) setPendingProduct(null);
        }}
        product={pendingProduct}
        onAdded={handleCartAdded}
      />
    </SpPageLayout>
  );
};

export default ProductDiscovery;
