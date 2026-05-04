import React, { useEffect, useMemo, useState } from 'react';
import { Search, Package } from 'lucide-react';
import { getApiUrl } from '../config/api';
import './ProductDiscovery.css';

const ProductDiscovery = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
        params.set('limit', '30');

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
      } catch (fetchError) {
        setProducts([]);
        setError(fetchError.message || 'Failed to fetch products');
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, selectedCategory]);

  return (
    <div className="product-discovery-container">
      <div className="product-discovery-header">
        <h1>Product Discovery</h1>
        <p>Search approved catalog products by name, brand, or description.</p>
      </div>

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
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default ProductDiscovery;
