import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiUrl } from '../config/api';
import {
  Package,
  RefreshCw,
  ShoppingCart,
  Star,
  CheckCircle,
  Clock,
  X,
  AlertTriangle,
  IndianRupee,
  ClipboardList
} from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import ProductDetailModal from '../components/ProductDetailModal';
import { formatDateIST } from '../utils/dateTime';
import './AdminDashboard.css';

const VIEW_MODES = {
  products: 'products',
  orders: 'orders',
  ratings: 'ratings'
};

const formatDisplayName = (name) => {
  if (!name || typeof name !== 'string') return '—';
  const trimmed = name.trim();
  if (!trimmed) return '—';
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

const normalizeStatusClass = (status) =>
  String(status || 'pending').toLowerCase().replace(/\s+/g, '-');

const renderStatusBadge = (status) => {
  const statusClass = normalizeStatusClass(status);
  const label = String(status || 'pending').replace(/_/g, ' ');

  return (
    <span className={`status-badge ${statusClass}`}>
      {statusClass === 'delivered' || statusClass === 'completed' || statusClass === 'approved' ? (
        <CheckCircle size={14} />
      ) : statusClass === 'pending' || statusClass === 'processing' ? (
        <Clock size={14} />
      ) : statusClass === 'cancelled' || statusClass === 'rejected' ? (
        <X size={14} />
      ) : statusClass === 'confirmed' ? (
        <CheckCircle size={14} />
      ) : (
        <AlertTriangle size={14} />
      )}
      {label}
    </span>
  );
};

const renderPartyCell = (name, company) => {
  if (!name && !company) return <span className="admin-cell-muted">—</span>;

  return (
    <div className="transaction-party">
      <div className="party-name">{formatDisplayName(name)}</div>
      {company && <div className="party-company">{company}</div>}
    </div>
  );
};

const AdminSuppliers = ({ user }) => {
  const [supplierData, setSupplierData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedSuppliers, setExpandedSuppliers] = useState({});
  const [viewMode, setViewMode] = useState(VIEW_MODES.products);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [supplierRatings, setSupplierRatings] = useState({});
  const [supplierRatingsLoading, setSupplierRatingsLoading] = useState({});
  const ratingsFetchRequestedRef = useRef(new Set());

  const getSupplierId = (supplier, index) => supplier._id || supplier.id || index;

  const fetchAdminData = async () => {
    setLoading(true);
    setSupplierRatings({});
    setSupplierRatingsLoading({});
    ratingsFetchRequestedRef.current = new Set();
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/admin/dashboard'), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = await response.json();

      if (result.status === 'success') {
        setSupplierData(result.data?.supplierData || []);
      } else {
        console.error('Failed to fetch admin data:', result.message);
      }
    } catch (error) {
      console.error('Failed to fetch admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSupplierRatings = useCallback(async (supplierId) => {
    try {
      setSupplierRatingsLoading((prev) => ({ ...prev, [supplierId]: true }));
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/admin/suppliers/${supplierId}/ratings`), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = await response.json();
      if (result.status === 'success') {
        setSupplierRatings((prev) => ({
          ...prev,
          [supplierId]: result
        }));
      }
    } catch (error) {
      console.error('Failed to fetch supplier ratings:', error);
    } finally {
      setSupplierRatingsLoading((prev) => ({ ...prev, [supplierId]: false }));
    }
  }, []);

  useEffect(() => {
    fetchAdminData();
  }, []);

  useEffect(() => {
    setSelectedProduct(null);
    setSelectedSupplier(null);
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== VIEW_MODES.ratings || supplierData.length === 0) return;

    supplierData.forEach((supplier, index) => {
      const supplierId = String(getSupplierId(supplier, index));
      if (ratingsFetchRequestedRef.current.has(supplierId)) return;
      ratingsFetchRequestedRef.current.add(supplierId);
      fetchSupplierRatings(supplierId);
    });
  }, [viewMode, supplierData, fetchSupplierRatings]);

  const handleProductUpdate = () => {
    fetchAdminData();
    setSelectedProduct(null);
    setSelectedSupplier(null);
  };

  const handleViewModeChange = (mode) => {
    setViewMode(mode);
  };

  const toggleSupplier = (supplierId) => {
    setExpandedSuppliers((prev) => ({
      ...prev,
      [supplierId]: !prev[supplierId]
    }));
  };

  const renderSupplierDetails = (supplier) => (
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
  );

  const renderProductsView = () => (
    <div className="suppliers-view-panel suppliers-view-panel--cards">
      <div className="suppliers-list">
      {supplierData.map((supplier, index) => {
        const supplierId = getSupplierId(supplier, index);
        const isExpanded = expandedSuppliers[supplierId];
        const productCount = supplier.totalProducts !== undefined
          ? supplier.totalProducts
          : (supplier.products?.length || 0);

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
                  </div>
                </div>
              </div>
              <div className="expand-icon">
                {isExpanded ? '▼' : '▶'}
              </div>
            </div>

            {isExpanded && (
              <div className="supplier-expanded-content" key={`${supplierId}-products`}>
                {renderSupplierDetails(supplier)}
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
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );

  const renderOrdersView = () => {
    const ordersWithSupplier = supplierData
      .flatMap((supplier, index) =>
        (supplier.orders || []).map((order) => ({
          ...order,
          supplierId: getSupplierId(supplier, index),
          supplierName: supplier.name,
          supplierCompany: supplier.company || supplier.email
        }))
      )
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const totalAmount = ordersWithSupplier.reduce(
      (sum, order) => sum + (Number(order.totalAmount) || 0),
      0
    );
    const deliveredCount = ordersWithSupplier.filter(
      (order) => normalizeStatusClass(order.status) === 'delivered'
    ).length;

    if (ordersWithSupplier.length === 0) {
      return (
        <div className="suppliers-view-panel">
          <div className="empty-state">
            <ShoppingCart size={48} />
            <p>No orders found across suppliers</p>
          </div>
        </div>
      );
    }

    return (
      <div className="suppliers-view-panel">
        <div className="suppliers-summary-grid">
          <div className="suppliers-summary-card">
            <div className="suppliers-summary-icon orders">
              <ClipboardList size={18} />
            </div>
            <div>
              <div className="suppliers-summary-value">{ordersWithSupplier.length}</div>
              <div className="suppliers-summary-label">Total Orders</div>
            </div>
          </div>
          <div className="suppliers-summary-card">
            <div className="suppliers-summary-icon revenue">
              <IndianRupee size={18} />
            </div>
            <div>
              <div className="suppliers-summary-value">
                ₹{totalAmount.toLocaleString('en-IN')}
              </div>
              <div className="suppliers-summary-label">Order Value</div>
            </div>
          </div>
          <div className="suppliers-summary-card">
            <div className="suppliers-summary-icon delivered">
              <CheckCircle size={18} />
            </div>
            <div>
              <div className="suppliers-summary-value">{deliveredCount}</div>
              <div className="suppliers-summary-label">Delivered</div>
            </div>
          </div>
        </div>

        <div className="suppliers-data-table">
          <table>
            <thead>
              <tr>
                <th>Order Number</th>
                <th>Supplier</th>
                <th>Service Provider</th>
                <th>Items</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ordersWithSupplier.map((order, idx) => (
                <tr key={`${order.supplierId}-${order.orderNumber || idx}`}>
                  <td>
                    <span className="transaction-id">#{order.orderNumber}</span>
                  </td>
                  <td>{renderPartyCell(order.supplierName, order.supplierCompany)}</td>
                  <td>
                    {order.serviceProvider
                      ? renderPartyCell(order.serviceProvider.name, order.serviceProvider.company)
                      : <span className="admin-cell-muted">—</span>}
                  </td>
                  <td>
                    <span className="product-count-badge">{order.items || 0} items</span>
                  </td>
                  <td className="amount">
                    ₹{order.totalAmount?.toLocaleString('en-IN') || '0'}
                  </td>
                  <td className="admin-cell-date">
                    {order.createdAt ? formatDateIST(order.createdAt, '—') : '—'}
                  </td>
                  <td>{renderStatusBadge(order.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderRatingsView = () => {
    const ratingsLoading = supplierData.some((supplier, index) => {
      const supplierId = getSupplierId(supplier, index);
      return supplierRatingsLoading[supplierId];
    });

    if (ratingsLoading && Object.keys(supplierRatings).length === 0) {
      return (
        <div className="suppliers-view-panel">
          <div className="admin-loading">
            <div className="spinner" />
            <p>Loading ratings...</p>
          </div>
        </div>
      );
    }

    const ratingsWithSupplier = supplierData
      .flatMap((supplier, index) => {
        const supplierId = getSupplierId(supplier, index);
        const ratings = supplierRatings[supplierId]?.ratings || [];
        return ratings.map((rating) => ({
          ...rating,
          supplierId,
          supplierName: supplier.name,
          supplierCompany: supplier.company || supplier.email
        }));
      })
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const averageRating = ratingsWithSupplier.length > 0
      ? ratingsWithSupplier.reduce((sum, rating) => sum + (Number(rating.rating) || 0), 0)
        / ratingsWithSupplier.length
      : 0;

    if (ratingsWithSupplier.length === 0) {
      return (
        <div className="suppliers-view-panel">
          <div className="empty-state">
            <Star size={48} />
            <p>No ratings or feedback yet</p>
          </div>
        </div>
      );
    }

    return (
      <div className="suppliers-view-panel">
        <div className="suppliers-summary-grid">
          <div className="suppliers-summary-card">
            <div className="suppliers-summary-icon ratings">
              <Star size={18} />
            </div>
            <div>
              <div className="suppliers-summary-value">{ratingsWithSupplier.length}</div>
              <div className="suppliers-summary-label">Total Reviews</div>
            </div>
          </div>
          <div className="suppliers-summary-card">
            <div className="suppliers-summary-icon revenue">
              <Star size={18} />
            </div>
            <div>
              <div className="suppliers-summary-value">{averageRating.toFixed(1)} ★</div>
              <div className="suppliers-summary-label">Average Rating</div>
            </div>
          </div>
        </div>

        <div className="suppliers-data-table">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Supplier</th>
                <th>Service Provider</th>
                <th>Rating</th>
                <th>Date</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {ratingsWithSupplier.map((rating) => (
                <tr key={`${rating.supplierId}-${rating.id}`}>
                  <td>
                    <span className="transaction-id">
                      {rating.order?.order_number ? `#${rating.order.order_number}` : 'Unlinked'}
                    </span>
                  </td>
                  <td>{renderPartyCell(rating.supplierName, rating.supplierCompany)}</td>
                  <td>
                    {rating.serviceProvider
                      ? renderPartyCell(rating.serviceProvider.name, rating.serviceProvider.company)
                      : <span className="admin-cell-muted">—</span>}
                  </td>
                  <td>
                    <span className="rating-score-badge">{rating.rating} ★</span>
                  </td>
                  <td className="admin-cell-date">
                    {rating.createdAt ? formatDateIST(rating.createdAt, 'N/A') : 'N/A'}
                  </td>
                  <td className="admin-cell-feedback">
                    {rating.feedback || <span className="admin-cell-muted">No feedback</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
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
          <div className="suppliers-toolbar">
            <div className="view-mode-toggle" role="tablist" aria-label="Supplier data views">
              <button
                className={viewMode === VIEW_MODES.products ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={viewMode === VIEW_MODES.products}
                onClick={() => handleViewModeChange(VIEW_MODES.products)}
              >
                Products View
              </button>
              <button
                className={viewMode === VIEW_MODES.orders ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={viewMode === VIEW_MODES.orders}
                onClick={() => handleViewModeChange(VIEW_MODES.orders)}
              >
                Orders View
              </button>
              <button
                className={viewMode === VIEW_MODES.ratings ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={viewMode === VIEW_MODES.ratings}
                onClick={() => handleViewModeChange(VIEW_MODES.ratings)}
              >
                Ratings & Feedback
              </button>
            </div>
            <p className="suppliers-view-label">
              {viewMode === VIEW_MODES.products && 'Browse supplier products by expanding each supplier card.'}
              {viewMode === VIEW_MODES.orders && 'All orders placed with suppliers across the platform.'}
              {viewMode === VIEW_MODES.ratings && 'All ratings and feedback submitted for suppliers.'}
            </p>
          </div>

          {!supplierData || supplierData.length === 0 ? (
            <div className="empty-state">
              <Package size={48} />
              <p>No suppliers found</p>
            </div>
          ) : (
            <>
              {viewMode === VIEW_MODES.products && renderProductsView()}
              {viewMode === VIEW_MODES.orders && renderOrdersView()}
              {viewMode === VIEW_MODES.ratings && renderRatingsView()}
            </>
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
