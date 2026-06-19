import { useState, useEffect } from 'react';
import { getApiUrl } from '../config/api';
import { 
  Package, 
  RefreshCw,
  Building
} from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import ProductDetailModal from '../components/ProductDetailModal';
import { formatDateIST } from '../utils/dateTime';
import './AdminDashboard.css';

const AdminSuppliers = ({ user }) => {
  const [supplierData, setSupplierData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedSuppliers, setExpandedSuppliers] = useState({});
  const [viewMode, setViewMode] = useState('products');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [supplierRatings, setSupplierRatings] = useState({});
  const [supplierRatingsLoading, setSupplierRatingsLoading] = useState({});

  useEffect(() => {
    fetchAdminData();
  }, []);

  // Prevent any open product detail modal from covering the tab content
  // when switching between Products/Orders/Ratings tabs.
  useEffect(() => {
    setSelectedProduct(null);
    setSelectedSupplier(null);
  }, [viewMode]);

  // When switching into Ratings view, ensure we fetch ratings for any
  // suppliers that are already expanded. Without this, the UI may show
  // "No ratings yet" even when ratings exist.
  useEffect(() => {
    if (viewMode !== 'ratings') return;

    const expandedIds = Object.keys(expandedSuppliers || {}).filter((sid) => expandedSuppliers[sid]);
    if (expandedIds.length === 0) return;

    for (const sid of expandedIds) {
      if (!supplierRatings[sid] && !supplierRatingsLoading[sid]) {
        fetchSupplierRatings(sid);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, expandedSuppliers]);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/admin/dashboard'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const result = await response.json();
      
      if (result.status === 'success') {
        const data = result.data;
        setSupplierData(data.supplierData || []);
      } else {
        console.error('Failed to fetch admin data:', result.message);
      }
    } catch (error) {
      console.error('Failed to fetch admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleProductUpdate = () => {
    fetchAdminData();
    setSelectedProduct(null);
    setSelectedSupplier(null);
  };

  const toggleSupplier = (supplierId) => {
    setExpandedSuppliers(prev => ({
      ...prev,
      [supplierId]: !prev[supplierId]
    }));

    // If switching to ratings view and we don't yet have ratings for this supplier, fetch them
    if (!expandedSuppliers[supplierId] && viewMode === 'ratings' && !supplierRatings[supplierId]) {
      fetchSupplierRatings(supplierId);
    }
  };

  const fetchSupplierRatings = async (supplierId) => {
    try {
      setSupplierRatingsLoading(prev => ({ ...prev, [supplierId]: true }));
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/admin/suppliers/${supplierId}/ratings`), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const result = await response.json();
      if (result.status === 'success') {
        setSupplierRatings(prev => ({
          ...prev,
          [supplierId]: result
        }));
      }
    } catch (error) {
      console.error('Failed to fetch supplier ratings:', error);
    } finally {
      setSupplierRatingsLoading(prev => ({ ...prev, [supplierId]: false }));
    }
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <div className="spinner" />
        <p>Loading suppliers...</p>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <h1>Suppliers Management</h1>
          <p>View and manage all suppliers and their products</p>
        </div>
        <div className="admin-actions">
          <AdminNotifications />
          <button 
            className="btn-refresh" 
            onClick={fetchAdminData}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            Refresh Data
          </button>
          <div className="admin-user-info">
            <span>Welcome, {user?.name}</span>
            <div className="admin-badge">Admin</div>
          </div>
        </div>
      </div>

      <div className="admin-content">
        <div className="suppliers-content">
          <div className="suppliers-header-controls">
            <div className="view-mode-toggle">
              <button 
                className={viewMode === 'products' ? 'active' : ''}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setViewMode('products');
                }}
              >
                Products View
              </button>
              <button 
                className={viewMode === 'orders' ? 'active' : ''}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setViewMode('orders');
                }}
              >
                Orders View
              </button>
              <button 
                className={viewMode === 'ratings' ? 'active' : ''}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setViewMode('ratings');
                }}
              >
                Ratings & Feedback
              </button>
            </div>
          </div>
          
          {!supplierData || supplierData.length === 0 ? (
            <div className="empty-state">
              <Package size={48} />
              <p>No suppliers found</p>
            </div>
          ) : (
            <div className="suppliers-list">
              {supplierData.map((supplier, index) => {
                const supplierId = supplier._id || supplier.id || index;
                const isExpanded = expandedSuppliers[supplierId];
                // Use totalProducts if available, otherwise use products array length
                const productCount = supplier.totalProducts !== undefined 
                  ? supplier.totalProducts 
                  : (supplier.products?.length || 0);
                const orderCount = supplier.orders?.length || 0;
                const totalRevenue = supplier.totalRevenue || 0;
                const activeOrders = supplier.activeOrders || 0;
                const averageRating = supplier.averageRating || 0;
                const totalReviews = supplier.totalReviews || 0;
                
                return (
                  <div key={supplierId} className="supplier-card">
                    <div 
                      className="supplier-header"
                      onClick={() => toggleSupplier(supplierId)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div className="supplier-info">
                        <div className="supplier-avatar">
                          {(supplier.name || 'S').charAt(0).toUpperCase()}
                        </div>
                        <div className="supplier-details">
                          <div className="supplier-name">{supplier.name}</div>
                          <div className="supplier-company">{supplier.company || supplier.email}</div>
                          <div className="supplier-meta">
                            <span>{productCount} product{productCount !== 1 ? 's' : ''}</span>
                            <span>•</span>
                            <span>{orderCount} order{orderCount !== 1 ? 's' : ''}</span>
                            <span>•</span>
                            <span>₹{totalRevenue.toLocaleString('en-IN')} revenue</span>
                          {totalReviews > 0 && (
                            <>
                              <span>•</span>
                              <span>{averageRating.toFixed(1)} ★ ({totalReviews} review{totalReviews !== 1 ? 's' : ''})</span>
                            </>
                          )}
                            {supplier.serviceProvidersWorkedWith > 0 && (
                              <>
                                <span>•</span>
                                <span>{supplier.serviceProvidersWorkedWith} SP{supplier.serviceProvidersWorkedWith !== 1 ? 's' : ''}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="supplier-stats">
                        <div className="stat-item">
                          <span className="stat-label">Active Orders</span>
                          <span className="stat-value">{activeOrders}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">Inventory Value</span>
                          <span className="stat-value">₹{(supplier.totalInventoryValue || 0).toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                      <div className="expand-icon">
                        {isExpanded ? '▼' : '▶'}
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="supplier-expanded-content">
                        <div
                          style={{
                            marginBottom: '1rem',
                            padding: '0.9rem 1rem',
                            border: '1px solid #e5e7eb',
                            borderRadius: '10px',
                            background: '#f8fafc'
                          }}
                        >
                          <h4 style={{ margin: '0 0 0.65rem', fontSize: '0.95rem' }}>Supplier Details</h4>
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                              gap: '0.55rem 0.9rem',
                              fontSize: '0.88rem'
                            }}
                          >
                            <div><strong>Name:</strong> {supplier.name || '-'}</div>
                            <div><strong>Company:</strong> {supplier.company || '-'}</div>
                            <div><strong>Email:</strong> {supplier.email || '-'}</div>
                            <div><strong>Phone:</strong> {supplier.phone || '-'}</div>
                            <div><strong>GSTIN:</strong> {supplier.gstin || supplier.mainGstin || '-'}</div>
                            <div><strong>Address:</strong> {supplier.address || supplier.line1 || '-'}</div>
                            <div><strong>City:</strong> {supplier.city || '-'}</div>
                            <div><strong>State:</strong> {supplier.state || '-'}</div>
                          </div>
                        </div>
                        {viewMode === 'products' ? (
                          <>
                            <h4>Products ({productCount})</h4>
                            {supplier.products && supplier.products.length > 0 ? (
                              <div className="supplier-products">
                                {supplier.products.map((product) => (
                                  <div 
                                    key={product.id || product._id} 
                                    className="product-item"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedProduct(product);
                                      setSelectedSupplier(supplier);
                                    }}
                                  >
                                    <div className="product-item-main">
                                      <span className="product-name">{product.name}</span>
                                      <span className="product-category">{product.category}</span>
                                    </div>
                                    <div className="product-item-details">
                                      <span className="product-price">₹{product.price.toLocaleString('en-IN')}/{product.unit}</span>
                                      <span className="product-stock">Stock: {product.stock}</span>
                                      <span className={`product-status-badge status-${product.status || 'pending'}`}>
                                        {product.status || 'pending'}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="supplier-products-empty">
                                <p>No products available</p>
                              </div>
                            )}
                          </>
                        ) : viewMode === 'orders' ? (
                          <>
                            <h4>Orders ({orderCount})</h4>
                            {supplier.orders && supplier.orders.length > 0 ? (
                              <div className="supplier-orders">
                                {supplier.orders.map((order, idx) => (
                                  <div key={order.orderNumber || idx} className="order-item">
                                    <div className="order-item-header">
                                      <span className="order-number">#{order.orderNumber}</span>
                                      <span className={`status-badge ${order.status}`}>
                                        {order.status}
                                      </span>
                                    </div>
                                    <div className="order-item-details">
                                      {order.serviceProvider && (
                                        <div className="order-service-provider">
                                          <strong>Service Provider:</strong> {order.serviceProvider.name} 
                                          {order.serviceProvider.company && ` (${order.serviceProvider.company})`}
                                        </div>
                                      )}
                                      <div className="order-amount">
                                        <strong>Amount:</strong> ₹{order.totalAmount?.toLocaleString('en-IN') || '0'}
                                      </div>
                                      <div className="order-items">
                                        <strong>Items:</strong> {order.items || 0}
                                      </div>
                                      {order.createdAt && (
                                        <div className="order-date">
                                          <strong>Date:</strong> {formatDateIST(order.createdAt, '—')}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="supplier-orders-empty">
                                <p>No orders found</p>
                              </div>
                            )}
                          </>
                        ) : (
                          <>
                            <h4>Ratings & Feedback</h4>
                            {supplierRatingsLoading[supplierId] && (
                              <div className="admin-loading">
                                <div className="spinner" />
                                <p>Loading ratings...</p>
                              </div>
                            )}
                            {!supplierRatingsLoading[supplierId] && (!supplierRatings[supplierId] || (supplierRatings[supplierId]?.ratings || []).length === 0) && (
                              <div className="supplier-orders-empty">
                                <p>No ratings yet for this supplier.</p>
                              </div>
                            )}
                            {!supplierRatingsLoading[supplierId] && supplierRatings[supplierId] && (
                              <div className="supplier-orders">
                                {(supplierRatings[supplierId].ratings || []).map((r) => (
                                  <div key={r.id} className="order-item">
                                    <div className="order-item-header">
                                      <span className="order-number">
                                        {r.order?.order_number ? `#${r.order.order_number}` : 'Unlinked Order'}
                                      </span>
                                      <span className="status-badge">
                                        {`${r.rating} ★`}
                                      </span>
                                    </div>
                                    <div className="order-item-details">
                                      {r.serviceProvider && (
                                        <div className="order-service-provider">
                                          <strong>Service Provider:</strong> {r.serviceProvider.name}
                                          {r.serviceProvider.company && ` (${r.serviceProvider.company})`}
                                        </div>
                                      )}
                                      {r.order && (
                                        <div className="order-amount">
                                          <strong>Order Amount:</strong> ₹{(r.order.total_amount || 0).toLocaleString('en-IN')}
                                        </div>
                                      )}
                                      <div className="order-date">
                                        <strong>Rated On:</strong>{' '}
                                        {r.createdAt ? formatDateIST(r.createdAt, 'N/A') : 'N/A'}
                                      </div>
                                      {r.feedback && (
                                        <div style={{ marginTop: '0.5rem', color: '#4b5563', fontSize: '0.9rem' }}>
                                          <strong>Feedback:</strong> {r.feedback}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selectedProduct && (
        <ProductDetailModal 
          product={selectedProduct}
          supplier={selectedSupplier}
          onClose={() => {
            setSelectedProduct(null);
            setSelectedSupplier(null);
          }}
          onUpdate={handleProductUpdate}
        />
      )}
    </div>
  );
};

export default AdminSuppliers;
