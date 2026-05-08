import React, { useEffect, useMemo, useState } from 'react';
import { Check, Package, Search, ShoppingCart } from 'lucide-react';
import { getApiUrl } from '../config/api';
import VoiceOrderPanel from '../components/VoiceOrderPanel';
import './ProductDiscovery.css';

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
  const voicePageContext = useMemo(
    () => ({
      page: 'product_discovery',
      searchQuery: searchQuery.trim(),
      selectedCategory: selectedCategory.trim(),
      currentPage: safePage,
      pageSize,
      total: Number.isFinite(total) ? total : 0,
      pageCount,
      recommendationMode,
      visibleProducts: products.map((product) => ({
        id: product?.id ? String(product.id) : '',
        name: String(product?.name || ''),
        brand: String(product?.brand || ''),
        category: String(product?.category || ''),
        unit: String(product?.unit || ''),
        supplierCount: Number(product?.supplierCount || 0) || 0,
        barcode: String(product?.barcode || ''),
        description: String(product?.description || '')
      }))
    }),
    [searchQuery, selectedCategory, safePage, pageSize, total, pageCount, recommendationMode, products]
  );

  const addToCart = async (product) => {
    const token = localStorage.getItem('token');
    if (!token) {
      setError('Please log in again to add items to cart.');
      return;
    }
    const productId = product?.id;
    if (!productId) {
      setError('This product cannot be added because its id is missing.');
      return;
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
    } catch (e) {
      setError(e.message || 'Failed to add to cart');
    } finally {
      setCartBusyByProductId((prev) => {
        const { [String(productId)]: _removed, ...rest } = prev;
        return rest;
      });
    }
  };

  return (
    <div className="product-discovery-container">
      <div className="product-discovery-header">
        <h1>Product Discovery</h1>
        <p>Browse products listed by suppliers. You can add items directly to cart without a BOQ.</p>
      </div>
      <VoiceOrderPanel pageContext={voicePageContext} />

      <div className="product-discovery-controls">
        <div className="search-input-wrapper">
          <Search size={18} />
          <input
            type="text"
            placeholder="Search products..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        <select
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

      {error ? <div className="product-discovery-error">{error}</div> : null}

      <div className="product-discovery-summary">
        <div>
          <strong>{Number.isFinite(total) ? total : 0}</strong> product{total === 1 ? '' : 's'} listed by suppliers
          {recommendationMode ? (
            <span className="recommendation-pill">Recommended by your past orders</span>
          ) : null}
        </div>
        <div className="product-discovery-pager">
          <button
            type="button"
            className="btn-secondary"
            disabled={loading || safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </button>
          <span>
            Page <strong>{safePage}</strong> / {pageCount}
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={loading || safePage >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {loading ? (
        <div className="product-discovery-state">Loading products...</div>
      ) : products.length === 0 ? (
        <div className="product-discovery-state">
          <Package size={22} />
          <span>No products found. Try a different search.</span>
        </div>
      ) : (
        <div className="product-discovery-grid">
          {products.map((product) => (
            <article className="product-card" key={product.id || `${product.name}-${product.category}`}>
              <h3>{product.name || 'Unnamed Product'}</h3>
              <p className="product-card-meta">
                {product.brand ? `${product.brand} | ` : ''}
                {product.category || 'uncategorized'}
              </p>
              <p className="product-card-description">{product.description || 'No description available.'}</p>
              <div className="product-card-footer">
                <span>Unit: {product.unit || 'N/A'}</span>
                {product.barcode ? <span>Barcode: {product.barcode}</span> : null}
              </div>
              <div className="product-card-actions">
                <div className="product-card-actions__meta">
                  {Number.isFinite(Number(product?.supplierCount)) ? (
                    <span>{Number(product.supplierCount)} supplier{Number(product.supplierCount) === 1 ? '' : 's'}</span>
                  ) : (
                    <span />
                  )}
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => addToCart(product)}
                  disabled={Boolean(cartBusyByProductId[String(product?.id || '')])}
                >
                  {cartAddedByProductId[String(product?.id || '')] ? (
                    <>
                      <Check size={16} /> Added as new BOQ
                    </>
                  ) : (
                    <>
                      <ShoppingCart size={16} /> Add to cart
                    </>
                  )}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductDiscovery;
