import React, { useState, useEffect, useRef } from 'react';
import { getApiUrl } from '../config/api';
import { 
  Package, 
  Plus, 
  Edit, 
  Search, 
  Eye,
  Save,
  X,
  Trash2,
  Clock,
  CheckCircle,
  Ban,
  Sparkles,
  Upload,
  Image as ImageIcon,
  Loader,
  ChevronDown,
  Wallet
} from 'lucide-react';
import './Dashboard.css';
import SupplierProductAdditionSteps from '../components/SupplierProductAdditionSteps';
import ProductImageCarousel from '../components/ProductImageCarousel';
import {
  mergeSpecificationObjects,
  parseSpecInputToValue,
  specValueToInput,
  specificationEntriesForDetails
} from '../utils/specifications';
import {
  applyExtractResultToSpecs,
  extractSpecificationsFromDescription
} from '../utils/extractSpecificationsApi';
import {
  SUPPLIER_CURRENT_STOCK_LABEL,
  SUPPLIER_MRP_FIELD_LABEL,
  SUPPLIER_MRP_LABEL
} from '../utils/supplierStockLabel';
import { formatRupee, formatRupeePerUnit } from '../utils/formatRupee';
import RupeeInput from '../components/RupeeInput';
import BrandSelect from '../components/BrandSelect';
import {
  getSupplierOfferRowId,
  matchSupplierOfferRow,
  normalizeSupplierProductsFromApi
} from '../utils/supplierProductRow';
import { parseSupplierStockQuantity } from '../utils/parseSupplierStockQuantity';

import { useLocation, useNavigate } from 'react-router-dom';

const IGST_OPTIONS = ['0', '5', '12', '18', '28'];
const CGST_SGST_OPTIONS = ['0', '2.5', '6', '9', '14'];

const ProductManagement = ({ user }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isInventoryView = location.pathname === '/manage-inventory';
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [viewingItem, setViewingItem] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [categories, setCategories] = useState([]);
  /** Row keys (product ids) expanded to show TSIN, location, etc. */
  const [expandedProductRowKeys, setExpandedProductRowKeys] = useState(() => new Set());

  const toggleProductRowExpanded = (e, rowKey) => {
    e.stopPropagation();
    setExpandedProductRowKeys((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  useEffect(() => {
    fetchProducts();
    fetchNotifications();
    
    // Removed automatic polling - products will only be fetched on initial load
    // Users can manually refresh if needed
  }, []);

  // Fetch categories on initial load only
  useEffect(() => {
    fetchCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Removed automatic refresh on notifications - this was causing unwanted refreshes
  // Products will only refresh when user performs actions (add, update, delete)

  const fetchNotifications = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/notifications'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setNotifications(data.notifications || []);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  };

  const fetchCategories = async () => {
    try {
      const token = localStorage.getItem('token');
      // Fetch categories from the Category collection
      const response = await fetch(getApiUrl('/api/supplier/categories'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      let categoryList = [];
      
      if (data.status === 'success') {
        categoryList = data.categories || [];
      }
      
      // Also get unique categories from existing products
      const uniqueProductCategories = [...new Set(products
        .map(p => p.category)
        .filter(cat => cat && cat.trim() !== '')
        .map(cat => cat.toLowerCase().trim())
      )];
      
      // Merge categories from Category collection with product categories
      const categoryMap = new Map();
      
      // Add categories from Category collection first (they have displayName)
      categoryList.forEach(cat => {
        const key = cat.name.toLowerCase().trim();
        categoryMap.set(key, {
          name: cat.name,
          displayName: cat.displayName || cat.name
        });
      });
      
      // Add product categories that aren't in the Category collection
      uniqueProductCategories.forEach(catName => {
        if (!categoryMap.has(catName)) {
          categoryMap.set(catName, {
            name: catName,
            displayName: catName.charAt(0).toUpperCase() + catName.slice(1)
          });
        }
      });
      
      // Convert map to array and sort
      const allCategories = Array.from(categoryMap.values()).sort((a, b) => 
        (a.displayName || a.name).localeCompare(b.displayName || b.name)
      );
      
      setCategories(allCategories);
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/products'), {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        cache: 'no-cache' // Prevent caching
      });
      const data = await response.json();
      if (data.status === 'success') {
        // Ensure all products have a status field (default to 'pending' if missing)
        const productsWithStatus = normalizeSupplierProductsFromApi(data.products || []).map(
          (product) => ({
            ...product,
            status: product.status || 'pending'
          })
        );
        setProducts(productsWithStatus);
      }
    } catch (error) {
      console.error('Failed to fetch products:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddProduct = async (productData) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/products'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(productData)
      });
      const data = await response.json();
      if (data.status === 'success') {
        setProducts([...products, data.product]);
        setShowAddModal(false);
        fetchProducts();
        const nextBrand = String(data?.nextStep?.brand || data?.product?.brand || productData?.brand || '').trim();
        const nextProductName = String(data?.nextStep?.productName || data?.product?.name || productData?.name || '').trim();
        const params = new URLSearchParams();
        if (nextBrand) params.set('brand', nextBrand);
        if (nextProductName) params.set('productName', nextProductName);
        params.set('from', 'product-management');
        alert(
          `${data.message || 'Product added successfully!'} Next: complete inventory details (step 2), then ProductCOV (step 3).`
        );
        navigate(`/manage-inventory?${params.toString()}`);
      } else {
        alert(data.message || 'Failed to add product');
      }
    } catch (error) {
      console.error('Failed to add product:', error);
      alert('Failed to add product. Please try again.');
    }
  };

  const handleSaveSpecifications = async (product, specificationValues) => {
    const productId = getSupplierOfferRowId(product) || product?.id || product?._id;
    if (!productId) {
      alert('Unable to save: missing product id.');
      return { ok: false };
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/supplier/products/${productId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ specifications: specificationValues })
      });
      const data = await response.json();

      if (!response.ok || data.status !== 'success') {
        alert(data.message || 'Failed to save specifications');
        return { ok: false };
      }

      const updatedProduct = {
        ...product,
        ...(data.product || {}),
        specifications:
          data.product?.specifications ||
          mergeSpecificationObjects(product?.specifications || {}, specificationValues)
      };

      setProducts((prev) =>
        prev.map((p) =>
          matchSupplierOfferRow(p, productId)
            ? {
                ...p,
                ...updatedProduct,
                supplier_product_id: getSupplierOfferRowId(p) || getSupplierOfferRowId(updatedProduct) || productId
              }
            : p
        )
      );

      setViewingItem((prev) => {
        if (!prev) return prev;
        return matchSupplierOfferRow(prev, productId)
          ? {
              ...prev,
              ...updatedProduct,
              supplier_product_id: getSupplierOfferRowId(prev) || getSupplierOfferRowId(updatedProduct) || productId
            }
          : prev;
      });

      if (String(updatedProduct.status || '').toLowerCase() === 'pending') {
        alert(
          data.message ||
            'Specifications saved. This product is pending admin review again because specifications changed.'
        );
      }

      return { ok: true, product: updatedProduct };
    } catch (error) {
      console.error('Failed to save specifications:', error);
      alert('Failed to save specifications. Please try again.');
      return { ok: false };
    }
  };

  const buildInventoryUpdatePayload = (item, data) => {
    const stock = parseSupplierStockQuantity(data.stock);
    if (stock === null) return null;
    const priceRaw = data.price;
    const price =
      priceRaw !== '' && priceRaw !== undefined && priceRaw !== null
        ? parseFloat(priceRaw)
        : undefined;
    const payload = {
      stock,
      location: data.location,
      unit: data.unit,
      igst_rate: data.igst_rate,
      cgst_rate: data.cgst_rate,
      sgst_rate: data.sgst_rate,
      hsnCode: data.hsnCode || data.hsn_code,
      brandModel: item?.brandModel || item?.attributes?.brandModel,
      mpn: item?.mpn,
      gtin: item?.gtin
    };
    if (price !== undefined && Number.isFinite(price)) {
      payload.price = price;
    }
    return payload;
  };

  const handleUpdateProduct = async (productId, productData, options = {}) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/supplier/products/${productId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(productData)
      });
      const data = await response.json();
      if (response.ok && data.status === 'success') {
        const savedStock =
          options.expectedStock ??
          parseSupplierStockQuantity(productData.stock) ??
          parseSupplierStockQuantity(data.product?.stock);
        const updatedProduct = {
          ...data.product,
          specifications: data.product.specifications || {},
          ...(savedStock != null ? { stock: savedStock } : {})
        };

        setProducts((prev) =>
          prev.map((p) =>
            matchSupplierOfferRow(p, productId)
              ? {
                  ...p,
                  ...updatedProduct,
                  supplier_product_id:
                    getSupplierOfferRowId(p) ||
                    getSupplierOfferRowId(updatedProduct) ||
                    productId,
                  stock: savedStock != null ? savedStock : p.stock,
                  price:
                    updatedProduct.price !== undefined ? updatedProduct.price : p.price
                }
              : p
          )
        );

        if (isInventoryView && savedStock != null) {
          void fetchProducts();
        }

        setEditingItem(null);

        // After inventory (step 2), go straight to ProductCOV (step 3)
        if (
          isInventoryView &&
          data.message !== 'No changes detected'
        ) {
          const nextBrand = String(
            data?.nextStep?.brand ||
              updatedProduct?.brandModel ||
              updatedProduct?.brand ||
              updatedProduct?.specifications?.brandModel ||
              updatedProduct?.specifications?.brand ||
              ''
          ).trim();
          const nextProductName = String(
            data?.nextStep?.productName || updatedProduct?.name || ''
          ).trim();
          const params = new URLSearchParams();
          if (data?.nextStep?.variantAsin) params.set('variantAsin', data.nextStep.variantAsin);
          if (data?.nextStep?.variantKey) params.set('variantKey', data.nextStep.variantKey);
          if (data?.nextStep?.supplierProductId) params.set('supplierProductId', data.nextStep.supplierProductId);
          if (nextProductName) params.set('variantName', nextProductName);
          if (nextBrand) params.set('brand', nextBrand);
          if (nextProductName) params.set('productName', nextProductName);
          params.set('from', 'manage-inventory');
          navigate(`/supplier-bcov?${params.toString()}`);
        } else if (data.message === 'No changes detected') {
          alert(data.message);
        } else {
          alert('Product updated successfully!');
        }

        // Don't call fetchProducts() here as it might load stale data
        // The local state update above is sufficient
      } else {
        // Show specific error message from backend
        const errorMessage = data.message || (data.errors && data.errors.length > 0 ? data.errors[0] : 'Failed to update product');
        alert(errorMessage);
      }
    } catch (error) {
      console.error('Failed to update product:', error);
      alert('Failed to update product. Please try again.');
    }
  };

  const handleDeleteProduct = async (supplierProductId) => {
    // Show confirmation dialog
    const product = products.find((p) => matchSupplierOfferRow(p, supplierProductId));
    const productName = product?.name || 'this product';
    
    if (!window.confirm(`Are you sure you want to delete "${productName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/supplier/products/${supplierProductId}`), {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await response.json();
      if (data.status === 'success') {
        // Remove the product from the list
        setProducts((prev) => prev.filter((p) => !matchSupplierOfferRow(p, supplierProductId)));
        alert('Product deleted successfully');
      } else {
        alert(data.message || 'Failed to delete product');
      }
    } catch (error) {
      console.error('Failed to delete product:', error);
      alert('Failed to delete product. Please try again.');
    }
  };

  const filteredProducts = products.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
    // Normalize category comparison (both should be lowercase for matching)
    const productCategory = (product.category || '').toLowerCase();
    const filterCategoryLower = filterCategory === 'all' ? 'all' : filterCategory.toLowerCase();
    const matchesCategory = filterCategoryLower === 'all' || productCategory === filterCategoryLower;
    const matchesStatus = filterStatus === 'all' || (product.status || 'pending') === filterStatus;
    return matchesSearch && matchesCategory && matchesStatus;
  });

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading products...</p>
      </div>
    );
  }

  return (
    <div className="dashboard-container" style={{ maxWidth: '100%', padding: '2rem' }}>
      <div className="dashboard-header">
        <div>
          <h1>{isInventoryView ? 'Manage Inventory' : 'Manage Products'}</h1>
          <p>
            {user?.name && (
              <span style={{ fontWeight: '600', color: '#4f46e5' }}>{user.name}</span>
            )}
            {user?.name && ' - '}
            {isInventoryView 
              ? `Update ${SUPPLIER_CURRENT_STOCK_LABEL.toLowerCase()}, ${SUPPLIER_MRP_LABEL}, and location for your existing products`
              : 'Add new products to your catalog (saved products are read-only here)'}
          </p>
          <div style={{ 
            display: 'flex', 
            gap: '1rem', 
            marginTop: '0.75rem',
            flexWrap: 'wrap'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: '#fef3c7',
              borderRadius: '8px',
              border: '1px solid #fbbf24',
              fontSize: '0.875rem',
              fontWeight: '600',
              color: '#92400e'
            }}>
              <Clock size={16} />
              <span>Pending: {products.filter(p => (p.status || 'pending') === 'pending').length}</span>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: '#d1fae5',
              borderRadius: '8px',
              border: '1px solid #10b981',
              fontSize: '0.875rem',
              fontWeight: '600',
              color: '#065f46'
            }}>
              <CheckCircle size={16} />
              <span>Approved: {products.filter(p => p.status === 'approved').length}</span>
            </div>
            {products.filter(p => p.status === 'rejected').length > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 1rem',
                background: '#fee2e2',
                borderRadius: '8px',
                border: '1px solid #ef4444',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: '#991b1b'
              }}>
                <Ban size={16} />
                <span>Rejected: {products.filter(p => p.status === 'rejected').length}</span>
              </div>
            )}
          </div>
        </div>
        {!isInventoryView && (
          <button 
            className="btn-primary"
            onClick={() => setShowAddModal(true)}
          >
            <Plus size={18} />
            Add Product
          </button>
        )}
      </div>

      <SupplierProductAdditionSteps
        variant={isInventoryView ? 'inventory' : 'add-product'}
        hint={
          isInventoryView
            ? `You are on step 2. After ${SUPPLIER_MRP_LABEL} and ${SUPPLIER_CURRENT_STOCK_LABEL.toLowerCase()} are set, open ProductCOV (step 3) to finish so this product can be priced correctly on orders.`
            : 'You are on step 1. Add catalog details here, then use Manage Inventory for step 2, then ProductCOV for step 3.'
        }
      />

      <div className="dashboard-content" style={{ gridTemplateColumns: '1fr', width: '100%' }}>
        <div className="dashboard-section" style={{ width: '100%' }}>
          <div className="section-header">
            <h2>All Products</h2>
            <div className="section-controls">
              <div className="search-box">
                <Search size={16} />
                <input
                  type="text"
                  placeholder="Search products..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <select 
                value={filterCategory} 
                onChange={(e) => setFilterCategory(e.target.value)}
              >
                <option value="all">All Categories</option>
                {categories.map((cat) => (
                  <option key={cat.name} value={cat.name}>
                    {cat.displayName || cat.name}
                  </option>
                ))}
              </select>
              <select 
                value={filterStatus} 
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{ marginLeft: '0.5rem' }}
              >
                <option value="all">All Status</option>
                <option value="pending">Pending Approval</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>
          
          <div
            className="products-list products-list--compact"
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              gap: '0.4rem'
            }}
          >
            {filteredProducts.length > 0 ? (
              filteredProducts.map((product, productIndex) => {
                const rowKey = String(
                  product.supplier_product_id ||
                    product.supplierProductId ||
                    product.id ||
                    product._id ||
                    `row-${productIndex}`
                );
                const isRowExpanded = expandedProductRowKeys.has(rowKey);
                const hasExpandableDetails =
                  Boolean(product.asin || product.variantAsin || product.variant_asin || product.location);
                const productStatus = product.status || 'pending';
                const statusConfig = {
                  pending: {
                    label: 'Pending Approval',
                    icon: Clock,
                    color: '#d97706',
                    bgColor: '#fef3c7',
                    borderColor: '#fbbf24'
                  },
                  approved: {
                    label: 'Approved',
                    icon: CheckCircle,
                    color: '#059669',
                    bgColor: '#d1fae5',
                    borderColor: '#10b981'
                  },
                  rejected: {
                    label: 'Rejected',
                    icon: Ban,
                    color: '#dc2626',
                    bgColor: '#fee2e2',
                    borderColor: '#ef4444'
                  }
                };
                const status = statusConfig[productStatus] || statusConfig.pending;
                const StatusIcon = status.icon;
                
                return (
                <div
                  key={rowKey}
                  className="product-card product-card--list-row"
                  style={{
                    border: productStatus === 'pending' ? `2px solid ${status.borderColor}` : '1px solid #e5e7eb',
                    background: productStatus === 'pending' ? '#fffbeb' : 'white',
                    borderRadius: '8px',
                    padding: '0.45rem 0.55rem',
                    cursor: 'pointer',
                    maxWidth: '100%'
                  }}
                  onClick={() => setViewingItem(product)}
                  title="Click to view product details"
                >
                  <div
                    className="product-info"
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '0.5rem',
                      flexWrap: 'wrap'
                    }}
                  >
                    <button
                      type="button"
                      className="product-row-chevron"
                      aria-expanded={isRowExpanded}
                      aria-label={isRowExpanded ? 'Hide product details' : 'Show product details'}
                      disabled={!hasExpandableDetails}
                      onClick={(e) => hasExpandableDetails && toggleProductRowExpanded(e, rowKey)}
                      style={{
                        flexShrink: 0,
                        width: '28px',
                        height: '44px',
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        cursor: hasExpandableDetails ? 'pointer' : 'default',
                        color: hasExpandableDetails ? '#64748b' : '#cbd5e1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        alignSelf: 'flex-start',
                        borderRadius: '6px'
                      }}
                      title={
                        hasExpandableDetails
                          ? isRowExpanded
                            ? 'Hide TSIN, location, and more'
                            : 'Show TSIN, location, and more'
                          : 'No extra details'
                      }
                    >
                      <ChevronDown
                        size={18}
                        strokeWidth={2.25}
                        style={{
                          transition: 'transform 0.2s ease',
                          transform: isRowExpanded ? 'rotate(0deg)' : 'rotate(-90deg)'
                        }}
                      />
                    </button>
                    {Array.isArray(product.images) && product.images[0] ? (
                      <div style={{ width: '44px', flexShrink: 0, alignSelf: 'flex-start' }}>
                        <ProductImageCarousel
                          images={product.images}
                          alt={product.name || 'Product'}
                          height={44}
                          rounded={6}
                        />
                      </div>
                    ) : (
                      <div
                        style={{
                          width: '44px',
                          height: '44px',
                          flexShrink: 0,
                          borderRadius: '6px',
                          background: '#f1f5f9',
                          border: '1px solid #e2e8f0'
                        }}
                        aria-hidden
                      />
                    )}

                    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          flexWrap: 'wrap',
                          marginBottom: '0.12rem'
                        }}
                      >
                        {user?.name ? (
                          <div
                            style={{
                              fontSize: '0.65rem',
                              color: '#64748b',
                              textTransform: 'uppercase',
                              fontWeight: '700',
                              letterSpacing: '0.4px'
                            }}
                          >
                            Supplier: <span style={{ color: '#0f172a' }}>{user.name}</span>
                          </div>
                        ) : null}
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.2rem',
                            padding: '0.12rem 0.45rem',
                            borderRadius: '999px',
                            fontSize: '0.62rem',
                            fontWeight: '700',
                            background: status.bgColor,
                            color: status.color,
                            border: `1px solid ${status.borderColor}`
                          }}
                        >
                          <StatusIcon size={11} />
                          {status.label}
                        </span>
                      </div>

                      <h4
                        style={{
                          fontSize: '0.88rem',
                          fontWeight: '700',
                          color: '#1e293b',
                          margin: '0 0 0.08rem',
                          lineHeight: '1.25',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {product.name}
                      </h4>
                      <p
                        className="product-category"
                        style={{
                          margin: '0 0 0.12rem',
                          fontSize: '0.65rem',
                          lineHeight: 1.2
                        }}
                      >
                        {product.category}
                      </p>

                      {hasExpandableDetails && !isRowExpanded ? (
                        <div style={{ fontSize: '0.6rem', color: '#94a3b8', marginTop: '0.05rem' }}>
                          TSIN, location & more — tap arrow
                        </div>
                      ) : null}
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        flexShrink: 0,
                        gap: '0.08rem',
                        minWidth: '4.5rem'
                      }}
                    >
                      <span style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 600 }}>{SUPPLIER_MRP_LABEL}</span>
                      <span style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 700, textAlign: 'right' }}>
                        {formatRupeePerUnit(product.price, product.unit)}
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-end',
                        flexShrink: 0,
                        gap: '0.08rem',
                        minWidth: '5.75rem'
                      }}
                    >
                      <span
                        style={{
                          fontSize: '0.55rem',
                          color: '#64748b',
                          fontWeight: 600,
                          textAlign: 'right',
                          lineHeight: 1.15,
                          maxWidth: '5.75rem'
                        }}
                      >
                        {SUPPLIER_CURRENT_STOCK_LABEL}
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 700, textAlign: 'right' }}>
                        {product.stock} {product.unit}
                      </span>
                    </div>

                    {product.lsa ? (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'flex-end',
                          flexShrink: 0,
                          gap: '0.08rem',
                          minWidth: '2.5rem'
                        }}
                      >
                        <span style={{ fontSize: '0.6rem', color: '#64748b', fontWeight: 600 }}>LSA</span>
                        <span style={{ fontSize: '0.78rem', color: '#334155', fontWeight: 700 }}>{product.lsa}</span>
                      </div>
                    ) : null}

                    <div
                      className="product-actions"
                      style={{ display: 'flex', alignItems: 'center', gap: '0.15rem', flexShrink: 0 }}
                    >
                      {product.variantKey && (
                        <button
                          className="btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            const params = new URLSearchParams();
                            params.set('variantKey', product.variantKey);
                            if (product.variantAsin || product.variant_asin) {
                              params.set('variantAsin', product.variantAsin || product.variant_asin);
                            }
                            if (product.name) params.set('variantName', product.name);
                            if (product.brand) params.set('brand', product.brand);
                            navigate(`/supplier-bcov?${params.toString()}`);
                          }}
                          style={{
                            padding: '0.3rem',
                            borderRadius: '6px',
                            transition: 'all 0.2s ease',
                            color: '#8b5cf6'
                          }}
                          title="Set ProductCOV pricing levels for this variant"
                        >
                          <Wallet size={14} />
                        </button>
                      )}
                      {isInventoryView && (
                        <button
                          className="btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingItem(product);
                          }}
                          style={{
                            padding: '0.3rem',
                            borderRadius: '6px',
                            transition: 'all 0.2s ease',
                            color: '#3b82f6'
                          }}
                          title={`Edit inventory (${SUPPLIER_CURRENT_STOCK_LABEL.toLowerCase()}, ${SUPPLIER_MRP_LABEL}, location)`}
                        >
                          <Edit size={14} />
                        </button>
                      )}
                      {isInventoryView && (
                        <button
                          className="btn-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteProduct(
                              getSupplierOfferRowId(product) || product.id || product._id
                            );
                          }}
                          style={{
                            padding: '0.3rem',
                            borderRadius: '6px',
                            transition: 'all 0.2s ease',
                            color: '#ef4444'
                          }}
                          title="Delete product"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>

                  {isRowExpanded && hasExpandableDetails ? (
                    <div
                      className="product-row-expanded"
                      style={{
                        marginTop: '0.45rem',
                        paddingTop: '0.45rem',
                        borderTop: '1px solid #f1f5f9',
                        paddingLeft: '0.15rem'
                      }}
                    >
                      {(product.asin || product.variantAsin || product.variant_asin) && (
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '0.35rem 0.65rem',
                            fontSize: '0.68rem',
                            lineHeight: 1.45,
                            marginBottom: product.location ? '0.35rem' : 0
                          }}
                        >
                          {product.asin && (
                            <span style={{ color: '#475569' }}>
                              <strong style={{ fontWeight: 700 }}>TSIN:</strong>{' '}
                              <span
                                style={{
                                  color: '#0f172a',
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
                                }}
                              >
                                {product.asin}
                              </span>
                            </span>
                          )}
                          {(product.variantAsin || product.variant_asin) && (
                            <span style={{ color: '#475569' }}>
                              <strong style={{ fontWeight: 700 }}>Variant TSIN:</strong>{' '}
                              <span
                                style={{
                                  color: '#0f172a',
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
                                }}
                              >
                                {product.variantAsin || product.variant_asin}
                              </span>
                            </span>
                          )}
                        </div>
                      )}

                      {product.location && (
                        <div
                          style={{
                            fontSize: '0.68rem',
                            color: '#64748b',
                            lineHeight: 1.45,
                            wordBreak: 'break-word'
                          }}
                        >
                          📍 {product.location}
                        </div>
                      )}
                    </div>
                  ) : null}

                  {productStatus === 'pending' && (
                    <div
                      style={{
                        padding: '0.35rem 0.5rem',
                        marginTop: '0.35rem',
                        borderRadius: '6px',
                        background: '#fef3c7',
                        border: '1px solid #fbbf24',
                        fontSize: '0.68rem',
                        color: '#92400e',
                        lineHeight: 1.35
                      }}
                    >
                      Awaiting Admin Approval: This product becomes visible to service providers after approval.
                    </div>
                  )}

                  {productStatus === 'rejected' && product.rejectionReason && (
                    <div
                      style={{
                        padding: '0.35rem 0.5rem',
                        marginTop: '0.35rem',
                        borderRadius: '6px',
                        background: '#fee2e2',
                        border: '1px solid #ef4444',
                        fontSize: '0.68rem',
                        color: '#991b1b',
                        lineHeight: 1.35
                      }}
                    >
                      <strong>Rejected:</strong> {product.rejectionReason}
                    </div>
                  )}
                </div>
                );
              })
            ) : (
              <div className="empty-state">
                <Package size={48} />
                <h3>No products found</h3>
                <p>
                  {isInventoryView 
                    ? 'No products available to manage inventory. Add products first in Manage Products.'
                    : 'Add products to your catalog to start receiving orders'}
                </p>
                {!isInventoryView && (
                  <button 
                    className="btn-primary"
                    onClick={() => setShowAddModal(true)}
                  >
                    Add Product
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add Product Modal - only from Manage Products.
          We collect product identity fields here (product name, brand/model,
          location code, serial number). Price/stock are managed separately in
          the Manage Inventory view. */}
      {showAddModal && (
        <ProductModal
          showInventoryFields={false}
          showAdditionSteps
          onClose={() => setShowAddModal(false)}
          onSave={handleAddProduct}
        />
      )}

      {/* Edit Product Modal */}
      {isInventoryView && editingItem && (
        <ProductModal
          product={editingItem}
          showInventoryFields={isInventoryView}
          onClose={() => setEditingItem(null)}
          onSave={(data) => {
            const productId = getSupplierOfferRowId(editingItem);
            if (!productId) {
              alert(
                'Cannot save inventory: missing variant offer id. Refresh Manage Inventory and try again.'
              );
              return;
            }
            const payload = buildInventoryUpdatePayload(editingItem, data);
            if (!payload) {
              alert('Enter a valid whole-number stock quantity (0 or greater).');
              return;
            }
            handleUpdateProduct(productId, payload, { expectedStock: payload.stock });
          }}
        />
      )}

      {viewingItem && (
        <ProductDetailsModal
          product={viewingItem}
          supplierName={user?.name}
          canEditInventory={isInventoryView}
          onClose={() => setViewingItem(null)}
          onSaveSpecifications={handleSaveSpecifications}
          onEdit={
            isInventoryView
              ? (item) => {
                  setViewingItem(null);
                  setEditingItem(item);
                }
              : undefined
          }
        />
      )}
    </div>
  );
};

const ProductDetailsModal = ({
  product,
  supplierName,
  canEditInventory = false,
  onClose,
  onEdit,
  onSaveSpecifications
}) => {
  const detailsNavigate = useNavigate();
  const [displaySpecifications, setDisplaySpecifications] = useState(product?.specifications || {});
  const [isEditingSpecs, setIsEditingSpecs] = useState(false);
  const [draftSpecs, setDraftSpecs] = useState({});
  const [savingSpecs, setSavingSpecs] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(product?.description || '');
  const [extractingSpecs, setExtractingSpecs] = useState(false);
  const specsObject =
    product?.specifications && typeof product.specifications === 'object' && !Array.isArray(product.specifications)
      ? product.specifications
      : {};
  const gtinValue =
    String(
      product?.gtin ||
        product?.barcode ||
        specsObject?.gtin ||
        specsObject?.GTIN ||
        specsObject?.upc ||
        specsObject?.UPC ||
        specsObject?.ean ||
        specsObject?.EAN ||
        specsObject?.barcode ||
        specsObject?.Barcode ||
        ''
    ).trim();

  useEffect(() => {
    setDisplaySpecifications(product?.specifications || {});
    setIsEditingSpecs(false);
    setDraftSpecs({});
    setDescriptionDraft(product?.description || '');
  }, [product?.specifications, product?.description, product?.id]);

  useEffect(() => {
    const category = String(product?.category || '').trim().toLowerCase();
    const model = String(product?.name || '').trim();
    const brand = String(product?.brand || model || '').trim();
    if (!category) return;

    let cancelled = false;
    const loadAdminSpecifications = async () => {
      try {
        const token = localStorage.getItem('token');
        const params = new URLSearchParams();
        if (model) params.set('model', model);
        if (brand) params.set('brand', brand);
        const query = params.toString() ? `?${params.toString()}` : '';
        const response = await fetch(
          getApiUrl(`/api/supplier/categories/${encodeURIComponent(category)}/specifications${query}`),
          {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-cache'
          }
        );
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (data?.status !== 'success' || cancelled) return;
        const adminTemplate =
          data?.specifications && typeof data.specifications === 'object' ? data.specifications : {};
        setDisplaySpecifications(
          mergeSpecificationObjects(adminTemplate, product?.specifications || {})
        );
      } catch {
        // Keep product snapshot when template fetch fails.
      }
    };

    loadAdminSpecifications();
    return () => {
      cancelled = true;
    };
  }, [product?.id, product?.category, product?.name, product?.brand, product?.specifications]);

  const specEntries = specificationEntriesForDetails(displaySpecifications);

  const beginSpecificationEdit = () => {
    const draft = {};
    specEntries.forEach((entry) => {
      draft[entry.key] = specValueToInput(displaySpecifications[entry.key]);
    });
    setDraftSpecs(draft);
    setIsEditingSpecs(true);
  };

  const cancelSpecificationEdit = () => {
    setIsEditingSpecs(false);
    setDraftSpecs({});
  };

  const saveSpecificationEdits = async () => {
    if (!onSaveSpecifications) return;
    const nextSpecs = {};
    specEntries.forEach((entry) => {
      const original = displaySpecifications[entry.key];
      nextSpecs[entry.key] = parseSpecInputToValue(draftSpecs[entry.key], original);
    });

    setSavingSpecs(true);
    const result = await onSaveSpecifications(product, nextSpecs);
    setSavingSpecs(false);

    if (result?.ok) {
      const merged = mergeSpecificationObjects(
        displaySpecifications,
        result.product?.specifications || nextSpecs
      );
      setDisplaySpecifications(merged);
      setIsEditingSpecs(false);
      setDraftSpecs({});
    }
  };

  const handleExtractSpecificationsInDetails = async () => {
    const category = String(product?.category || '').trim();
    if (!descriptionDraft.trim()) {
      alert('Please enter a product description with specification details first.');
      return;
    }
    if (!category) {
      alert('Product category is required for AI extraction.');
      return;
    }

    setExtractingSpecs(true);
    try {
      const { response, data } = await extractSpecificationsFromDescription({
        description: descriptionDraft,
        category,
        productName: product?.name || '',
        existingSpecifications: displaySpecifications
      });

      if (!response.ok && data?.status !== 'success' && data?.status !== 'warning') {
        throw new Error(data?.message || `HTTP error! status: ${response.status}`);
      }

      const result = applyExtractResultToSpecs(displaySpecifications, data);
      if (!result.ok) {
        alert(`⚠️ ${result.warning || result.error}`);
        return;
      }
      if (result.categoryMismatchWarning) {
        alert(`⚠️ ${result.categoryMismatchWarning}`);
      }

      setDisplaySpecifications(result.merged);
      const nextDraft = {};
      Object.keys(result.merged).forEach((key) => {
        nextDraft[key] = specValueToInput(result.merged[key]);
      });
      setDraftSpecs(nextDraft);

      if (result.filledCount > 0) {
        alert(`Filled ${result.filledCount} specification field${result.filledCount > 1 ? 's' : ''} from description. Review and click Save.`);
      } else {
        alert('No values found in description. Use lines like "Finish: Matt" or "Sheen: Low".');
      }
    } catch (error) {
      alert(`Failed to extract specifications: ${error.message}`);
    } finally {
      setExtractingSpecs(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '780px', width: '92%', maxHeight: '86vh', overflowY: 'auto' }}
      >
        <div className="modal-header">
          <h2>Product Details</h2>
          <div className="modal-actions">
            {product?.variantKey && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  const params = new URLSearchParams();
                  params.set('variantKey', product.variantKey);
                  if (product.variantAsin || product.variant_asin) {
                    params.set('variantAsin', product.variantAsin || product.variant_asin);
                  }
                  if (product.name) params.set('variantName', product.name);
                  if (product.brand) params.set('brand', product.brand);
                  detailsNavigate(`/supplier-bcov?${params.toString()}`);
                }}
                style={{ color: '#8b5cf6', borderColor: '#8b5cf6' }}
              >
                ProductCOV
              </button>
            )}
            {canEditInventory ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => onEdit(product)}
              >
                <Edit size={16} />
                Edit Inventory
              </button>
            ) : null}
            <button type="button" className="btn-icon" onClick={onClose}>
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="modal-form">
          {Array.isArray(product.images) && product.images[0] ? (
            <div style={{ marginBottom: '1rem' }}>
              <ProductImageCarousel
                images={product.images}
                alt={product.name || 'Product'}
                height={220}
                rounded={10}
              />
            </div>
          ) : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
            <div><strong>Name:</strong> {product.name || 'N/A'}</div>
            <div><strong>Category:</strong> {product.category || 'N/A'}</div>
            <div><strong>Supplier:</strong> {supplierName || 'N/A'}</div>
            <div><strong>Status:</strong> {(product.status || 'pending').toUpperCase()}</div>
            <div>
              <strong>{SUPPLIER_MRP_LABEL}:</strong> {formatRupeePerUnit(product.price, product.unit)}
            </div>
            <div>
              <strong>{SUPPLIER_CURRENT_STOCK_LABEL}:</strong> {product.stock} {product.unit || 'unit'}
            </div>
            {gtinValue ? <div><strong>GTIN / UPC / EAN:</strong> {gtinValue}</div> : null}
            {product.lsa ? <div><strong>LSA:</strong> {product.lsa}</div> : null}
            {product.location ? <div><strong>Location:</strong> {product.location}</div> : null}
            {product.asin ? <div><strong>TSIN:</strong> {product.asin}</div> : null}
            {(product.variantAsin || product.variant_asin) ? (
              <div><strong>Variant TSIN:</strong> {product.variantAsin || product.variant_asin}</div>
            ) : null}
          </div>

          {product.description ? (
            <div style={{ marginTop: '1rem' }}>
              <h4 style={{ marginBottom: '0.35rem' }}>Description</h4>
              <p style={{ margin: 0, color: '#475569' }}>{product.description}</p>
            </div>
          ) : null}

          {specEntries.length > 0 ? (
            <div style={{ marginTop: '1rem' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '0.5rem',
                  flexWrap: 'wrap'
                }}
              >
                <h4 style={{ margin: 0 }}>Specifications</h4>
                {!isEditingSpecs && onSaveSpecifications ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={beginSpecificationEdit}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                  >
                    <Edit size={16} />
                    Edit values
                  </button>
                ) : null}
                {isEditingSpecs ? (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={cancelSpecificationEdit}
                      disabled={savingSpecs}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={saveSpecificationEdits}
                      disabled={savingSpecs}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <Save size={16} />
                      {savingSpecs ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                ) : null}
              </div>
              {isEditingSpecs ? (
                <div
                  style={{
                    marginBottom: '0.75rem',
                    padding: '0.75rem',
                    background: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    borderRadius: '8px'
                  }}
                >
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Description (for AI fill)
                  </label>
                  <textarea
                    value={descriptionDraft}
                    onChange={(e) => setDescriptionDraft(e.target.value)}
                    rows={3}
                    placeholder='e.g. Finish: Matt, Volume: 20L, Sheen: Low, Coverage: 140 sq ft/L'
                    style={{
                      width: '100%',
                      padding: '0.5rem 0.65rem',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      resize: 'vertical'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleExtractSpecificationsInDetails}
                      disabled={extractingSpecs || !descriptionDraft.trim()}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        background: extractingSpecs ? '#9ca3af' : '#10b981',
                        color: '#fff',
                        border: 'none'
                      }}
                    >
                      <Sparkles size={14} />
                      {extractingSpecs ? 'Extracting…' : 'Extract from description (AI)'}
                    </button>
                  </div>
                </div>
              ) : null}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.5rem' }}>
                {specEntries.map((entry) => (
                  <div key={entry.key} style={{ padding: '0.55rem 0.65rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#f8fafc' }}>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', textTransform: 'capitalize', marginBottom: '0.35rem' }}>
                      {entry.label}
                    </div>
                    {isEditingSpecs ? (
                      <input
                        type="text"
                        value={draftSpecs[entry.key] ?? ''}
                        onChange={(e) =>
                          setDraftSpecs((prev) => ({ ...prev, [entry.key]: e.target.value }))
                        }
                        placeholder={`Enter ${entry.label.toLowerCase()}`}
                        style={{
                          width: '100%',
                          padding: '0.45rem 0.6rem',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          fontSize: '0.9rem',
                          color: '#0f172a',
                          background: '#fff'
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          fontWeight: entry.hasValue ? 600 : 400,
                          color: entry.hasValue ? '#0f172a' : '#9ca3af',
                          fontSize: '0.9rem',
                          fontStyle: entry.hasValue ? 'normal' : 'italic'
                        }}
                      >
                        {entry.displayValue}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const ProductModal = ({ product, onClose, onSave, showInventoryFields = true, showAdditionSteps = false }) => {
  const [formData, setFormData] = useState({
    catalogProductId: product?.catalogProductId || product?.id || '',
    name: product?.name || '',
    brand: product?.brand || '',
    gtin: product?.gtin || '',
    hsnCode: product?.hsnCode || product?.hsn_code || '',
    lsa: product?.lsa || '',
    category: product?.category || '',
    price: product?.price || '',
    unit: product?.unit || '',
    stock: product?.stock != null && product?.stock !== '' ? String(product.stock) : '',
    igst_rate: product?.igst_rate != null ? String(product.igst_rate) : '',
    cgst_rate: product?.cgst_rate != null ? String(product.cgst_rate) : '',
    sgst_rate: product?.sgst_rate != null ? String(product.sgst_rate) : '',
    location: product?.location || '',
    description: product?.description || '',
    images: Array.isArray(product?.images) ? product.images : []
  });
  const [recommendedPrice, setRecommendedPrice] = useState(null);
  const [recommendedPriceStats, setRecommendedPriceStats] = useState(null);
  const [priceTouched, setPriceTouched] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState(null);
  const [hoveredSuggestionId, setHoveredSuggestionId] = useState(null);
  const suggestionsRef = useRef(null);
  const inputRef = useRef(null);
  
  // Product type selection state
  const [productType, setProductType] = useState(product ? null : 'existing_category');
  
  // Category and Unit states
  const [categories, setCategories] = useState([]);
  const [categorySuggestions, setCategorySuggestions] = useState([]);
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const categoryInputRef = useRef(null);
  const categorySuggestionsRef = useRef(null);
  
  const [units, setUnits] = useState([]);
  const [unitSuggestions, setUnitSuggestions] = useState([]);
  const [showUnitSuggestions, setShowUnitSuggestions] = useState(false);
  const unitInputRef = useRef(null);
  const unitSuggestionsRef = useRef(null);
  
  // Locations from supplier profile branches
  const [locations, setLocations] = useState([]);
  
  // Track previous category to detect actual changes
  const previousCategoryRef = useRef(null);
  const preserveSpecsOnNextCategoryLoadRef = useRef(false);
  const selectedSuggestionSpecsRef = useRef(null);
  
  // Extract Specifications state
  const [extracting, setExtracting] = useState(false); // For extracting specs from description
  const [loadingSpecs, setLoadingSpecs] = useState(false);
  const [aiProvider, setAiProvider] = useState('auto'); // 'auto', 'openai', 'gemini', 'claude' - for extract specs only
  // Initialize specifications: for existing products, use their specs; for new products, start empty
  const [specifications, setSpecifications] = useState(() => {
    if (product && product.specifications) {
      return product.specifications;
    }
    return {}; // Start with empty object for new products
  });
  const [isEditingSpecValues, setIsEditingSpecValues] = useState(false);

  const MIN_AI_PRODUCT_IMAGES = 3;
  const MAX_AI_PRODUCT_IMAGES = 8;

  // Multiple product photos for AI (minimum 3 required before analysis runs)
  const [productAiImages, setProductAiImages] = useState([]);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [uploadingProductImage, setUploadingProductImage] = useState(false);
  const productAiImagesRef = useRef([]);

  useEffect(() => {
    productAiImagesRef.current = productAiImages;
  }, [productAiImages]);

  useEffect(() => {
    return () => {
      productAiImagesRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  // Update specifications when product prop changes (e.g., when modal reopens after update)
  // This ensures specifications are loaded when editing an existing product
  useEffect(() => {
    if (product) {
      const productSpecs = product.specifications;
      
      // Only update if product has specifications and they're different from current state
      if (productSpecs && typeof productSpecs === 'object' && !Array.isArray(productSpecs)) {
        const productSpecKeys = Object.keys(productSpecs);
        const currentSpecKeys = Object.keys(specifications);
        
        // Update if:
        // 1. Product has specs and current state is empty (initial load)
        // 2. Product has different/more keys than current state (product was updated)
        if (productSpecKeys.length > 0) {
          const specsChanged = JSON.stringify(productSpecs) !== JSON.stringify(specifications);
          if (currentSpecKeys.length === 0 || specsChanged) {
            setSpecifications({ ...productSpecs });
          }
        }
      } else if (!productSpecs && Object.keys(specifications).length === 0) {
        // Product has no specs and we have none - ensure we start with empty object
        setSpecifications({});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.specifications]);

  const addSpecificationKey = () => {
    setSpecifications((prev) => {
      const next = { ...(prev || {}) };
      let idx = 1;
      let candidate = 'new_spec';
      while (Object.prototype.hasOwnProperty.call(next, candidate)) {
        idx += 1;
        candidate = `new_spec_${idx}`;
      }
      next[candidate] = '';
      return next;
    });
  };

  const renameSpecificationKey = (oldKey, nextKeyRaw) => {
    const nextKey = String(nextKeyRaw || '').trim();
    if (!nextKey || nextKey === oldKey) return;
    setSpecifications((prev) => {
      const current = { ...(prev || {}) };
      if (!Object.prototype.hasOwnProperty.call(current, oldKey)) return prev;
      const oldValue = current[oldKey];
      delete current[oldKey];
      if (Object.prototype.hasOwnProperty.call(current, nextKey)) {
        const existingValue = current[nextKey];
        current[nextKey] = existingValue === '' || existingValue == null ? oldValue : existingValue;
      } else {
        current[nextKey] = oldValue;
      }
      return current;
    });
  };

  const removeSpecificationKey = (keyToRemove) => {
    setSpecifications((prev) => {
      if (!prev || !Object.prototype.hasOwnProperty.call(prev, keyToRemove)) return prev;
      const next = { ...prev };
      delete next[keyToRemove];
      return next;
    });
  };

  const updateSpecificationValue = (specKey, nextValueRaw) => {
    setSpecifications((prev) => {
      if (!prev || !Object.prototype.hasOwnProperty.call(prev, specKey)) return prev;
      return {
        ...prev,
        [specKey]: parseSpecInputToValue(nextValueRaw, prev[specKey])
      };
    });
  };

  const fetchSuggestions = async (query) => {
    if (!query || query.trim().length === 0) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/supplier/products/search?q=${encodeURIComponent(query)}`), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setSuggestions(data.suggestions || []);
        setShowSuggestions(data.suggestions && data.suggestions.length > 0);
      }
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
      setSuggestions([]);
      setShowSuggestions(false);
    }
  };

  const handleNameChange = (e) => {
    const value = e.target.value;
    setFormData({ ...formData, name: value, catalogProductId: '' });
    
    // Clear previous timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    
    // Debounce the search - wait 300ms after user stops typing
    const timeout = setTimeout(() => {
      if (value.trim().length > 0) {
        fetchSuggestions(value);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 300);
    
    setSearchTimeout(timeout);
  };

  const handleSuggestionClick = (suggestion) => {
    const nextSpecs =
      suggestion?.specifications &&
      typeof suggestion.specifications === 'object' &&
      !Array.isArray(suggestion.specifications)
        ? suggestion.specifications
        : null;

    setFormData({
      ...formData,
      catalogProductId: suggestion.id || '',
      name: suggestion.name,
      brand: formData.brand || suggestion.brand || '',
      gtin: suggestion.gtin || formData.gtin,
      hsnCode: suggestion.hsnCode || suggestion.hsn_code || formData.hsnCode,
      description: suggestion.description || formData.description,
      category: suggestion.category || formData.category,
      // Auto-fill unit from suggestion if available
      unit: suggestion.unit || formData.unit
    });
    if (nextSpecs) {
      preserveSpecsOnNextCategoryLoadRef.current = true;
      selectedSuggestionSpecsRef.current = { ...nextSpecs };
      setSpecifications(nextSpecs);
    }
    setSuggestions([]);
    setShowSuggestions(false);
    setHoveredSuggestionId(null);
    // Focus back on input after selection
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  // Auto-fill unit when name + category match an existing product (even if user didn't click suggestion)
  useEffect(() => {
    const name = (formData.name || '').trim();
    const category = (formData.category || '').trim();
    const brand = (formData.brand || '').trim();

    if (!name || !category) return;

    const timeout = setTimeout(async () => {
      try {
        const token = localStorage.getItem('token');
        const lookupParams = new URLSearchParams({
          name,
          category
        });
        if (brand) lookupParams.set('brand', brand);
        const res = await fetch(
          getApiUrl(`/api/supplier/products/lookup?${lookupParams.toString()}`),
          { headers: { 'Authorization': `Bearer ${token}` } }
        );
        const data = await res.json();
        if (data.status === 'success' && data.found && data.unit) {
          setFormData(prev => ({ ...prev, unit: data.unit }));
        }
        if (
          data.status === 'success' &&
          data.specifications &&
          typeof data.specifications === 'object' &&
          !Array.isArray(data.specifications) &&
          Object.keys(data.specifications).length > 0
        ) {
          preserveSpecsOnNextCategoryLoadRef.current = true;
          selectedSuggestionSpecsRef.current = { ...data.specifications };
          setSpecifications(data.specifications);
        }
        if (data.status === 'success' && data.found) {
          setRecommendedPrice(
            typeof data.recommendedPrice === 'number' ? data.recommendedPrice : null
          );
          setRecommendedPriceStats(data.priceStats || null);
          if (!product && !priceTouched && (formData.price === '' || formData.price === null || formData.price === undefined)) {
            // Prefill price only when ADDING a product and supplier hasn't typed a price yet
            if (typeof data.recommendedPrice === 'number' && Number.isFinite(data.recommendedPrice)) {
              setFormData(prev => ({ ...prev, price: String(Number(data.recommendedPrice).toFixed(2)) }));
            }
          }
        } else {
          setRecommendedPrice(null);
          setRecommendedPriceStats(null);
        }
      } catch (e) {
        // Silent fail: unit will remain user-selected
      }
    }, 350);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.name, formData.category, formData.brand]);

  // Keep specification template aligned with admin-defined model profiles while typing product name.
  useEffect(() => {
    const category = String(formData.category || '').trim();
    const modelHint = String(formData.name || '').trim();
    if (!category) return;
    if (product && (product.status || 'pending') !== 'pending') return;

    const timeout = setTimeout(async () => {
      await loadCategorySpecifications(category, modelHint, {
        preserveExistingValues: true,
        brand: formData.brand
      });
    }, 350);

    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.name, formData.category, formData.brand]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setSuggestions([]);
    setShowSuggestions(false);
    
    // Include ALL specifications in the product data (both predefined and dynamic from AI)
    // IMPORTANT: Keep ALL keys even if values are null/empty - admin needs to see all AI-generated keys
    const allSpecifications = { ...specifications };
    
    // Keep ALL specification keys, even if they have null/empty values
    // This allows admin to see what keys were generated by AI and fill them in
    // Only remove keys that are completely undefined
    Object.keys(allSpecifications).forEach(key => {
      const value = allSpecifications[key];
      // Only remove if completely undefined
      if (value === undefined) {
        delete allSpecifications[key];
      }
      // Keep null, empty string, and empty arrays - they show keys that need values
    });
    
    const productData = {
      ...formData,
      images: Array.isArray(formData.images) ? formData.images : [],
      specifications: allSpecifications
    };

    // When adding a new product (Manage Products), include all fields including inventory
    // When editing in Manage Inventory, include inventory fields
    // When editing in Manage Products (specifications only), strip inventory fields
    if (!showInventoryFields && product) {
      // Editing existing product in Manage Products view - only update specifications
      delete productData.price;
      delete productData.unit;
      delete productData.stock;
      delete productData.location;
      delete productData.igst_rate;
      delete productData.cgst_rate;
      delete productData.sgst_rate;
      delete productData.lsa;
    }
    
    onSave(productData);
  };

  // Fetch categories, units, and locations on mount
  useEffect(() => {
    fetchCategories();
    fetchUnits();
    fetchLocations();
  }, []);

  const fetchLocations = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/locations'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setLocations(data.locations || []);
        // If editing and location exists, try to match it to a profile location
        if (product?.location && data.locations.length > 0) {
          const matchedLocation = data.locations.find(loc => 
            loc.fullText === product.location || 
            loc.displayText === product.location ||
            loc.address === product.location
          );
          if (matchedLocation) {
            setFormData(prev => ({
              ...prev,
              location: matchedLocation.fullText || matchedLocation.displayText
            }));
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch locations:', error);
    }
  };

  // Initialize category and unit suggestions when data is loaded
  useEffect(() => {
    if (categories.length > 0 && formData.category) {
      const filtered = categories.filter(cat => 
        cat.name.toLowerCase() === formData.category.toLowerCase() ||
        (cat.displayName || cat.name).toLowerCase().includes(formData.category.toLowerCase())
      );
      setCategorySuggestions(filtered.length > 0 ? filtered : categories);
    } else if (categories.length > 0) {
      setCategorySuggestions(categories);
    }
  }, [categories, formData.category]);

  // Auto-load specs when category changes (for new products AND pending products).
  useEffect(() => {
    // If editing an existing product, only auto-load for pending products
    if (product && (product.status || 'pending') !== 'pending') {
      previousCategoryRef.current = formData.category;
      return;
    }

    // Get current category.
    const currentCategory = formData.category ? formData.category.trim().toLowerCase() : '';
    const previousCategory = previousCategoryRef.current ? previousCategoryRef.current.trim().toLowerCase() : null;

    // On initial modal open for an existing (pending) product, keep its current specs.
    // We only want to clear/reload specs after a real user category change.
    if (product && previousCategory === null) {
      previousCategoryRef.current = formData.category;
      return;
    }

    // Only proceed if category actually changed
    if (currentCategory === previousCategory) {
      return; // Category hasn't changed, don't reload specs
    }

    // Update the ref to track current category
    previousCategoryRef.current = formData.category;

    // Clear specs immediately when category changes (before loading new ones)
    // This prevents showing old specs from previous category
    setSpecifications({});

    // Only if category is set and categories are loaded.
    if (currentCategory && categories.length > 0) {
      // Check if the category matches an existing category
      const matchedCategory = categories.find(cat => 
        cat.name.toLowerCase() === currentCategory ||
        (cat.displayName || cat.name).toLowerCase() === currentCategory
      );

      if (matchedCategory) {
        const modelHint = String(formData?.name || '').trim();
        const preserveExistingValues = preserveSpecsOnNextCategoryLoadRef.current;
        preserveSpecsOnNextCategoryLoadRef.current = false;
        loadCategorySpecifications(matchedCategory.name, modelHint, { preserveExistingValues });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.category, categories, product]);

  useEffect(() => {
    if (units.length > 0 && formData.unit) {
      const filtered = units.filter(unit => 
        unit.name.toLowerCase() === formData.unit.toLowerCase() ||
        (unit.displayName || unit.name).toLowerCase().includes(formData.unit.toLowerCase())
      );
      setUnitSuggestions(filtered.length > 0 ? filtered : units);
    } else if (units.length > 0) {
      setUnitSuggestions(units);
    }
  }, [units, formData.unit]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeout) {
        clearTimeout(searchTimeout);
      }
    };
  }, [searchTimeout]);

  const fetchCategories = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/categories'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setCategories(data.categories || []);
      }
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  };

  const fetchUnits = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/units'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setUnits(data.units || []);
      }
    } catch (error) {
      console.error('Failed to fetch units:', error);
    }
  };

  // Load specifications by category + optional model.
  // If model profile exists in Supabase, it is returned; otherwise category defaults are returned.
  const loadCategorySpecifications = async (categoryName, modelValue = '', options = {}) => {
    const preserveExistingValues = options.preserveExistingValues !== false;
    const brandValue = String(options.brand ?? formData?.brand ?? '').trim();
    // Auto-load specs for:
    // - new products
    // - existing products that are still pending approval (supplier can still edit)
    // Do NOT auto-load for approved/rejected products to avoid overwriting existing data.
    if (product && (product.status || 'pending') !== 'pending') {
      return;
    }

    // Snapshot existing specs before clear (only when preserving values).
    const existingSpecsSnapshot = (() => {
      if (!preserveExistingValues) return {};
      if (
        selectedSuggestionSpecsRef.current &&
        typeof selectedSuggestionSpecsRef.current === 'object' &&
        !Array.isArray(selectedSuggestionSpecsRef.current)
      ) {
        return { ...selectedSuggestionSpecsRef.current };
      }
      if (specifications && typeof specifications === 'object' && !Array.isArray(specifications)) {
        return { ...specifications };
      }
      return {};
    })();

    if (!categoryName || !categoryName.trim()) {
      setSpecifications({});
      return;
    }

    const normalizedCategoryName = categoryName.trim().toLowerCase();
    const normalizedModel = String(modelValue || '').trim();

    setSpecifications({});
    setLoadingSpecs(true);

    try {
      const token = localStorage.getItem('token');
      const queryParams = new URLSearchParams();
      if (normalizedModel) queryParams.set('model', normalizedModel);
      if (brandValue) queryParams.set('brand', brandValue);
      const modelQuery = queryParams.toString() ? `?${queryParams.toString()}` : '';
      const apiUrl = getApiUrl(
        `/api/supplier/categories/${encodeURIComponent(normalizedCategoryName)}/specifications${modelQuery}`
      );

      const resp = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token}`
        },
        cache: 'no-cache'
      });

      if (resp.ok) {
        const data = await resp.json();

        if (data.status === 'success') {
          const specsObj = data.specifications || {};
          const specKeys = Object.keys(specsObj);

          if (specKeys.length > 0) {
            const newSpecs = {};
            specKeys.forEach((k) => {
              if (preserveExistingValues && Object.prototype.hasOwnProperty.call(existingSpecsSnapshot, k)) {
                newSpecs[k] = existingSpecsSnapshot[k];
              } else {
                newSpecs[k] = specsObj[k];
              }
            });
            setSpecifications(newSpecs);
          } else {
            setSpecifications({});
          }
          selectedSuggestionSpecsRef.current = null;
        } else {
          setSpecifications({});
          selectedSuggestionSpecsRef.current = null;
        }
      } else if (resp.status === 404) {
        setSpecifications({});
        selectedSuggestionSpecsRef.current = null;
      } else {
        console.error('Failed to load specifications:', resp.status, resp.statusText);
        setSpecifications({});
      }
    } catch (err) {
      console.error('Failed to load specifications:', normalizedCategoryName, normalizedModel, err);
      setSpecifications({});
      selectedSuggestionSpecsRef.current = null;
    } finally {
      setLoadingSpecs(false);
    }
  };

  const handleCategoryChange = async (e) => {
    const value = e.target.value;
    setFormData({...formData, category: value});
    
    // Filter categories based on input
    if (value.trim().length > 0) {
      const filtered = categories.filter(cat => 
        (cat.displayName || cat.name).toLowerCase().includes(value.toLowerCase())
      );
      setCategorySuggestions(filtered);
      setShowCategorySuggestions(true);
    } else {
      setCategorySuggestions(categories);
      setShowCategorySuggestions(true);
    }

    // If user manually types a category name that matches an existing category,
    // load specs for that category and current product/model hint.
    if (value.trim().length > 0 && (!product || (product && (product.status || 'pending') === 'pending'))) {
      // Check if the typed value exactly matches a category name.
      const matchedCategory = categories.find(cat => 
        cat.name.toLowerCase() === value.trim().toLowerCase() ||
        (cat.displayName || cat.name).toLowerCase() === value.trim().toLowerCase()
      );
      
      if (matchedCategory) {
        // User typed a valid category name - include product name as model hint so
        // admin-defined model spec profiles are shown while adding products.
        const modelHint = String(formData?.name || '').trim();
        await loadCategorySpecifications(matchedCategory.name, modelHint, { preserveExistingValues: false });
      } else {
        // User is typing but hasn't matched a category yet - clear specs
        setSpecifications({});
      }
    } else if (!value.trim() && (!product || (product && (product.status || 'pending') === 'pending'))) {
      // Category field cleared - clear specs
      setSpecifications({});
    }
  };

  const handleCategorySelect = async (category) => {
    // Use the actual category name (lowercase) from the database, not displayName.
    const updatedCategory = category.name || category.displayName || category;
    
    // Reset previous category ref to ensure useEffect detects the change
    previousCategoryRef.current = null;
    
    // Update form data first - this will trigger the useEffect
    // Store the actual category name (lowercase) in formData.
    setFormData({...formData, category: updatedCategory});
    setShowCategorySuggestions(false);

    // ALWAYS load admin-defined specs for selected category + current model hint.
    const modelHint = String(formData?.name || '').trim();
    await loadCategorySpecifications(updatedCategory, modelHint, { preserveExistingValues: false });
  };

  const handleCategoryCreate = async () => {
    const categoryName = formData.category.trim();
    if (!categoryName) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/categories'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: categoryName })
      });
      const data = await response.json();
      if (data.status === 'success') {
        await fetchCategories();
        const createdCategoryName = data.category.name;
        setFormData({...formData, category: createdCategoryName});
        setShowCategorySuggestions(false);
        
        // Load admin-defined specs for this category (if any exist), with model hint.
        const modelHint = String(formData?.name || '').trim();
        await loadCategorySpecifications(createdCategoryName, modelHint, { preserveExistingValues: false });
      }
    } catch (error) {
      console.error('Failed to create category:', error);
    }
  };

  const handleUnitChange = (e) => {
    const value = e.target.value;
    setFormData({...formData, unit: value});
    
    // Filter units based on input
    if (value.trim().length > 0) {
      const filtered = units.filter(unit => 
        (unit.displayName || unit.name).toLowerCase().includes(value.toLowerCase())
      );
      setUnitSuggestions(filtered);
      setShowUnitSuggestions(true);
    } else {
      setUnitSuggestions(units);
      setShowUnitSuggestions(true);
    }
  };

  const handleUnitSelect = async (unit) => {
    setFormData({...formData, unit: unit.name});
    setShowUnitSuggestions(false);
  };

  const handleUnitCreate = async () => {
    const unitName = formData.unit.trim();
    if (!unitName) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/units'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ name: unitName })
      });
      const data = await response.json();
      if (data.status === 'success') {
        await fetchUnits();
        setFormData({...formData, unit: data.unit.name});
        setShowUnitSuggestions(false);
      }
    } catch (error) {
      console.error('Failed to create unit:', error);
    }
  };


  // Extract specifications from description
  const fileToImagePart = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const str = String(reader.result);
        const match = str.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          resolve({
            data: match[2],
            mimeType: match[1] || file.type || 'image/jpeg'
          });
        } else {
          reject(new Error('Could not read image'));
        }
      };
      reader.onerror = () => reject(new Error('Could not read image'));
      reader.readAsDataURL(file);
    });

  const analyzeImagesFromFiles = async (files) => {
    if (!files || files.length < MIN_AI_PRODUCT_IMAGES) {
      alert(
        `Please add at least ${MIN_AI_PRODUCT_IMAGES} product photos (e.g. front, side, label) so AI can identify the product reliably.`
      );
      return;
    }

    setAnalyzingImage(true);
    try {
      const images = await Promise.all(files.map((f) => fileToImagePart(f)));
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/products/analyze-image'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          images,
          provider: aiProvider === 'auto' ? 'auto' : aiProvider
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.status === 'success') {
        if (data.productName) {
          setFormData((prev) => ({
            ...prev,
          name: data.productName
          }));
        }

        if (data.category) {
          setFormData((prev) => ({
            ...prev,
            category: data.category
          }));

          setTimeout(async () => {
            await loadCategorySpecifications(data.category, data.productName || formData.name || '', { preserveExistingValues: true });
          }, 100);
        }

        const providerName =
          data.provider === 'openai'
            ? 'ChatGPT'
            : data.provider === 'gemini'
              ? 'Gemini'
              : data.provider === 'claude'
                ? 'Claude'
                : 'AI';
        alert(
          `✅ Images analyzed successfully using ${providerName}!\n\nProduct Name: ${data.productName || 'Not detected'}\nCategory: ${data.category || 'Not detected'}`
        );
      } else {
        alert(data.message || 'Failed to analyze images. Please try again.');
      }
    } catch (error) {
      console.error('Image analysis error:', error);
      alert(
        `Failed to analyze images: ${error.message}. Please check your API keys configuration and try again.`
      );
    } finally {
      setAnalyzingImage(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      e.target.value = '';
    }
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert('Image size should be less than 10MB');
      return;
    }

    let filesToAnalyze = null;
    setProductAiImages((prev) => {
      if (prev.length >= MAX_AI_PRODUCT_IMAGES) {
        queueMicrotask(() =>
          alert(`You can add at most ${MAX_AI_PRODUCT_IMAGES} images.`)
        );
        return prev;
      }
      const previewUrl = URL.createObjectURL(file);
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const next = [...prev, { id, file, previewUrl }];
      if (next.length >= MIN_AI_PRODUCT_IMAGES) {
        filesToAnalyze = next.map((x) => x.file);
      }
      return next;
    });

    if (filesToAnalyze) {
      await analyzeImagesFromFiles(filesToAnalyze);
    }
  };

  const uploadProductImageToStorage = async (file) => {
    const token = localStorage.getItem('token');
    const payload = new FormData();
    payload.append('image', file);
    if (product?.supplier_product_id || product?.id || product?._id) {
      payload.append('supplierProductId', product.supplier_product_id || product.id || product._id);
    }
    const response = await fetch(getApiUrl('/api/supplier/products/upload-image'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: payload
    });
    const data = await response.json();
    if (!response.ok || data.status !== 'success' || !data.url) {
      throw new Error(data.message || 'Failed to upload image');
    }
    return data.url;
  };

  const handleProductImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (file) e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert('Image size should be less than 10MB');
      return;
    }

    setUploadingProductImage(true);
    try {
      const url = await uploadProductImageToStorage(file);
      setFormData((prev) => ({
        ...prev,
        images: Array.from(new Set([...(Array.isArray(prev.images) ? prev.images : []), url]))
      }));
    } catch (error) {
      alert(error.message || 'Failed to upload image');
    } finally {
      setUploadingProductImage(false);
    }
  };

  const removeProductImage = (url) => {
    setFormData((prev) => ({
      ...prev,
      images: (Array.isArray(prev.images) ? prev.images : []).filter((x) => x !== url)
    }));
  };

  const handleRemoveAiImage = (id) => {
    setProductAiImages((prev) => {
      const item = prev.find((x) => x.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((x) => x.id !== id);
    });
  };

  const handleClearAiImages = () => {
    setProductAiImages((prev) => {
      prev.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
      return [];
    });
  };

  const handleExtractSpecifications = async () => {
    if (!formData.description || !formData.description.trim()) {
      alert('Please enter a description with specification details first');
      return;
    }

    if (!formData.category || !formData.category.trim()) {
      alert('Please select a category first. Category is required to extract specifications.');
      return;
    }

    setExtracting(true);
    try {
      const { response, data } = await extractSpecificationsFromDescription({
        description: formData.description,
        category: formData.category,
        productName: formData.name,
        provider: aiProvider,
        existingSpecifications: specifications || {}
      });

      if (!response.ok && data?.status !== 'success' && data?.status !== 'warning') {
        throw new Error(data?.message || `HTTP error! status: ${response.status}`);
      }

      const result = applyExtractResultToSpecs(specifications || {}, data);
      if (!result.ok) {
        alert(`⚠️ ${result.warning || result.error}`);
        return;
      }

      if (result.categoryMismatchWarning) {
        alert(`⚠️ ${result.categoryMismatchWarning}`);
      }

      setSpecifications(result.merged);

      const providerName =
        result.provider === 'openai'
          ? 'ChatGPT'
          : result.provider === 'gemini'
            ? 'Gemini'
            : result.provider === 'claude'
              ? 'Claude'
              : 'AI';

      if (result.filledCount > 0) {
        alert(
          `Successfully extracted ${result.filledCount} specification value${result.filledCount > 1 ? 's' : ''} from description using ${providerName}.`
        );
      } else {
        alert(
          'No specification values were found in the description. Try lines like "Finish: Matt" or "Volume: 20L".'
        );
      }
    } catch (error) {
      console.error('Extract specifications error:', error);
      alert(`Failed to extract specifications: ${error.message}. Check AI API keys in server configuration.`);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>{product ? 'Edit Product' : 'Add New Product'}</h3>
          <button className="btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {showAdditionSteps && (
          <div style={{ padding: '0 1.25rem' }}>
            <SupplierProductAdditionSteps
              variant="add-product"
              compact
              hint="Step 1 of 3: catalog details only. Inventory and ProductCOV come next."
            />
          </div>
        )}
        
        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-grid">
            <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: '1rem', order: !product ? 100 : 1 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <ImageIcon size={16} />
                Product images (stored in Supabase)
              </label>
              <div
                style={{
                  border: '2px dashed #d1d5db',
                  borderRadius: '8px',
                  padding: '1rem',
                  backgroundColor: '#f9fafb'
                }}
              >
                {(Array.isArray(formData.images) ? formData.images : []).length > 0 && (
                  <div style={{ marginBottom: '0.85rem' }}>
                    <ProductImageCarousel
                      images={Array.isArray(formData.images) ? formData.images : []}
                      alt={formData.name || 'Product'}
                      height={220}
                      rounded={10}
                    />
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.75rem' }}>
                  {(Array.isArray(formData.images) ? formData.images : []).map((url) => (
                    <div
                      key={url}
                      style={{
                        position: 'relative',
                        width: '100px',
                        height: '100px',
                        borderRadius: '8px',
                        overflow: 'hidden',
                        border: '1px solid #e5e7eb',
                        background: '#fff'
                      }}
                    >
                      <img
                        src={url}
                        alt="Product"
                        style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#f8fafc' }}
                      />
                      <button
                        type="button"
                        onClick={() => removeProductImage(url)}
                        style={{
                          position: 'absolute',
                          top: '4px',
                          right: '4px',
                          background: '#ef4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '50%',
                          width: '22px',
                          height: '22px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ))}
                  <input
                    type="file"
                    accept="image/*"
                    id="product-persistent-image-upload"
                    onChange={handleProductImageUpload}
                    disabled={uploadingProductImage}
                    style={{ display: 'none' }}
                  />
                  <label
                    htmlFor="product-persistent-image-upload"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '100px',
                      height: '100px',
                      border: '2px dashed #93c5fd',
                      borderRadius: '8px',
                      background: uploadingProductImage ? '#e5e7eb' : '#eff6ff',
                      color: uploadingProductImage ? '#6b7280' : '#2563eb',
                      cursor: uploadingProductImage ? 'not-allowed' : 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      textAlign: 'center',
                      padding: '0.5rem'
                    }}
                  >
                    {uploadingProductImage ? <Loader size={20} style={{ animation: 'spin 1s linear infinite' }} /> : <>Add image</>}
                  </label>
                </div>
                <p style={{ margin: 0, fontSize: '0.75rem', color: '#6b7280' }}>
                  These images are saved in Supabase Storage and shown to buyers for easier product identification.
                </p>
              </div>
            </div>
            {/* Image Upload Section */}
            {!product && (
              <div className="form-group" style={{ gridColumn: '1 / -1', marginBottom: '1rem', order: -10 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <ImageIcon size={16} />
                  Product photos for AI (minimum {MIN_AI_PRODUCT_IMAGES})
                </label>
                <div
                  style={{
                    border: '2px dashed #d1d5db',
                    borderRadius: '8px',
                    padding: '1rem',
                    backgroundColor: '#f9fafb',
                    position: 'relative'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.75rem',
                      alignItems: 'flex-start',
                      marginBottom: '0.75rem'
                    }}
                  >
                    {productAiImages.map((img) => (
                      <div
                        key={img.id}
                        style={{
                          position: 'relative',
                          width: '100px',
                          height: '100px',
                          borderRadius: '8px',
                          overflow: 'hidden',
                          border: '1px solid #e5e7eb',
                          background: '#fff'
                        }}
                      >
                        <img
                          src={img.previewUrl}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#f8fafc' }}
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveAiImage(img.id)}
                          disabled={analyzingImage}
                          style={{
                            position: 'absolute',
                            top: '4px',
                            right: '4px',
                            background: '#ef4444',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '22px',
                            height: '22px',
                            cursor: analyzingImage ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                          }}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    {productAiImages.length < MAX_AI_PRODUCT_IMAGES && (
                      <>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={handleImageUpload}
                          disabled={analyzingImage}
                          style={{ display: 'none' }}
                          id="product-image-upload"
                        />
                        <label
                          htmlFor="product-image-upload"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '100px',
                            height: '100px',
                            border: '2px dashed #93c5fd',
                            borderRadius: '8px',
                            background: analyzingImage ? '#e5e7eb' : '#eff6ff',
                            color: analyzingImage ? '#6b7280' : '#2563eb',
                            cursor: analyzingImage ? 'not-allowed' : 'pointer',
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            textAlign: 'center',
                            padding: '0.5rem',
                            boxSizing: 'border-box'
                          }}
                        >
                          {analyzingImage ? (
                            <Loader size={20} style={{ animation: 'spin 1s linear infinite' }} />
                          ) : (
                            <>
                              <Upload size={20} style={{ marginBottom: '0.25rem' }} />
                              Add photo
                            </>
                          )}
                        </label>
                      </>
                    )}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '0.5rem',
                      justifyContent: 'space-between'
                    }}
                  >
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#6b7280', flex: '1 1 200px' }}>
                      Add <strong>at least {MIN_AI_PRODUCT_IMAGES} photos</strong> of the same item (different angles,
                      packaging, or label). AI runs automatically after the {MIN_AI_PRODUCT_IMAGES}rd photo, or use
                      &quot;Re-run AI&quot;.
                    </p>
                    <span
                      style={{
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color:
                          productAiImages.length >= MIN_AI_PRODUCT_IMAGES ? '#059669' : '#b45309',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {productAiImages.length} / {MIN_AI_PRODUCT_IMAGES}+
                    </span>
                  </div>
                  <div style={{ marginTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={analyzingImage || productAiImages.length < MIN_AI_PRODUCT_IMAGES}
                      onClick={() => analyzeImagesFromFiles(productAiImages.map((x) => x.file))}
                    >
                      Re-run AI with all photos
                    </button>
                    {productAiImages.length > 0 && (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={analyzingImage}
                        onClick={handleClearAiImages}
                      >
                        Clear all photos
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!showInventoryFields && (
              <div className="form-group" style={{ position: 'relative', marginBottom: '1rem' }}>
                <label>Product Name</label>
                <input
                  ref={inputRef}
                  type="text"
                  value={formData.name}
                  onChange={handleNameChange}
                  placeholder='e.g. "Cement OPC", "TMT Steel Bar", "Red Clay Brick"'
                  onFocus={() => {
                    if (formData.name.trim().length > 0 && suggestions.length > 0) {
                      setShowSuggestions(true);
                    } else if (!product) {
                      // Show dropdown with options even when no suggestions or when field is empty
                      setShowSuggestions(true);
                    }
                  }}
                  onBlur={(e) => {
                    // Check if the blur is due to clicking on a suggestion
                    if (suggestionsRef.current && suggestionsRef.current.contains(e.relatedTarget)) {
                      return;
                    }
                    // Delay hiding suggestions to allow click on suggestion
                    setTimeout(() => {
                      if (!suggestionsRef.current || !suggestionsRef.current.contains(document.activeElement)) {
                        setShowSuggestions(false);
                      }
                    }, 200);
                  }}
                  required
                  autoComplete="off"
                  style={{ width: '100%' }}
                />

                <div style={{ marginTop: '0.9rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.35rem' }}>
                    Brand
                  </label>
                  <BrandSelect
                    value={formData.brand}
                    onChange={(brand) => setFormData((prev) => ({ ...prev, brand }))}
                    disabled={!!product}
                    required={!product}
                    searchable
                  />
                </div>

                <div style={{ marginTop: '0.9rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.35rem' }}>
                    GTIN / UPC / EAN
                  </label>
                  <input
                    type="text"
                    value={formData.gtin}
                    onChange={(e) => setFormData({ ...formData, gtin: e.target.value.replace(/\s+/g, '') })}
                    placeholder='8/12/13/14 digit code'
                    inputMode="numeric"
                    autoComplete="off"
                    style={{ width: '100%' }}
                  />
                </div>

                {showSuggestions && !product && (
                <div
                  ref={suggestionsRef}
                  style={{
                    position: 'absolute',
                    top: '68px',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    zIndex: 10000,
                    maxHeight: '400px',
                    overflowY: 'auto',
                    overflowX: 'visible',
                    marginTop: '4px',
                    padding: '4px 0',
                    width: '100%',
                    maxWidth: '100%',
                    minWidth: '100%',
                    boxSizing: 'border-box'
                  }}
                  onMouseDown={(e) => {
                    // Prevent input blur when clicking on dropdown
                    e.preventDefault();
                  }}
                >
                  {suggestions.map((suggestion, index) => (
                    <div
                      key={suggestion.id || index}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSuggestionClick(suggestion);
                      }}
                      style={{
                        padding: '0.875rem 1rem',
                        cursor: 'pointer',
                        borderBottom: '1px solid #f3f4f6',
                        transition: 'background-color 0.15s ease',
                        display: 'flex',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '0.75rem',
                        minHeight: 'auto',
                        width: '100%',
                        maxWidth: '100%',
                        boxSizing: 'border-box',
                        wordBreak: 'break-word',
                        overflow: 'visible',
                        overflowWrap: 'break-word'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                        setHoveredSuggestionId(suggestion.id || `idx-${index}`);
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'white';
                        setHoveredSuggestionId(null);
                      }}
                    >
                      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <div style={{ 
                          fontWeight: '500', 
                          color: '#1e293b',
                          fontSize: '0.9375rem',
                          overflow: 'visible',
                          textOverflow: 'clip',
                          whiteSpace: 'normal',
                          wordWrap: 'break-word',
                          wordBreak: 'break-word',
                          overflowWrap: 'break-word',
                          lineHeight: '1.5',
                          width: '100%',
                          maxWidth: 'none',
                          paddingRight: '0.5rem',
                          display: 'block',
                          boxSizing: 'border-box'
                        }}>
                          {suggestion.name}
                        </div>
                        <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', color: '#64748b' }}>
                          {(suggestion.brand || '-')} • {(suggestion.unit || '-')}
                        </div>
                        {hoveredSuggestionId === (suggestion.id || `idx-${index}`) && (
                          <div
                            style={{
                              marginTop: '0.5rem',
                              padding: '0.625rem',
                              borderRadius: '8px',
                              border: '1px solid #e2e8f0',
                              background: '#f8fafc',
                              fontSize: '0.75rem',
                              color: '#334155',
                              display: 'grid',
                              gap: '0.25rem'
                            }}
                          >
                            <div><strong>Brand:</strong> {suggestion.brand || '-'}</div>
                            <div><strong>Category:</strong> {suggestion.category || '-'}</div>
                            <div><strong>Unit:</strong> {suggestion.unit || '-'}</div>
                            <div><strong>GTIN:</strong> {suggestion.gtin || '-'}</div>
                            <div><strong>Barcode:</strong> {suggestion.barcode || '-'}</div>
                            <div><strong>Description:</strong> {suggestion.description || '-'}</div>
                          </div>
                        )}
                      </div>
                      {suggestion.category && (
                        <span style={{
                          fontSize: '0.75rem',
                          color: '#475569',
                          background: '#f1f5f9',
                          padding: '0.375rem 0.625rem',
                          borderRadius: '6px',
                          textTransform: 'capitalize',
                          fontWeight: '500',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          alignSelf: 'flex-start',
                          marginTop: '0.125rem'
                        }}>
                          {suggestion.category}
                        </span>
                      )}
                    </div>
                  ))}
                  {!product && (
                    <>
                      {suggestions.length > 0 && (
                        <div style={{
                          height: '1px',
                          background: '#e5e7eb',
                          margin: '0.5rem 0'
                        }} />
                      )}
                      <div
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setProductType('existing_category');
                          setShowSuggestions(false);
                        }}
                        style={{
                          padding: '0.875rem 1rem',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f3f4f6',
                          background: productType === 'existing_category' ? '#f0f9ff' : 'white',
                          color: productType === 'existing_category' ? '#0369a1' : '#1e293b',
                          fontWeight: productType === 'existing_category' ? '600' : '500',
                          transition: 'background-color 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          if (productType !== 'existing_category') {
                            e.currentTarget.style.backgroundColor = '#f9fafb';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (productType !== 'existing_category') {
                            e.currentTarget.style.backgroundColor = productType === 'existing_category' ? '#f0f9ff' : 'white';
                          }
                        }}
                      >
                        Add new product in existing category
                      </div>
                      <div
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setProductType('new_category');
                          setShowSuggestions(false);
                        }}
                        style={{
                          padding: '0.875rem 1rem',
                          cursor: 'pointer',
                          background: productType === 'new_category' ? '#f0f9ff' : 'white',
                          color: productType === 'new_category' ? '#0369a1' : '#1e293b',
                          fontWeight: productType === 'new_category' ? '600' : '500',
                          transition: 'background-color 0.15s ease'
                        }}
                        onMouseEnter={(e) => {
                          if (productType !== 'new_category') {
                            e.currentTarget.style.backgroundColor = '#f9fafb';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (productType !== 'new_category') {
                            e.currentTarget.style.backgroundColor = productType === 'new_category' ? '#f0f9ff' : 'white';
                          }
                        }}
                      >
                        Add new product and new category
                      </div>
                    </>
                  )}
                </div>
                )}

                {showSuggestions && product && suggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  style={{
                    position: 'absolute',
                    top: '68px',
                    left: 0,
                    right: 0,
                    background: 'white',
                    border: '1px solid #d1d5db',
                    borderRadius: '8px',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                    zIndex: 10000,
                    maxHeight: '400px',
                    overflowY: 'auto',
                    overflowX: 'visible',
                    marginTop: '4px',
                    padding: '4px 0',
                    width: '100%',
                    maxWidth: '100%',
                    minWidth: '100%',
                    boxSizing: 'border-box'
                  }}
                  onMouseDown={(e) => {
                    // Prevent input blur when clicking on dropdown
                    e.preventDefault();
                  }}
                >
                  {suggestions.map((suggestion, index) => (
                    <div
                      key={index}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleSuggestionClick(suggestion);
                      }}
                      style={{
                        padding: '0.875rem 1rem',
                        cursor: 'pointer',
                        borderBottom: index < suggestions.length - 1 ? '1px solid #f3f4f6' : 'none',
                        transition: 'background-color 0.15s ease',
                        display: 'flex',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '0.75rem',
                        minHeight: 'auto',
                        width: '100%',
                        maxWidth: '100%',
                        boxSizing: 'border-box',
                        wordBreak: 'break-word',
                        overflow: 'visible',
                        overflowWrap: 'break-word'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f9fafb';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'white';
                      }}
                    >
                      <div style={{ 
                        fontWeight: '500', 
                        color: '#1e293b',
                        fontSize: '0.9375rem',
                        flex: '1 1 auto',
                        overflow: 'visible',
                        textOverflow: 'clip',
                        whiteSpace: 'normal',
                        wordWrap: 'break-word',
                        wordBreak: 'break-word',
                        overflowWrap: 'break-word',
                        lineHeight: '1.5',
                        minWidth: 0,
                        width: '100%',
                        maxWidth: 'none',
                        paddingRight: '0.5rem',
                        display: 'block',
                        boxSizing: 'border-box'
                      }}>
                        {suggestion.name}
                      </div>
                      {suggestion.category && (
                        <span style={{
                          fontSize: '0.75rem',
                          color: '#475569',
                          background: '#f1f5f9',
                          padding: '0.375rem 0.625rem',
                          borderRadius: '6px',
                          textTransform: 'capitalize',
                          fontWeight: '500',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                          alignSelf: 'flex-start',
                          marginTop: '0.125rem'
                        }}>
                          {suggestion.category}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
            )}

            {!showInventoryFields && (
              <div className="form-group" style={{ 
                position: 'relative',
                opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                transition: 'opacity 0.2s ease',
                zIndex: showCategorySuggestions ? 1 : (showUnitSuggestions ? 1000 : 'auto')
              }}>
                <label>Unit</label>
                <div style={{ position: 'relative' }}>
                  <input
                    ref={unitInputRef}
                    type="text"
                    value={formData.unit}
                    onChange={handleUnitChange}
                    onFocus={() => {
                      if (units.length > 0) {
                        setUnitSuggestions(units);
                        setShowUnitSuggestions(true);
                      }
                    }}
                    onBlur={(e) => {
                      if (unitSuggestionsRef.current && unitSuggestionsRef.current.contains(e.relatedTarget)) {
                        return;
                      }
                      setTimeout(() => {
                        if (!unitSuggestionsRef.current || !unitSuggestionsRef.current.contains(document.activeElement)) {
                          setShowUnitSuggestions(false);
                        }
                      }, 200);
                    }}
                    placeholder="Select or type a new unit"
                    required
                    autoComplete="off"
                    style={{ width: '100%' }}
                  />
                  {showUnitSuggestions && (
                    <div
                      ref={unitSuggestionsRef}
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        background: 'white',
                        border: '1px solid #d1d5db',
                        borderRadius: '8px',
                        boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                        zIndex: 10002,
                        maxHeight: '300px',
                        overflowY: 'auto',
                        marginTop: '4px',
                        padding: '4px 0',
                        width: '100%'
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                    >
                    {unitSuggestions.length > 0 ? (
                      unitSuggestions.map((unit, index) => (
                        <div
                          key={index}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleUnitSelect(unit);
                          }}
                          style={{
                            padding: '0.875rem 1rem',
                            cursor: 'pointer',
                            borderBottom: index < unitSuggestions.length - 1 ? '1px solid #f3f4f6' : 'none',
                            transition: 'background-color 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#f9fafb';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'white';
                          }}
                        >
                          {unit.displayName || unit.name}
                        </div>
                      ))
                    ) : (
                      <div style={{ padding: '0.875rem 1rem', color: '#64748b' }}>
                        No matching units
                      </div>
                    )}
                    {formData.unit.trim() && !unitSuggestions.some(unit => unit.name.toLowerCase() === formData.unit.trim().toLowerCase()) && (
                      <div
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleUnitCreate();
                        }}
                        style={{
                          padding: '0.875rem 1rem',
                          cursor: 'pointer',
                          borderTop: '1px solid #e5e7eb',
                          background: '#f0f9ff',
                          color: '#0369a1',
                          fontWeight: '500',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#e0f2fe';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '#f0f9ff';
                        }}
                      >
                        <Plus size={16} />
                        Create "{formData.unit.trim()}"
                      </div>
                    )}
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {!showInventoryFields && (
              <div className="form-group" style={{ 
                position: 'relative',
                opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                transition: 'opacity 0.2s ease',
                overflow: 'visible',
                zIndex: showCategorySuggestions ? 1000 : 1
              }}>
                <label>Category</label>
                <input
                  ref={categoryInputRef}
                  type="text"
                  value={formData.category}
                  onChange={handleCategoryChange}
                  onFocus={() => {
                    if (categories.length > 0) {
                      setCategorySuggestions(categories);
                      setShowCategorySuggestions(true);
                    }
                  }}
                  onBlur={(e) => {
                    if (categorySuggestionsRef.current && categorySuggestionsRef.current.contains(e.relatedTarget)) {
                      return;
                    }
                    setTimeout(() => {
                      if (!categorySuggestionsRef.current || !categorySuggestionsRef.current.contains(document.activeElement)) {
                        setShowCategorySuggestions(false);
                      }
                    }, 200);
                  }}
                  placeholder="Select or type a new category"
                  required
                  autoComplete="off"
                  style={{ width: '100%', boxSizing: 'border-box' }}
                />
                {showCategorySuggestions && (
                  <div
                    ref={categorySuggestionsRef}
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      background: 'white',
                      border: '1px solid #d1d5db',
                      borderRadius: '8px',
                      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
                      zIndex: 10001,
                      maxHeight: '300px',
                      overflowY: 'auto',
                      overflowX: 'visible',
                      marginTop: '4px',
                      padding: '4px 0',
                      width: '100%',
                      minWidth: '100%',
                      boxSizing: 'border-box',
                      wordWrap: 'break-word'
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    {categorySuggestions.length > 0 ? (
                      categorySuggestions.map((cat, index) => (
                        <div
                          key={index}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleCategorySelect(cat);
                          }}
                          style={{
                            padding: '0.875rem 1rem',
                            cursor: 'pointer',
                            borderBottom: index < categorySuggestions.length - 1 ? '1px solid #f3f4f6' : 'none',
                            transition: 'background-color 0.15s ease',
                            overflow: 'visible',
                            overflowWrap: 'break-word',
                            wordBreak: 'break-word',
                            whiteSpace: 'normal',
                            textOverflow: 'clip',
                            width: '100%',
                            boxSizing: 'border-box',
                            textAlign: 'left',
                            display: 'flex',
                            alignItems: 'center'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = '#f9fafb';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'white';
                          }}
                        >
                          <span style={{
                            display: 'block',
                            width: '100%',
                            overflow: 'visible',
                            wordWrap: 'break-word',
                            whiteSpace: 'normal',
                            textAlign: 'left',
                            lineHeight: '1.5'
                          }}>
                            {cat.displayName || cat.name}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div style={{ padding: '0.875rem 1rem', color: '#64748b' }}>
                        No matching categories
                      </div>
                    )}
                    {formData.category.trim() && !categorySuggestions.some(cat => cat.name.toLowerCase() === formData.category.trim().toLowerCase()) && (
                      <div
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleCategoryCreate();
                        }}
                        style={{
                          padding: '0.875rem 1rem',
                          cursor: 'pointer',
                          borderTop: '1px solid #e5e7eb',
                          background: '#f0f9ff',
                          color: '#0369a1',
                          fontWeight: '500',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = '#e0f2fe';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = '#f0f9ff';
                        }}
                      >
                        <Plus size={16} />
                        Create "{formData.category.trim()}"
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            
            {showInventoryFields && (
              <>
                <div className="form-group" style={{ 
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease',
                  position: 'relative',
                  zIndex: showCategorySuggestions ? 1 : 'auto'
                }}>
                  <label>{SUPPLIER_MRP_FIELD_LABEL}</label>
                  <RupeeInput
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.price}
                    onChange={(e) => {
                      setPriceTouched(true);
                      setFormData({...formData, price: e.target.value});
                    }}
                    required
                  />
                  {typeof recommendedPrice === 'number' && Number.isFinite(recommendedPrice) && (
                    <div style={{ marginTop: '0.35rem', fontSize: '0.85rem', color: '#0369a1' }}>
                      Recommended avg {SUPPLIER_MRP_LABEL}: <strong>{formatRupee(recommendedPrice, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
                      {recommendedPriceStats?.supplierCountOthers > 0 && (
                        <span style={{ color: '#64748b' }}>
                          {' '}({recommendedPriceStats.supplierCountOthers} other supplier{recommendedPriceStats.supplierCountOthers > 1 ? 's' : ''})
                        </span>
                      )}
                    </div>
                  )}
                </div>
                
                <div className="form-group" style={{ 
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>{SUPPLIER_CURRENT_STOCK_LABEL}</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={formData.stock}
                    onChange={(e) => setFormData({...formData, stock: e.target.value})}
                    required
                  />
                </div>

                <div className="form-group" style={{
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>HSN Code (for exact GST)</label>
                  <input
                    type="text"
                    value={formData.hsnCode}
                    onChange={(e) => setFormData({ ...formData, hsnCode: e.target.value })}
                    placeholder="e.g. 7214, 2523, 2505"
                  />
                </div>

                <div className="form-group" style={{
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>SGST</label>
                  <select
                    value={formData.sgst_rate}
                    onChange={(e) => setFormData({ ...formData, sgst_rate: e.target.value })}
                    required
                  >
                    <option value="">Select SGST rate</option>
                    {CGST_SGST_OPTIONS.map((rate) => (
                      <option key={rate} value={rate}>{rate}%</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>CGST</label>
                  <select
                    value={formData.cgst_rate}
                    onChange={(e) => setFormData({ ...formData, cgst_rate: e.target.value })}
                    required
                  >
                    <option value="">Select CGST rate</option>
                    {CGST_SGST_OPTIONS.map((rate) => (
                      <option key={rate} value={rate}>{rate}%</option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>IGST</label>
                  <select
                    value={formData.igst_rate}
                    onChange={(e) => setFormData({ ...formData, igst_rate: e.target.value })}
                    required
                  >
                    <option value="">Select IGST rate</option>
                    {IGST_OPTIONS.map((rate) => (
                      <option key={rate} value={rate}>{rate}%</option>
                    ))}
                  </select>
                </div>
                
              </>
            )}

            {showInventoryFields && (
              <div className="form-group span-2">
                <label>LSA</label>
                <input
                  type="text"
                  value={formData.lsa}
                  onChange={(e) => setFormData({ ...formData, lsa: e.target.value })}
                  placeholder="Enter LSA"
                  autoComplete="off"
                  style={{ width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '8px' }}
                />
              </div>
            )}
            
            {!showInventoryFields && (
              <>
                <div className="form-group span-2" style={{ 
                  opacity: showSuggestions && suggestions.length > 0 ? 0.3 : 1,
                  pointerEvents: showSuggestions && suggestions.length > 0 ? 'none' : 'auto',
                  transition: 'opacity 0.2s ease'
                }}>
                  <label>
                    <span>Description</span>
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    rows="3"
                    placeholder="Enter product description. If you write specifications in the description (e.g., 'Grade: OPC 53, Compressive Strength: 53 MPa'), click 'Extract Specifications' below to automatically fill the specification fields."
                  />
                  {/* Extract Specifications Button */}
                  {formData.description && formData.description.trim() && (
                    <div style={{ marginTop: '0.5rem', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.5rem' }}>
                      {(!formData.category || !formData.category.trim()) && (
                        <span style={{ fontSize: '0.75rem', color: '#dc2626', fontStyle: 'italic' }}>
                          ⚠️ Category required for extraction
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={handleExtractSpecifications}
                        disabled={extracting || !formData.description || !formData.description.trim() || !formData.category || !formData.category.trim()}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          padding: '0.375rem 0.75rem',
                          background: extracting ? '#9ca3af' : (!formData.category || !formData.category.trim()) ? '#9ca3af' : '#10b981',
                          color: 'white',
                          border: 'none',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          fontWeight: '500',
                          cursor: extracting || !formData.description || !formData.description.trim() || !formData.category || !formData.category.trim() ? 'not-allowed' : 'pointer',
                          opacity: extracting || !formData.description || !formData.description.trim() || !formData.category || !formData.category.trim() ? 0.6 : 1,
                          transition: 'all 0.2s ease',
                          whiteSpace: 'nowrap'
                        }}
                        title={(!formData.category || !formData.category.trim()) 
                          ? "Please select a category first to extract specifications"
                          : "Extract specification key-value pairs from the description above using AI. Category and description must match."}
                      >
                        <Sparkles size={14} />
                        <span>{extracting ? 'Extracting...' : 'Extract Specifications'}</span>
                      </button>
                    </div>
                  )}
                </div>
                
                {/* Show message when category is selected but no admin specs found */}
                {formData.category && formData.category.trim() &&
                 !formData.catalogProductId &&
                 !loadingSpecs &&
                 (!specifications || Object.keys(specifications).length === 0) && 
                 (!product || (product && (product.status || 'pending') === 'pending')) && (
                  <div className="form-group span-2" style={{
                    marginTop: '1rem',
                    padding: '1rem',
                    background: '#fef3c7',
                    borderRadius: '8px',
                    border: '1px solid #fbbf24'
                  }}>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem',
                      color: '#92400e',
                      fontSize: '0.875rem'
                    }}>
                      <span>ℹ️</span>
                      <span>
                        <strong>Category "{formData.category}" selected:</strong> No pre-defined specification template found for this product/category yet.
                        You can add specification keys and values manually below, or use "Extract Specifications".
                      </span>
                    </div>
                  </div>
                )}
                
                {/* Specifications Display Section - Show keys with input fields for manual entry */}
                {(() => {
                  // Get all specification keys (we only want the keys, not values)
                  // Remove duplicates (case-insensitive) and filter out empty keys
                  const specKeys = [];
                  const seenKeys = new Set();
                  
                  Object.keys(specifications || {}).forEach(key => {
                    const keyLower = key.toLowerCase().trim();
                    // Skip if already seen (case-insensitive) or if key is empty
                    if (!seenKeys.has(keyLower) && key.trim() !== '') {
                      seenKeys.add(keyLower);
                      specKeys.push(key);
                    }
                  });
                  
                  return (
                    <div className="form-group span-2" style={{
                      marginTop: '1rem',
                      padding: '1rem',
                      background: '#f9fafb',
                      borderRadius: '8px',
                      border: '1px solid #e5e7eb'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                        <label style={{ marginBottom: 0, fontWeight: '600', color: '#1e293b', fontSize: '0.875rem' }}>
                          {isEditingSpecValues
                            ? 'Specifications - edit keys and values'
                            : 'Specifications - edit keys (values are read-only)'}
                        </label>
                        <div style={{ display: 'flex', gap: '0.45rem' }}>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setIsEditingSpecValues((prev) => !prev)}
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
                          >
                            {isEditingSpecValues ? 'Lock values' : 'Edit values'}
                          </button>
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={addSpecificationKey}
                            style={{ padding: '0.35rem 0.65rem', fontSize: '0.8rem' }}
                          >
                            + Add key
                          </button>
                        </div>
                      </div>
                      <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem',
                        maxHeight: '400px',
                        overflowY: 'auto',
                        padding: '0.5rem',
                        background: 'white',
                        borderRadius: '6px',
                        border: '1px solid #e5e7eb'
                      }}>
                        {specKeys.length === 0 && (
                          <div style={{ fontSize: '0.85rem', color: '#64748b', padding: '0.5rem' }}>
                            No keys yet. Click <strong>Add key</strong> to create specifications.
                          </div>
                        )}
                        {specKeys.map((key, index) => (
                          <div key={key} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem',
                            padding: '0.75rem',
                            background: index % 2 === 0 ? '#ffffff' : '#f9fafb',
                            borderRadius: '6px',
                            borderLeft: '3px solid #4f46e5'
                          }}>
                            <input
                              type="text"
                              defaultValue={key}
                              onBlur={(e) => renameSpecificationKey(key, e.target.value)}
                              placeholder="Specification key"
                              style={{
                                fontSize: '0.875rem',
                                color: '#1e293b',
                                fontWeight: '600',
                                minWidth: '180px',
                                maxWidth: '260px',
                                border: '1px solid #d1d5db',
                                borderRadius: '6px',
                                padding: '0.45rem 0.6rem',
                                background: 'white'
                              }}
                            />
                            {isEditingSpecValues ? (
                              <input
                                type="text"
                                value={specValueToInput(specifications[key])}
                                onChange={(e) => updateSpecificationValue(key, e.target.value)}
                                placeholder="Specification value"
                                style={{
                                  flex: '1',
                                  padding: '0.5rem 0.75rem',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '6px',
                                  fontSize: '0.875rem',
                                  color: '#1e293b',
                                  background: '#ffffff',
                                  minHeight: '36px'
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  flex: '1',
                                  padding: '0.5rem 0.75rem',
                                  border: '1px solid #d1d5db',
                                  borderRadius: '6px',
                                  fontSize: '0.875rem',
                                  color: '#1e293b',
                                  background: '#f8fafc',
                                  minHeight: '36px',
                                  display: 'flex',
                                  alignItems: 'center'
                                }}
                                title={String(specifications[key] || '')}
                              >
                                {String(specifications[key] || '').trim() || '—'}
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => removeSpecificationKey(key)}
                              className="btn-secondary"
                              style={{ padding: '0.35rem 0.6rem', fontSize: '0.78rem', color: '#b91c1c' }}
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
          
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              <Save size={16} />
              {product ? 'Update' : 'Add'} Product
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProductManagement;
