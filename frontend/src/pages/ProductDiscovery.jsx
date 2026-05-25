import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, ImageOff, MapPin, Package, Search, ShoppingCart, Star, Tag, Users } from 'lucide-react';
import { getApiUrl } from '../config/api';
import ProductImageCarousel from '../components/ProductImageCarousel';
import VoiceGuidedBanner from '../components/VoiceGuidedBanner';
import './ProductDiscovery.css';

function formatPrice(price) {
  const num = Number(price);
  if (!Number.isFinite(num) || num <= 0) return null;
  return `₹${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
  if (!specifications || typeof specifications !== 'object') return null;
  const entries = Object.entries(specifications).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim()
  );
  if (!entries.length) return null;
  return (
    <div className="pd-specs">
      {entries.slice(0, 4).map(([key, val]) => (
        <span key={key} className="pd-spec-badge">
          <strong>{key}:</strong> {String(val)}
        </span>
      ))}
      {entries.length > 4 && <span className="pd-spec-badge pd-spec-more">+{entries.length - 4} more</span>}
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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recommendationMode, setRecommendationMode] = useState('');
  const [cartBusyByProductId, setCartBusyByProductId] = useState({});
  const [cartAddedByProductId, setCartAddedByProductId] = useState({});
  const pageSize = 24;

  const categories = useMemo(() => {
    const unique = new Set();
    products.forEach((product) => {
      const category = String(product?.category || '').trim();
      if (category) unique.add(category);
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [products]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in again to discover products.');
      return undefined;
    }

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
          }
        });
        const data = await response.json();
        if (!response.ok || data.status !== 'success') {
          throw new Error(data.message || 'Failed to fetch products');
        }
        setProducts(Array.isArray(data.suggestions) ? data.suggestions : []);
        setTotal(Number.isFinite(Number(data.total)) ? Number(data.total) : 0);
        setRecommendationMode(String(data.recommendationMode || ''));
      } catch (fetchError) {
        setProducts([]);
        setTotal(0);
        setRecommendationMode('');
        setError(fetchError.message || 'Failed to fetch products');
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, selectedCategory, page]);

  useEffect(() => {
    setPage(1);
  }, [searchQuery, selectedCategory]);

  const pageCount = useMemo(() => {
    if (!total || total < 1) return 1;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [total]);

  const safePage = Math.min(Math.max(page, 1), pageCount);

  const addToCart = async (product) => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in again to add items to cart.');
      return false;
    }
    const productId = product?.id;
    if (!productId) {
      setError('This product cannot be added because its id is missing.');
      return false;
    }

    setCartBusyByProductId((prev) => ({ ...prev, [String(productId)]: true }));
    setError('');
    try {
      const saveRes = await fetch(getApiUrl('/api/po/cart/discovery-item'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          productId: String(productId),
          quantity: 1
        })
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok || saveData.status !== 'success') {
        throw new Error(saveData.message || 'Failed to save cart');
      }
      setCartAddedByProductId((prev) => ({ ...prev, [String(productId)]: true }));
      setTimeout(() => {
        setCartAddedByProductId((prev) => {
          const { [String(productId)]: _removed, ...rest } = prev;
          return rest;
        });
      }, 1400);
      return true;
    } catch (e) {
      setError(e.message || 'Failed to add to cart');
      return false;
    } finally {
      setCartBusyByProductId((prev) => {
        const { [String(productId)]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  const imageArray = (product) => {
    if (Array.isArray(product?.images) && product.images.length > 0) return product.images;
    return [];
  };

  return (
    <div className="product-discovery-container">
      <VoiceGuidedBanner />

      <div className="pd-hero">
        <h1 className="pd-hero__title">Discover Products</h1>
        <p className="pd-hero__subtitle">
          Browse the full catalog of construction materials from verified suppliers.
          Search, compare, and add items directly to your cart.
        </p>
      </div>

      <div className="pd-controls">
        <div className="pd-search">
          <Search size={18} className="pd-search__icon" />
          <input
            type="text"
            className="pd-search__input"
            placeholder="Search by name, brand, or description..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        <select
          className="pd-category-select"
          value={selectedCategory}
          onChange={(event) => setSelectedCategory(event.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      {error ? <div className="pd-error">{error}</div> : null}

      <div className="pd-toolbar">
        <div className="pd-toolbar__info">
          <strong>{Number.isFinite(total) ? total : 0}</strong> product{total === 1 ? '' : 's'} available
          {recommendationMode ? (
            <span className="pd-rec-pill">Personalized for you</span>
          ) : null}
        </div>
        <div className="pd-pager">
          <button
            type="button"
            className="pd-pager__btn"
            disabled={loading || safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft size={16} /> Prev
          </button>
          <span className="pd-pager__text">
            {safePage} / {pageCount}
          </span>
          <button
            type="button"
            className="pd-pager__btn"
            disabled={loading || safePage >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="pd-state pd-state--loading">
          <div className="pd-spinner" />
          <span>Loading products...</span>
        </div>
      ) : products.length === 0 ? (
        <div className="pd-state pd-state--empty">
          <Package size={32} />
          <span>No products found. Try a different search or category.</span>
        </div>
      ) : (
        <div className="pd-grid">
          {products.map((product) => {
            const imgs = imageArray(product);
            const price = formatPrice(product?.price);
            const pid = String(product?.id || '');
            const inStock = Number(product?.stock) > 0;
            const moq = Number(product?.min_order_quantity);

            return (
              <article className="pd-card" key={product.id || `${product.name}-${product.category}`}>
                <div className="pd-card__image">
                  {imgs.length > 0 ? (
                    <ProductImageCarousel images={imgs} alt={product.name} height={180} rounded={10} stopPropagation />
                  ) : (
                    <div className="pd-card__no-image">
                      <ImageOff size={36} />
                      <span>No image</span>
                    </div>
                  )}
                  {product.category && (
                    <span className="pd-card__category-badge">{product.category}</span>
                  )}
                </div>

                <div className="pd-card__body">
                  <div className="pd-card__header">
                    <h3 className="pd-card__name">{product.name || 'Unnamed Product'}</h3>
                    {product.brand && <span className="pd-card__brand">{product.brand}</span>}
                  </div>

                  <RatingStars rating={product.average_rating} reviews={product.total_reviews} />

                  <p className="pd-card__desc">
                    {product.description || 'No description available.'}
                  </p>

                  <SpecBadges specifications={product.specifications} />
                  <TagList tags={product.tags} />

                  <div className="pd-card__details">
                    {price && <span className="pd-card__price">{price}<small>/{product.unit || 'unit'}</small></span>}
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
                    onClick={() => addToCart(product)}
                    disabled={Boolean(cartBusyByProductId[pid])}
                  >
                    {cartAddedByProductId[pid] ? (
                      <><Check size={16} /> Added</>
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
    </div>
  );
};

export default ProductDiscovery;
