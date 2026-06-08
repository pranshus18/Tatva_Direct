import { useState, useEffect } from 'react';
import { getApiUrl } from '../config/api';
import { 
  Package, 
  CheckCircle, 
  Clock, 
  X, 
  Ban, 
  Eye, 
  Search, 
  Filter,
  RefreshCw,
  Check,
  AlertCircle,
  Tag,
  Box,
  Building,
  Edit,
  Save,
  Sparkles,
  Plus,
  Trash2
} from 'lucide-react';
import './AdminProductStatus.css';

const IGST_OPTIONS = ['0', '5', '12', '18', '28'];
const CGST_SGST_OPTIONS = ['0', '2.5', '6', '9', '14'];

const normalizeIdPart = (value) => (value === null || value === undefined ? '' : String(value).trim());
const firstNonEmpty = (...values) => {
  for (const value of values) {
    const normalized = normalizeIdPart(value);
    if (normalized) return normalized;
  }
  return '';
};
const getProductIdentification = (product = {}) => {
  if (product.productIdentification) return String(product.productIdentification);
  const specs = product.specifications || {};
  const skuNo = firstNonEmpty(product.skuNo, product.sku_no, specs.skuNo, specs.sku_no, specs.sku, specs.SKU, specs.gsku, specs.GSKU);
  const modelBrand = firstNonEmpty(product.modelBrand, product.brandModel, product.brand_model, specs.modelBrand, specs.brandModel, specs.brand);
  const parts = [skuNo, modelBrand];
  if (parts.every((p) => !p)) return '';
  return parts.join('');
};

/** Hide legacy AI-instruction text that was saved in the description field. */
const looksLikeAiInstructions = (text) => {
  if (!text || !String(text).trim()) return false;
  const lower = String(text).toLowerCase();
  return /\b(give me|generate all|extract|list all|supplier can fill|specification keys?|ai fetch)\b/i.test(lower);
};

const getDisplayDescription = (product) => {
  const desc = product?.description;
  if (!desc || !String(desc).trim() || looksLikeAiInstructions(desc)) return '';
  return String(desc).trim();
};

const AdminProductStatus = ({ user }) => {
  const [products, setProducts] = useState([]);
  const [filteredProducts, setFilteredProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all', 'pending', 'approved', 'rejected' - default to all
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchProducts();
    
    // Check if there's a product to show from notification click
    const pendingProductData = sessionStorage.getItem('pendingProductModal');
    if (pendingProductData) {
      try {
        const { product, supplier } = JSON.parse(pendingProductData);
        if (product) {
          // Set the product to show in modal
          setSelectedProduct(product);
          // Clear the session storage
          sessionStorage.removeItem('pendingProductModal');
        }
      } catch (error) {
        console.error('Error parsing pending product data:', error);
        sessionStorage.removeItem('pendingProductModal');
      }
    }
  }, [statusFilter]); // Refetch when status filter changes

  useEffect(() => {
    filterProducts();
  }, [products, searchTerm]); // Remove statusFilter since backend handles it

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('No authentication token found');
        setProducts([]);
        setLoading(false);
        return;
      }

      // Build URL with status filter using getApiUrl
      let apiUrl = getApiUrl('/api/admin/products/all');
      if (statusFilter && statusFilter !== 'all') {
        apiUrl += `?status=${encodeURIComponent(statusFilter)}`;
      }
      
      console.log('Fetching products from:', apiUrl);
      
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        // Prevent the browser from caching inventory values.
        cache: 'no-store'
      });

      if (!response.ok) {
        let errorData = {};
        try {
          errorData = await response.json();
        } catch (e) {
          // If response is not JSON, use status text
          errorData = { message: response.statusText };
        }
        
        const errorMessage = errorData.message || errorData.error || `HTTP ${response.status}: ${response.statusText}`;
        console.error('❌ API Error:', {
          status: response.status,
          statusText: response.statusText,
          message: errorMessage,
          data: errorData
        });
        
        // Show specific error messages based on status code
        if (response.status === 401) {
          console.error('Authentication failed - redirecting to login');
          window.location.href = '/admin-login';
          return;
        } else if (response.status === 403) {
          console.error('Access denied - insufficient privileges');
          return;
        } else {
          console.error('Full error response:', errorData);
          // For 500 errors, try to use products from error response if available
          if (errorData.products && Array.isArray(errorData.products)) {
            setProducts(errorData.products);
            setLoading(false);
            return;
          }
        }
        setProducts([]);
        setLoading(false);
        return;
      }

      const data = await response.json();
      if (data.status === 'success') {
        const fetchedProducts = data.products || [];
        console.log(`✅ Fetched ${fetchedProducts.length} products from admin API (status: ${statusFilter || 'all'})`);
        setProducts(fetchedProducts);
      } else {
        console.error('API returned error status:', data);
        // Don't show alert, just use products from response if available
        setProducts(data.products || []);
      }
    } catch (error) {
      console.error('❌ Error fetching products:', error);
      console.error('Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      
      // Log error but don't show alert - just show empty state
      console.error('Network or fetch error:', error.message);
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const filterProducts = () => {
    let filtered = [...products];

    // Backend already filters by status, so we only filter by search term here
    if (searchTerm.trim()) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(product => 
        product.name?.toLowerCase().includes(searchLower) ||
        product.category?.toLowerCase().includes(searchLower) ||
        product.supplier?.name?.toLowerCase().includes(searchLower) ||
        product.supplier?.company?.toLowerCase().includes(searchLower) ||
        product.description?.toLowerCase().includes(searchLower) ||
        getProductIdentification(product).toLowerCase().includes(searchLower)
      );
    }

    // Products are already sorted by backend (newest first)
    setFilteredProducts(filtered);
  };

  const handleApprove = async (product) => {
    if (!confirm(`Are you sure you want to approve "${product.name}"?`)) return;
    
    setActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product._id || product.id;
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}/approve`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'success') {
          alert('Product approved successfully!');
          fetchProducts(); // Refresh the list
          setSelectedProduct(null);
        } else {
          alert(data.message || 'Failed to approve product');
        }
      } else {
        const data = await response.json();
        alert(data.message || 'Failed to approve product');
      }
    } catch (error) {
      console.error('Error approving product:', error);
      alert('Error approving product');
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (product) => {
    const reason = prompt(`Enter rejection reason for "${product.name}":`);
    if (!reason || !reason.trim()) return;
    
    setActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product._id || product.id;
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}/reject`), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: reason.trim() })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === 'success') {
          alert('Product rejected');
          fetchProducts(); // Refresh the list
          setSelectedProduct(null);
        } else {
          alert(data.message || 'Failed to reject product');
        }
      } else {
        const data = await response.json();
        alert(data.message || 'Failed to reject product');
      }
    } catch (error) {
      console.error('Error rejecting product:', error);
      alert('Error rejecting product');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async (product) => {
    if ((product.status || 'pending') !== 'rejected') {
      alert('Only rejected products can be deleted.');
      return;
    }

    if (!confirm(`Are you sure you want to permanently delete "${product.name}"?\n\nThis cannot be undone.`)) return;

    setActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product._id || product.id;
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}`), {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.status === 'success') {
        alert('Product deleted successfully!');
        fetchProducts();
        setSelectedProduct(null);
      } else {
        alert(data.message || 'Failed to delete product');
      }
    } catch (error) {
      console.error('Error deleting product:', error);
      alert('Error deleting product');
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusInfo = (status) => {
    const statusValue = status || 'pending';
    switch (statusValue) {
      case 'approved':
        return { 
          icon: CheckCircle, 
          color: '#059669', 
          bgColor: '#d1fae5', 
          text: 'Approved' 
        };
      case 'rejected':
        return { 
          icon: X, 
          color: '#dc2626', 
          bgColor: '#fee2e2', 
          text: 'Rejected' 
        };
      case 'pending':
      default:
        return { 
          icon: Clock, 
          color: '#d97706', 
          bgColor: '#fef3c7', 
          text: 'Pending Approval' 
        };
    }
  };

  const statusCounts = {
    all: products.length,
    pending: products.filter(p => {
      const status = p.status;
      return !status || status === 'pending' || status === '' || 
             (status !== 'approved' && status !== 'rejected');
    }).length,
    approved: products.filter(p => p.status === 'approved').length,
    rejected: products.filter(p => p.status === 'rejected').length
  };

  if (loading) {
    return (
      <div className="product-status-loading">
        <div className="spinner" />
        <p>Loading products...</p>
      </div>
    );
  }

  return (
    <div className="product-status-container">
      <div className="product-status-header">
        <div>
          <h1>Product Status Management</h1>
          <p>Review and manage all products submitted by suppliers</p>
          {statusFilter === 'pending' && (
            <p style={{ 
              marginTop: '0.5rem', 
              color: '#d97706', 
              fontSize: '0.875rem',
              fontWeight: '500'
            }}>
              ⚠️ Showing pending products that require your approval
            </p>
          )}
        </div>
        <div className="product-status-actions">
          <button 
            className="btn-refresh" 
            onClick={fetchProducts}
            disabled={loading || actionLoading}
          >
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {/* Status Summary Cards */}
      <div className="status-summary-grid">
        <div className="status-summary-card all" onClick={() => setStatusFilter('all')}>
          <div className="status-summary-icon">
            <Package size={24} />
          </div>
          <div className="status-summary-content">
            <h3>{statusCounts.all}</h3>
            <p>Total Products</p>
          </div>
        </div>
        <div className="status-summary-card pending" onClick={() => setStatusFilter('pending')}>
          <div className="status-summary-icon">
            <Clock size={24} />
          </div>
          <div className="status-summary-content">
            <h3>{statusCounts.pending}</h3>
            <p>Pending Approval</p>
          </div>
        </div>
        <div className="status-summary-card approved" onClick={() => setStatusFilter('approved')}>
          <div className="status-summary-icon">
            <CheckCircle size={24} />
          </div>
          <div className="status-summary-content">
            <h3>{statusCounts.approved}</h3>
            <p>Approved</p>
          </div>
        </div>
        <div className="status-summary-card rejected" onClick={() => setStatusFilter('rejected')}>
          <div className="status-summary-icon">
            <X size={24} />
          </div>
          <div className="status-summary-content">
            <h3>{statusCounts.rejected}</h3>
            <p>Rejected</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="product-status-filters">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search products by name, category, supplier..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <Filter size={16} />
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
            className="status-filter-select"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {/* Products List */}
      <div className="products-list-container">
        {filteredProducts.length === 0 ? (
          <div className="empty-state">
            <Package size={48} color="#94a3b8" />
            <p>No products found</p>
            <p className="empty-state-subtitle">
              {statusFilter === 'pending' 
                ? 'No pending products at the moment. All products have been reviewed or no products have been submitted yet.' 
                : searchTerm || statusFilter !== 'all' 
                ? 'Try adjusting your filters' 
                : 'No products have been submitted yet'}
            </p>
            {statusFilter === 'pending' && (
              <button 
                onClick={fetchProducts}
                style={{
                  marginTop: '1rem',
                  padding: '0.75rem 1.5rem',
                  background: '#4f46e5',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  margin: '1rem auto 0'
                }}
              >
                <RefreshCw size={16} />
                Refresh to Check for New Products
              </button>
            )}
          </div>
        ) : (
          <div className="products-grid" style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.85rem' }}>
            {filteredProducts.map((product) => {
              const statusInfo = getStatusInfo(product.status);
              const StatusIcon = statusInfo.icon;
              const supplier = product.supplier || {};

              return (
                <div
                  key={product._id || product.id}
                  className="product-card"
                  style={{ padding: '0.85rem 1rem', cursor: 'pointer' }}
                  onClick={() => setSelectedProduct(product)}
                  title="Click to view product details"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '260px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.3rem' }}>
                        <h3 className="product-name" style={{ margin: 0 }}>{product.name}</h3>
                        <span
                          className="status-badge"
                          style={{
                            background: statusInfo.bgColor,
                            color: statusInfo.color
                          }}
                        >
                          <StatusIcon size={14} />
                          {statusInfo.text}
                        </span>
                      </div>

                      <div className="product-meta" style={{ marginBottom: '0.35rem' }}>
                        <span className="meta-item">
                          <Tag size={14} />
                          {product.category || 'N/A'}
                        </span>
                        <span className="meta-item">
                          <Building size={14} />
                          {supplier.name || supplier.company || 'Unknown supplier'}
                        </span>
                        {getProductIdentification(product) && (
                          <span className="meta-item">
                            <Tag size={14} />
                            {getProductIdentification(product)}
                          </span>
                        )}
                      </div>

                      {getDisplayDescription(product) && (
                        <p className="product-description" style={{ marginBottom: 0 }}>{getDisplayDescription(product)}</p>
                      )}
                    </div>

                    <div style={{ minWidth: '170px' }}>
                      <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Price</div>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>
                        ₹{product.price?.toLocaleString('en-IN') || '0'} / {product.unit || 'unit'}
                      </div>
                    </div>

                    <div style={{ minWidth: '120px' }}>
                      <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 600 }}>Stock</div>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>
                        {product.stock || 0}
                      </div>
                    </div>

                    <div className="product-card-actions" style={{ marginLeft: 'auto' }}>
                    <button
                      className="btn-view"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedProduct(product);
                      }}
                    >
                      <Eye size={16} />
                      View Details
                    </button>
                    {product.status !== 'approved' && (
                      <button
                        className="btn-approve"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleApprove(product);
                        }}
                        disabled={actionLoading}
                      >
                        <Check size={16} />
                        Approve
                      </button>
                    )}
                    {product.status !== 'rejected' && (
                      <button
                        className="btn-reject"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReject(product);
                        }}
                        disabled={actionLoading}
                      >
                        <Ban size={16} />
                        Reject
                      </button>
                    )}
                    {product.status === 'rejected' && (
                      <button
                        className="btn-delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(product);
                        }}
                        disabled={actionLoading}
                        title="Permanently delete this rejected product"
                      >
                        <X size={16} />
                        Delete
                      </button>
                    )}
                  </div>
                  </div>

                  {product.createdAt && (
                    <div className="product-date" style={{ marginTop: '0.4rem' }}>
                      <Clock size={14} />
                      Submitted: {new Date(product.createdAt).toLocaleString()}
                    </div>
                  )}

                  {product.status === 'rejected' && product.rejectionReason && (
                    <div className="rejection-reason" style={{ marginTop: '0.4rem' }}>
                      <AlertCircle size={14} />
                      <span><strong>Rejection Reason:</strong> {product.rejectionReason}</span>
                    </div>
                  )}

                  {product.status === 'approved' && product.approvedAt && (
                    <div className="approval-date" style={{ marginTop: '0.4rem' }}>
                      <CheckCircle size={14} />
                      <span>Approved: {new Date(product.approvedAt).toLocaleString()}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Product Detail Modal */}
      {selectedProduct && (
        <ProductDetailModal
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onApprove={() => {
            handleApprove(selectedProduct);
          }}
          onReject={() => {
            handleReject(selectedProduct);
          }}
          onDelete={() => {
            handleDelete(selectedProduct);
          }}
          onUpdate={(updatedProduct) => {
            // Update the product in the list with full specifications
            const updatedProducts = products.map(p => {
              if ((p._id === updatedProduct._id || p.id === updatedProduct.id)) {
                // Merge specifications to ensure nothing is lost
                return {
                  ...updatedProduct,
                  specifications: updatedProduct.specifications || p.specifications || {}
                };
              }
              return p;
            });
            setProducts(updatedProducts);
            // Update selected product with full specifications
            const updatedSelected = {
              ...updatedProduct,
              specifications: updatedProduct.specifications || selectedProduct?.specifications || {}
            };
            setSelectedProduct(updatedSelected);
            // Refresh to get latest from server
            fetchProducts();
          }}
          actionLoading={actionLoading}
        />
      )}
    </div>
  );
};

// Product Detail Modal Component
const ProductDetailModal = ({ product, onClose, onApprove, onReject, onDelete, onUpdate, actionLoading }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isAddingNewKey, setIsAddingNewKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [editedProduct, setEditedProduct] = useState({
    name: product?.name || '',
    category: product?.category || '',
    gtin: product?.gtin || '',
    price: product?.price || '',
    unit: product?.unit || '',
    stock: product?.stock || '',
    hsnCode: product?.hsnCode || product?.hsn_code || '',
    igst_rate: product?.igst_rate != null ? String(product.igst_rate) : '',
    cgst_rate: product?.cgst_rate != null ? String(product.cgst_rate) : '',
    sgst_rate: product?.sgst_rate != null ? String(product.sgst_rate) : '',
    location: product?.location || '',
    description: product?.description || '',
    minOrderQuantity: product?.minOrderQuantity || 1,
    specifications: product?.specifications || {}
  });
  const [saving, setSaving] = useState(false);
  // AI Fetch state
  const [enhancing, setEnhancing] = useState(false);
  const [enhancingGst, setEnhancingGst] = useState(false);
  const [aiProvider, setAiProvider] = useState('auto'); // 'auto', 'openai', 'gemini', 'claude'
  const [aiEnhancePrompt, setAiEnhancePrompt] = useState('');
  const [gstAiPrompt, setGstAiPrompt] = useState('');
  const [gstSuggestion, setGstSuggestion] = useState(null);
  
  // Update editedProduct when product changes
  useEffect(() => {
    if (!isEditing) {
      setAiEnhancePrompt('');
    }
    const rawDesc = product?.description || '';
    const instructionInDescription = looksLikeAiInstructions(rawDesc);
    if (isEditing && instructionInDescription) {
      setAiEnhancePrompt(rawDesc);
    }
    setEditedProduct({
      name: product?.name || '',
      category: product?.category || '',
      gtin: product?.gtin || '',
      price: product?.price || '',
      unit: product?.unit || '',
      stock: product?.stock || '',
      hsnCode: product?.hsnCode || product?.hsn_code || '',
      igst_rate: product?.igst_rate != null ? String(product.igst_rate) : '',
      cgst_rate: product?.cgst_rate != null ? String(product.cgst_rate) : '',
      sgst_rate: product?.sgst_rate != null ? String(product.sgst_rate) : '',
      location: product?.location || '',
      description: isEditing && instructionInDescription ? '' : rawDesc,
      minOrderQuantity: product?.minOrderQuantity || 1,
      specifications: product?.specifications || {}
    });
  }, [product, isEditing]);
  
  const supplier = product.supplier || {};
  const productIdentification = getProductIdentification(product);
  const statusInfo = {
    approved: { color: '#059669', text: 'Approved' },
    pending: { color: '#d97706', text: 'Pending Approval' },
    rejected: { color: '#dc2626', text: 'Rejected' }
  };
  const status = statusInfo[product.status] || statusInfo.pending;

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const productId = product._id || product.id;
      // Prepare product data with specifications
      const productData = {
        ...editedProduct,
        description: looksLikeAiInstructions(editedProduct.description) ? '' : (editedProduct.description || ''),
        specifications: editedProduct.specifications || {},
        // Ensure category is included (it's needed for syncing specs to category)
        category: editedProduct.category || product.category
      };
      
      console.log('💾 [ADMIN SAVE] Saving product with category:', productData.category);
      console.log('💾 [ADMIN SAVE] Saving product with specs:', productData.specifications);
      console.log('💾 [ADMIN SAVE] Specs keys count:', Object.keys(productData.specifications || {}).length);
      console.log('💾 [ADMIN SAVE] Specs keys:', Object.keys(productData.specifications || {}));
      
      // IMPORTANT: Preserve null values and empty strings - they represent specification keys that need values
      // Only remove undefined values
      if (productData.specifications) {
        Object.keys(productData.specifications).forEach(key => {
          const value = productData.specifications[key];
          // Only remove undefined - keep null (for new keys), empty strings, and arrays
          if (value === undefined) {
            delete productData.specifications[key];
          }
          // Keep null values and empty strings - they represent keys that need to be filled in
        });
      }
      
      console.log('💾 [ADMIN SAVE] After cleanup - Specs keys count:', Object.keys(productData.specifications || {}).length);
      console.log('💾 [ADMIN SAVE] After cleanup - Specs:', productData.specifications);
      
      const response = await fetch(getApiUrl(`/api/admin/products/${productId}`), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(productData)
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('❌ [ADMIN SAVE] Update failed:', data);
        alert(data.message || `Failed to update product: ${data.error || 'Unknown error'}`);
        return;
      }
      
      if (data.status === 'success') {
        // Update editedProduct with the saved product data to preserve specifications
        const savedProduct = data.product || data;
        
        // Convert snake_case to camelCase for frontend
        const normalizedProduct = {
          ...savedProduct,
          minOrderQuantity: savedProduct.min_order_quantity || savedProduct.minOrderQuantity || 1
        };
        
        // Preserve all specifications, including null values (they represent keys that need to be filled)
        const updatedSpecs = normalizedProduct.specifications || editedProduct.specifications || {};
        
        // Merge any new keys from editedProduct that might not be in savedProduct
        const mergedSpecs = {
          ...updatedSpecs,
          ...(editedProduct.specifications || {})
        };
        
        const updatedProduct = {
          ...normalizedProduct,
          name: normalizedProduct.name || editedProduct.name,
          category: normalizedProduct.category || editedProduct.category,
          price: normalizedProduct.price || editedProduct.price,
          unit: normalizedProduct.unit || editedProduct.unit,
          stock: normalizedProduct.stock || editedProduct.stock,
          location: normalizedProduct.location || editedProduct.location,
          description: normalizedProduct.description || editedProduct.description,
          minOrderQuantity: normalizedProduct.minOrderQuantity || editedProduct.minOrderQuantity || 1,
          specifications: mergedSpecs
        };
        
        console.log('✅ [ADMIN SAVE] Product updated successfully:', updatedProduct);
        
        setEditedProduct(updatedProduct);
        
        // Update the product prop first, then exit edit mode
        if (onUpdate) {
          // Ensure the saved product includes all specifications
          const productToUpdate = {
            ...normalizedProduct,
            specifications: mergedSpecs
          };
          onUpdate(productToUpdate);
        }
        
        setIsEditing(false);
        alert('Product updated successfully!');
        
        // Refresh will be handled by onUpdate callback in parent component
      } else {
        console.error('❌ [ADMIN SAVE] Update failed:', data);
        alert(data.message || 'Failed to update product');
      }
    } catch (error) {
      console.error('❌ [ADMIN SAVE] Error updating product:', error);
      console.error('❌ [ADMIN SAVE] Error details:', {
        message: error.message,
        stack: error.stack
      });
      alert(`Failed to update product: ${error.message || 'Please try again.'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditedProduct({
      name: product?.name || '',
      category: product?.category || '',
      price: product?.price || '',
      unit: product?.unit || '',
      stock: product?.stock || '',
      igst_rate: product?.igst_rate != null ? String(product.igst_rate) : '',
      cgst_rate: product?.cgst_rate != null ? String(product.cgst_rate) : '',
      sgst_rate: product?.sgst_rate != null ? String(product.sgst_rate) : '',
      location: product?.location || '',
      description: product?.description || '',
      minOrderQuantity: product?.minOrderQuantity || 1,
      specifications: product?.specifications || {}
    });
  };

  const performAIGstFetch = async () => {
    const productToUse = isEditing ? editedProduct : product;
    if (!productToUse?.name) {
      alert('Please enter product name first');
      return;
    }

    setEnhancingGst(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/admin/products/ai-gst'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          productName: productToUse.name,
          category: productToUse.category || '',
          description: productToUse.description || '',
          hsnCode: productToUse.hsnCode || productToUse.hsn_code || '',
          prompt: gstAiPrompt || '',
          provider: aiProvider
        })
      });

      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to fetch GST rates');
      }

      const nextGst = {
        hsnCode: String(data.hsn_code || productToUse.hsnCode || productToUse.hsn_code || ''),
        sgst_rate: String(data.sgst_rate ?? ''),
        cgst_rate: String(data.cgst_rate ?? ''),
        igst_rate: String(data.igst_rate ?? '')
      };

      if (!isEditing) {
        setIsEditing(true);
      }

      setGstSuggestion({
        ...nextGst,
        confidenceTier: data.confidence_tier || 'medium',
        canAutoApply: Boolean(data.can_auto_apply),
        confidence: data.confidence || 'medium',
        reason: data.reason || '',
        provider: data.provider || 'auto'
      });
    } catch (error) {
      console.error('AI GST fetch error:', error);
      alert(`Failed to fetch GST rates: ${error.message}`);
    } finally {
      setEnhancingGst(false);
    }
  };

  const performAIFetch = async (productData) => {
    if (!productData.name) {
      alert('Please enter a product name first');
      return;
    }

    setEnhancing(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/admin/products/ai-enhance'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          productName: productData.name,
          category: productData.category,
          description: productData.description || '',
          prompt: aiEnhancePrompt || '',
          provider: aiProvider
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        console.error('API Error:', errorData);
        throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log('AI Fetch Response:', data);
      
      if (data.status === 'success') {
        // Show category mismatch warning if present
        if (data.categoryMismatchWarning) {
          alert(`⚠️ ${data.categoryMismatchWarning}`);
        }
        
        // Update specifications with extracted attributes and key-value pairs
        // IMPORTANT: Replace existing specs completely, don't merge - user requested exact count
        let newSpecs = {};
        if (data.specifications && Object.keys(data.specifications).length > 0) {
          // Use the specifications directly from AI (already trimmed to exact count by backend)
          newSpecs = { ...data.specifications };
          
          // Also merge extractedAttributes for backward compatibility (only if they don't conflict)
          if (data.extractedAttributes) {
            // Only add extractedAttributes if they don't already exist in specifications
            const extractedMap = {
              grade: data.extractedAttributes.grade,
              brand: data.extractedAttributes.brand,
              dimensions: data.extractedAttributes.dimensions,
              weight: data.extractedAttributes.weight,
              color: data.extractedAttributes.color,
              material: data.extractedAttributes.material,
              certification: data.extractedAttributes.certification
            };
            
            // Only add if not already present in specifications
            Object.keys(extractedMap).forEach(key => {
              const value = extractedMap[key];
              if (value && value !== '' && value !== null && !newSpecs[key]) {
                // Check if there's a similar key with different casing
                const hasSimilarKey = Object.keys(newSpecs).some(specKey => 
                  specKey.toLowerCase() === key.toLowerCase()
                );
                if (!hasSimilarKey) {
                  newSpecs[key] = value;
                }
              }
            });
          }
        } else if (data.extractedAttributes) {
          // Fallback to extracted attributes if no specifications object
          const fallbackSpecs = {
            grade: data.extractedAttributes.grade || '',
            brand: data.extractedAttributes.brand || '',
            dimensions: data.extractedAttributes.dimensions || '',
            weight: data.extractedAttributes.weight || '',
            color: data.extractedAttributes.color || '',
            material: data.extractedAttributes.material || '',
            certification: data.extractedAttributes.certification || []
          };
          
          const hasAttributes = Object.values(fallbackSpecs).some(val => 
            val !== '' && val !== null && (Array.isArray(val) ? val.length > 0 : true)
          );
          
          if (hasAttributes) {
            newSpecs = fallbackSpecs;
          }
        }
        
        // REPLACE specifications completely (don't merge with existing)
        // This ensures we get exactly the count requested by the user
        setEditedProduct(prev => ({
          ...prev,
          specifications: newSpecs
        }));
        setAiEnhancePrompt('');
        
        if (Object.keys(newSpecs).length > 0) {
          console.log('✅ Specifications received from AI:', newSpecs);
          console.log('✅ Total specification keys:', Object.keys(newSpecs).length);
        }

        const providerName = data.provider === 'openai' ? 'ChatGPT' : data.provider === 'gemini' ? 'Gemini' : data.provider === 'claude' ? 'Claude' : 'AI';
        const successMessage = data.categoryMismatchWarning 
          ? `Product description fetched successfully from ${providerName}! However, please verify that the category matches the description.`
          : `Product description fetched successfully from ${providerName}! Attributes extracted and ready to use.`;
        alert(successMessage);
      } else {
        alert(data.message || 'Failed to fetch data from AI service. Please try again.');
      }
    } catch (error) {
      console.error('AI fetch error:', error);
      alert(`Failed to fetch data from AI: ${error.message}. Please check your API keys configuration and try again.`);
    } finally {
      setEnhancing(false);
    }
  };

  const handleAIEnhance = async () => {
    // Use current product data (either editedProduct if editing, or product if not)
    const productToUse = isEditing ? editedProduct : product;
    await performAIFetch(productToUse);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content product-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-content">
            <div className="modal-title-section">
              <Package size={28} color="#4f46e5" />
              <h2 className="modal-title">{product.name}</h2>
            </div>
            <span 
              className="status-badge-modal"
              style={{ background: status.color + '20', color: status.color }}
            >
              {status.text}
            </span>
          </div>
          <button onClick={onClose} className="btn-close-modal">
            <X size={24} />
          </button>
        </div>

        <div className="modal-body">
          <div className="detail-grid">
            {productIdentification && (
              <div className="detail-item" style={{ gridColumn: 'span 2' }}>
                <label>Product Identification</label>
                <span>{productIdentification}</span>
              </div>
            )}
            <div className="detail-item">
              <label>Category</label>
              {isEditing ? (
                <input
                  type="text"
                  value={editedProduct.category}
                  onChange={(e) => setEditedProduct({...editedProduct, category: e.target.value})}
                  style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
                />
              ) : (
                <span>{product.category || 'N/A'}</span>
              )}
            </div>
            <div className="detail-item">
              <label>GTIN / UPC / EAN</label>
              {isEditing ? (
                <input
                  type="text"
                  value={editedProduct.gtin || ''}
                  onChange={(e) => setEditedProduct({ ...editedProduct, gtin: e.target.value.replace(/\s+/g, '') })}
                  placeholder="8/12/13/14 digit code"
                  inputMode="numeric"
                  autoComplete="off"
                  style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
                />
              ) : (
                <span>{product.gtin || 'N/A'}</span>
              )}
            </div>
            <div className="detail-item">
              <label>Price</label>
              {isEditing ? (
                <input
                  type="number"
                  value={editedProduct.price}
                  onChange={(e) => setEditedProduct({...editedProduct, price: e.target.value})}
                  style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
                />
              ) : (
                <span>₹{product.price?.toLocaleString('en-IN') || '0'} per {product.unit || 'unit'}</span>
              )}
            </div>
            <div className="detail-item">
              <label>Unit</label>
              {isEditing ? (
                <input
                  type="text"
                  value={editedProduct.unit}
                  onChange={(e) => setEditedProduct({...editedProduct, unit: e.target.value})}
                  style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
                />
              ) : (
                <span>{product.unit || 'unit'}</span>
              )}
            </div>
            <div className="detail-item">
              <label>Stock Available</label>
              {isEditing ? (
                <input
                  type="number"
                  value={editedProduct.stock}
                  onChange={(e) => setEditedProduct({...editedProduct, stock: e.target.value})}
                  style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
                />
              ) : (
                <span>{product.stock?.toLocaleString() || '0'} {product.unit || 'units'}</span>
              )}
            </div>
            <div className="detail-item">
              <label>HSN Code</label>
              {isEditing ? (
                <input
                  type="text"
                  value={editedProduct.hsnCode || ''}
                  onChange={(e) => setEditedProduct({ ...editedProduct, hsnCode: e.target.value })}
                  placeholder="4-8 digit HSN"
                  style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
                />
              ) : (
                <span>{product.hsnCode || product.hsn_code || 'N/A'}</span>
              )}
            </div>
            <div className="detail-item">
              <label>SGST Rate</label>
              {isEditing ? (
                <select
                  value={editedProduct.sgst_rate}
                  onChange={(e) => setEditedProduct({ ...editedProduct, sgst_rate: e.target.value })}
                  style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
                >
                  <option value="">Select SGST</option>
                  {CGST_SGST_OPTIONS.map((rate) => (
                    <option key={`sgst-${rate}`} value={rate}>{rate}%</option>
                  ))}
                </select>
              ) : (
                <span>{product.sgst_rate != null ? `${product.sgst_rate}%` : 'N/A'}</span>
              )}
            </div>
            <div className="detail-item">
              <label>CGST Rate</label>
              {isEditing ? (
                <select
                  value={editedProduct.cgst_rate}
                  onChange={(e) => setEditedProduct({ ...editedProduct, cgst_rate: e.target.value })}
                  style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
                >
                  <option value="">Select CGST</option>
                  {CGST_SGST_OPTIONS.map((rate) => (
                    <option key={`cgst-${rate}`} value={rate}>{rate}%</option>
                  ))}
                </select>
              ) : (
                <span>{product.cgst_rate != null ? `${product.cgst_rate}%` : 'N/A'}</span>
              )}
            </div>
            <div className="detail-item">
              <label>IGST Rate</label>
              {isEditing ? (
                <select
                  value={editedProduct.igst_rate}
                  onChange={(e) => setEditedProduct({ ...editedProduct, igst_rate: e.target.value })}
                  style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
                >
                  <option value="">Select IGST</option>
                  {IGST_OPTIONS.map((rate) => (
                    <option key={`igst-${rate}`} value={rate}>{rate}%</option>
                  ))}
                </select>
              ) : (
                <span>{product.igst_rate != null ? `${product.igst_rate}%` : 'N/A'}</span>
              )}
            </div>
            <div className="detail-item">
              <label>Location</label>
              {isEditing ? (
                <input
                  type="text"
                  value={editedProduct.location}
                  onChange={(e) => setEditedProduct({...editedProduct, location: e.target.value})}
                  style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
                />
              ) : (
                <span>{product.location || 'N/A'}</span>
              )}
            </div>
            {(product.minOrderQuantity || isEditing) && (
              <div className="detail-item">
                <label>Minimum Order Quantity</label>
                {isEditing ? (
                  <input
                    type="number"
                    value={editedProduct.minOrderQuantity}
                    onChange={(e) => setEditedProduct({...editedProduct, minOrderQuantity: e.target.value})}
                    style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
                  />
                ) : (
                  <span>{product.minOrderQuantity || '1'}</span>
                )}
              </div>
            )}
          </div>

          <div className="detail-item" style={{ gridColumn: 'span 2', marginTop: '1rem' }}>
            <label>Product Name</label>
            {isEditing ? (
              <input
                type="text"
                value={editedProduct.name}
                onChange={(e) => setEditedProduct({...editedProduct, name: e.target.value})}
                style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%' }}
              />
            ) : (
              <span style={{ fontSize: '1.1rem', fontWeight: '600' }}>{product.name}</span>
            )}
          </div>

          <div className="description-section">
              <h3 style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginBottom: '0.75rem',
                width: '100%'
              }}>
                <span>AI specification assistant</span>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                  marginLeft: 'auto'
                }}>
                  <select
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value)}
                    disabled={enhancing}
                    style={{
                      padding: '0.375rem 0.5rem',
                      borderRadius: '6px',
                      border: '1px solid #d1d5db',
                      fontSize: '0.75rem',
                      background: 'white',
                      cursor: enhancing ? 'not-allowed' : 'pointer',
                      minWidth: '150px'
                    }}
                    title="Select AI provider"
                  >
                    <option value="auto">Auto (Best Available)</option>
                    <option value="openai">ChatGPT</option>
                    <option value="gemini">Gemini</option>
                    <option value="claude">Claude</option>
                  </select>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!isEditing) {
                        const updatedProduct = {
                          ...product,
                          specifications: product.specifications || {}
                        };
                        setEditedProduct(updatedProduct);
                        setIsEditing(true);
                        setTimeout(() => {
                          performAIFetch(updatedProduct);
                        }, 50);
                      } else {
                        handleAIEnhance();
                      }
                    }}
                    disabled={enhancing || !product.name}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.5rem 0.875rem',
                      background: enhancing ? '#9ca3af' : '#4f46e5',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '0.875rem',
                      fontWeight: '600',
                      cursor: enhancing || !product.name ? 'not-allowed' : 'pointer',
                      opacity: enhancing || !product.name ? 0.6 : 1,
                      transition: 'all 0.2s ease',
                      whiteSpace: 'nowrap',
                      boxShadow: enhancing ? 'none' : '0 2px 4px rgba(79, 70, 229, 0.2)'
                    }}
                    title="Generate specification keys from AI (instructions are not saved on the product)"
                  >
                    <Sparkles size={16} />
                    <span>{enhancing ? 'Fetching...' : 'AI Fetch'}</span>
                  </button>
                </div>
              </h3>
              {isEditing ? (
                <>
                  <textarea
                    value={aiEnhancePrompt}
                    onChange={(e) => setAiEnhancePrompt(e.target.value)}
                    rows="3"
                    placeholder="Optional: tell AI what specification keys to generate (e.g. top 10 cement specs). This text is not saved on the product."
                    style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%', fontFamily: 'inherit' }}
                  />
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: '#64748b' }}>
                    Use AI Fetch to generate specification field names. Your instructions stay here and are not shown on product cards.
                  </p>
                </>
              ) : (
                <p style={{ margin: 0, fontSize: '0.875rem', color: '#64748b' }}>
                  Click Edit to add AI instructions, then use AI Fetch to generate specification keys.
                </p>
              )}
            </div>

          {(getDisplayDescription(product) || isEditing) && (
            <div className="description-section">
              <h3 style={{ marginBottom: '0.75rem' }}>Product description</h3>
              {isEditing ? (
                <textarea
                  value={editedProduct.description}
                  onChange={(e) => setEditedProduct({ ...editedProduct, description: e.target.value })}
                  rows="4"
                  placeholder="Optional customer-facing description for suppliers and buyers."
                  style={{ padding: '0.5rem', border: '1px solid #e5e7eb', borderRadius: '6px', width: '100%', fontFamily: 'inherit' }}
                />
              ) : (
                <p>{getDisplayDescription(product) || 'No description'}</p>
              )}
            </div>
          )}

          {isEditing && (
            <div className="description-section" style={{ marginTop: '0.5rem' }}>
              <h3 style={{ marginBottom: '0.75rem' }}>GST AI Chat</h3>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  type="text"
                  value={gstAiPrompt}
                  onChange={(e) => setGstAiPrompt(e.target.value)}
                  placeholder="Optional: add context (e.g. HSN hint, product type)"
                  style={{
                    flex: '1',
                    minWidth: '260px',
                    padding: '0.5rem 0.75rem',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px'
                  }}
                />
                <button
                  type="button"
                  onClick={performAIGstFetch}
                  disabled={enhancingGst}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.45rem',
                    padding: '0.5rem 0.875rem',
                    background: enhancingGst ? '#9ca3af' : '#0f766e',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    fontSize: '0.85rem',
                    fontWeight: '600',
                    cursor: enhancingGst ? 'not-allowed' : 'pointer'
                  }}
                >
                  <Sparkles size={15} />
                  {enhancingGst ? 'Fetching GST...' : 'AI Fill GST'}
                </button>
              </div>
              <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
                This chat fills supplier GST keys from admin using your configured AI keys.
              </p>
              {gstSuggestion && (
                <div style={{
                  marginTop: '0.65rem',
                  padding: '0.65rem 0.75rem',
                  border: '1px solid #99f6e4',
                  background: '#f0fdfa',
                  borderRadius: '8px'
                }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#0f766e' }}>
                    Suggested HSN/GST: HSN {gstSuggestion.hsnCode || 'N/A'} | SGST {gstSuggestion.sgst_rate}% | CGST {gstSuggestion.cgst_rate}% | IGST {gstSuggestion.igst_rate}%
                  </div>
                  <div style={{ marginTop: '0.25rem', fontSize: '0.78rem', color: '#334155' }}>
                    Tier: {gstSuggestion.confidenceTier} | {' '}
                    Confidence: {gstSuggestion.confidence}
                    {gstSuggestion.reason ? ` - ${gstSuggestion.reason}` : ''}
                  </div>
                  <div style={{ marginTop: '0.55rem', display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      disabled={!gstSuggestion.canAutoApply}
                      onClick={() => {
                        setEditedProduct((prev) => ({
                          ...prev,
                          hsnCode: gstSuggestion.hsnCode || prev.hsnCode || '',
                          sgst_rate: gstSuggestion.sgst_rate,
                          cgst_rate: gstSuggestion.cgst_rate,
                          igst_rate: gstSuggestion.igst_rate
                        }));
                        setGstSuggestion(null);
                      }}
                      style={{
                        padding: '0.4rem 0.65rem',
                        borderRadius: '6px',
                        border: 'none',
                        background: gstSuggestion.canAutoApply ? '#0f766e' : '#94a3b8',
                        color: 'white',
                        fontWeight: '600',
                        cursor: gstSuggestion.canAutoApply ? 'pointer' : 'not-allowed'
                      }}
                    >
                      {gstSuggestion.canAutoApply ? 'Use Suggested HSN + GST' : 'Review Required (Not Auto-Applicable)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setGstSuggestion(null)}
                      style={{
                        padding: '0.4rem 0.65rem',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: 'white',
                        color: '#334155',
                        fontWeight: '600',
                        cursor: 'pointer'
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Always show specifications section if there are any specs or if editing */}
          {((product.specifications && Object.keys(product.specifications).length > 0) || 
            (editedProduct.specifications && Object.keys(editedProduct.specifications).length > 0) || 
            isEditing) ? (
            <div className="specifications-section">
              <h3>Specifications {isEditing && <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 'normal' }}>(from AI) - Enter values manually</span>}</h3>
              {isEditing ? (
                <div 
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem',
                    padding: '0.5rem',
                    background: 'white',
                    borderRadius: '6px',
                    border: '1px solid #e5e7eb',
                    maxHeight: '400px',
                    overflowY: 'auto'
                  }}
                >
                  {(() => {
                    const specs = editedProduct.specifications || {};
                    const specKeys = Object.keys(specs).filter(key => key && key.trim() !== '');
                    
                    if (specKeys.length === 0) {
                      return (
                        <p style={{ color: '#64748b', fontSize: '0.875rem', fontStyle: 'italic', margin: 0, padding: '1rem', textAlign: 'center' }}>
                          No specifications available. Click 'AI Fetch' in the Description section to generate specification keys.
                        </p>
                      );
                    }
                    
                    return (
                      <>
                        {specKeys.map((key, index) => {
                      const currentValue = specs[key] !== undefined && specs[key] !== null ? String(specs[key]) : '';
                      
                      return (
                        <div 
                          key={`spec-${key}-${index}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '1rem',
                            padding: '0.75rem',
                            background: index % 2 === 0 ? '#ffffff' : '#f9fafb',
                            borderRadius: '6px',
                            borderLeft: '3px solid #4f46e5'
                          }}
                        >
                          <label 
                            htmlFor={`spec-input-${key}-${index}`}
                            style={{
                              fontSize: '0.875rem',
                              color: '#1e293b',
                              fontWeight: '600',
                              minWidth: '180px',
                              flexShrink: 0,
                              textTransform: 'uppercase'
                            }}
                          >
                            {key}:
                          </label>
                          <input
                            id={`spec-input-${key}-${index}`}
                            type="text"
                            value={currentValue}
                            onChange={(e) => {
                              const newValue = e.target.value;
                              setEditedProduct({
                                ...editedProduct,
                                specifications: {
                                  ...(editedProduct.specifications || {}),
                                  [key]: newValue
                                }
                              });
                            }}
                            placeholder={`Enter ${key.toLowerCase()} value`}
                            style={{
                              flex: '1',
                              padding: '0.5rem 0.75rem',
                              border: '1px solid #d1d5db',
                              borderRadius: '6px',
                              fontSize: '0.875rem',
                              color: '#1e293b',
                              background: 'white'
                            }}
                          />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const updatedSpecs = { ...(editedProduct.specifications || {}) };
                                  delete updatedSpecs[key];
                                  setEditedProduct({
                                    ...editedProduct,
                                    specifications: updatedSpecs
                                  });
                                }}
                                style={{
                                  padding: '0.375rem',
                                  background: '#ef4444',
                                  color: 'white',
                                  border: 'none',
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                  transition: 'all 0.2s ease'
                                }}
                                title="Remove this specification"
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = '#dc2626';
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = '#ef4444';
                                }}
                              >
                                <Trash2 size={14} />
                              </button>
                        </div>
                      );
                        })}
                        
                        {/* Add new key form */}
                        {isAddingNewKey ? (
                          <div 
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '1rem',
                              padding: '0.75rem',
                              background: '#f0f9ff',
                              borderRadius: '6px',
                              borderLeft: '3px solid #10b981',
                              border: '2px solid #10b981'
                            }}
                          >
                            <input
                              type="text"
                              value={newKeyName}
                              onChange={(e) => {
                                e.stopPropagation();
                                setNewKeyName(e.target.value);
                              }}
                              placeholder="Specification key name"
                              style={{
                                minWidth: '180px',
                                padding: '0.5rem 0.75rem',
                                border: '1px solid #10b981',
                                borderRadius: '6px',
                                fontSize: '0.875rem',
                                fontWeight: '600',
                                textTransform: 'uppercase',
                                background: 'white'
                              }}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (newKeyName.trim()) {
                                    const updatedSpecs = {
                                      ...(editedProduct.specifications || {}),
                                      [newKeyName.trim()]: newKeyValue.trim()
                                    };
                                    setEditedProduct({
                                      ...editedProduct,
                                      specifications: updatedSpecs
                                    });
                                    setNewKeyName('');
                                    setNewKeyValue('');
                                    setIsAddingNewKey(false);
                                  }
                                } else if (e.key === 'Escape') {
                                  setIsAddingNewKey(false);
                                  setNewKeyName('');
                                  setNewKeyValue('');
                                }
                              }}
                              autoFocus
                            />
                            <input
                              type="text"
                              value={newKeyValue}
                              onChange={(e) => {
                                e.stopPropagation();
                                setNewKeyValue(e.target.value);
                              }}
                              placeholder="Value (optional)"
                              style={{
                                flex: '1',
                                padding: '0.5rem 0.75rem',
                                border: '1px solid #10b981',
                                borderRadius: '6px',
                                fontSize: '0.875rem',
                                background: 'white'
                              }}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  if (newKeyName.trim()) {
                                    const updatedSpecs = {
                                      ...(editedProduct.specifications || {}),
                                      [newKeyName.trim()]: newKeyValue.trim()
                                    };
                                    setEditedProduct({
                                      ...editedProduct,
                                      specifications: updatedSpecs
                                    });
                                    setNewKeyName('');
                                    setNewKeyValue('');
                                    setIsAddingNewKey(false);
                                  }
                                } else if (e.key === 'Escape') {
                                  setIsAddingNewKey(false);
                                  setNewKeyName('');
                                  setNewKeyValue('');
                                }
                              }}
                            />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (newKeyName.trim()) {
                                  // Use null for empty values to represent keys that need values
                                  const value = newKeyValue.trim() || null;
                                  const updatedSpecs = {
                                    ...(editedProduct.specifications || {}),
                                    [newKeyName.trim()]: value
                                  };
                                  setEditedProduct({
                                    ...editedProduct,
                                    specifications: updatedSpecs
                                  });
                                  setNewKeyName('');
                                  setNewKeyValue('');
                                  setIsAddingNewKey(false);
                                }
                              }}
                              style={{
                                padding: '0.5rem',
                                background: '#10b981',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                              }}
                              title="Add specification"
                            >
                              <Check size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setIsAddingNewKey(false);
                                setNewKeyName('');
                                setNewKeyValue('');
                              }}
                              style={{
                                padding: '0.5rem',
                                background: '#6b7280',
                                color: 'white',
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                              }}
                              title="Cancel"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsAddingNewKey(true);
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.5rem',
                              padding: '0.75rem',
                              background: '#f0f9ff',
                              border: '2px dashed #4f46e5',
                              borderRadius: '6px',
                              color: '#4f46e5',
                              cursor: 'pointer',
                              fontSize: '0.875rem',
                              fontWeight: '600',
                              transition: 'all 0.2s ease'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = '#e0e7ff';
                              e.currentTarget.style.borderColor = '#6366f1';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = '#f0f9ff';
                              e.currentTarget.style.borderColor = '#4f46e5';
                            }}
                          >
                            <Plus size={16} />
                            <span>Add New Specification Key</span>
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              ) : (
                <div className="specifications-grid">
                  {Object.entries(product.specifications || {}).map(([key, value]) => {
                    // Show all keys, even if value is null or empty
                    const displayValue = value !== null && value !== undefined && value !== '' 
                      ? (Array.isArray(value) ? value.join(', ') : String(value))
                      : '(Not set)';
                    const hasValue = value !== null && value !== '' && value !== undefined &&
                                   !(Array.isArray(value) && value.length === 0);
                    
                    return (
                      <div key={key} className="spec-item" style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '0.625rem 0.75rem',
                        background: '#f9fafb',
                        borderRadius: '4px',
                        borderLeft: '3px solid #4f46e5',
                        marginBottom: '0.5rem'
                      }}>
                        <span style={{
                          fontSize: '0.875rem',
                          color: '#64748b',
                          fontWeight: '600',
                          textTransform: 'uppercase'
                        }}>
                          {key}:
                        </span>
                        <span style={{
                          fontSize: '0.875rem',
                          color: hasValue ? '#1e293b' : '#9ca3af',
                          fontWeight: hasValue ? '500' : '400',
                          fontStyle: hasValue ? 'normal' : 'italic'
                        }}>
                          {displayValue}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}

          <div className="supplier-section">
            <h3>Supplier Information</h3>
            <div className="supplier-info-card">
              <div className="supplier-avatar">
                {(supplier.name || 'S').charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="supplier-name">{supplier.name || 'Unknown'}</div>
                <div className="supplier-company">{supplier.company || supplier.email || 'N/A'}</div>
                {supplier.email && <div className="supplier-email">{supplier.email}</div>}
              </div>
            </div>
          </div>

          {product.status === 'rejected' && product.rejectionReason && (
            <div className="rejection-section">
              <h3>Rejection Information</h3>
              <div className="rejection-reason-box">
                <AlertCircle size={20} />
                <p>{product.rejectionReason}</p>
              </div>
            </div>
          )}

          {product.status === 'approved' && product.approvedAt && (
            <div className="approval-section">
              <h3>Approval Information</h3>
              <div className="approval-info-box">
                <CheckCircle size={20} />
                <p>Approved on {new Date(product.approvedAt).toLocaleString()}</p>
              </div>
            </div>
          )}

          {product.createdAt && (
            <div className="date-section">
              <p><strong>Submitted:</strong> {new Date(product.createdAt).toLocaleString()}</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {isEditing ? (
            <>
              <button
                className="btn-approve-modal"
                onClick={handleSave}
                disabled={saving || actionLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Save size={16} />
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                className="btn-close-modal-footer"
                onClick={handleCancel}
                disabled={saving || actionLoading}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                className="btn-view-details"
                onClick={() => setIsEditing(true)}
                disabled={actionLoading}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#3b82f6', color: 'white' }}
              >
                <Edit size={16} />
                Edit Product
              </button>
              {product.status !== 'approved' && (
                <button
                  className="btn-approve-modal"
                  onClick={onApprove}
                  disabled={actionLoading}
                >
                  <Check size={16} />
                  Approve Product
                </button>
              )}
              {product.status !== 'rejected' && (
                <button
                  className="btn-reject-modal"
                  onClick={onReject}
                  disabled={actionLoading}
                >
                  <Ban size={16} />
                  Reject Product
                </button>
              )}
              {product.status === 'rejected' && (
                <button
                  className="btn-delete-modal"
                  onClick={onDelete}
                  disabled={actionLoading}
                  title="Permanently delete this rejected product"
                >
                  <X size={16} />
                  Delete Product
                </button>
              )}
              <button
                className="btn-close-modal-footer"
                onClick={onClose}
                disabled={actionLoading}
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminProductStatus;
