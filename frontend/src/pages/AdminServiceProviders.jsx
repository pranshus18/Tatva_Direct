import { useState, useEffect } from 'react';
import { getApiUrl } from '../config/api';
import {
  Building,
  RefreshCw,
  ShoppingCart,
  CheckCircle,
  Clock,
  X,
  AlertTriangle,
  IndianRupee,
  ClipboardList
} from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import { formatDateIST } from '../utils/dateTime';
import './AdminDashboard.css';

const VIEW_MODES = {
  boqs: 'boqs',
  orders: 'orders'
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

const AdminServiceProviders = ({ user }) => {
  const [serviceProviderData, setServiceProviderData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedProviders, setExpandedProviders] = useState({});
  const [viewMode, setViewMode] = useState(VIEW_MODES.boqs);

  const getProviderId = (provider, index) => provider._id || provider.id || index;

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/admin/dashboard'), {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = await response.json();

      if (result.status === 'success') {
        setServiceProviderData(result.data?.serviceProviderData || []);
      } else {
        console.error('Failed to fetch admin data:', result.message);
      }
    } catch (error) {
      console.error('Failed to fetch admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleProvider = (providerId) => {
    setExpandedProviders((prev) => ({
      ...prev,
      [providerId]: !prev[providerId]
    }));
  };

  const renderBoqsView = () => (
    <div className="suppliers-view-panel suppliers-view-panel--cards">
      <div className="providers-list">
        {serviceProviderData.map((provider, index) => {
          const providerId = getProviderId(provider, index);
          const isExpanded = expandedProviders[providerId];
          const boqCount = provider.boqs?.length || 0;

          return (
            <div key={providerId} className="provider-card">
              <div
                className="provider-header"
                onClick={() => toggleProvider(providerId)}
                style={{ cursor: 'pointer' }}
              >
                <div className="provider-info">
                  <div className="provider-avatar">
                    {(provider.name || 'SP').charAt(0).toUpperCase()}
                  </div>
                  <div className="provider-details">
                    <div className="provider-name">{provider.name}</div>
                    <div className="provider-company">{provider.company || provider.email}</div>
                    <div className="provider-meta">
                      <span>{boqCount} BOQ{boqCount !== 1 ? 's' : ''}</span>
                      <span>•</span>
                      <span>{provider.orders?.length || 0} order{(provider.orders?.length || 0) !== 1 ? 's' : ''}</span>
                      <span>•</span>
                      <span>₹{(provider.totalSpent || 0).toLocaleString('en-IN')} spent</span>
                    </div>
                  </div>
                </div>
                <div className="expand-icon">
                  {isExpanded ? '▼' : '▶'}
                </div>
              </div>

              {isExpanded && (
                <div className="provider-expanded-content" key={`${providerId}-boqs`}>
                  <h4>BOQs ({boqCount})</h4>
                  {provider.boqs && provider.boqs.length > 0 ? (
                    <div className="provider-boqs">
                      {provider.boqs.map((boq, idx) => (
                        <div key={boq._id || boq.id || idx} className="boq-item">
                          <div className="boq-item-header">
                            <span className="boq-name">{boq.name}</span>
                            {renderStatusBadge(boq.status)}
                          </div>
                          <div className="boq-item-details">
                            {boq.description && (
                              <div className="boq-description">{boq.description}</div>
                            )}
                            <div className="boq-stats">
                              <span>Items: {boq.itemCount || 0}</span>
                              <span>•</span>
                              <span>Value: ₹{(boq.totalValue || 0).toLocaleString('en-IN')}</span>
                              {boq.createdAt && (
                                <>
                                  <span>•</span>
                                  <span>Created: {formatDateIST(boq.createdAt, '—')}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="provider-boqs-empty">
                      <p>No BOQs found for this service provider</p>
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
    const ordersWithProvider = serviceProviderData
      .flatMap((provider, index) =>
        (provider.orders || []).map((order) => ({
          ...order,
          providerId: getProviderId(provider, index),
          providerName: provider.name,
          providerCompany: provider.company || provider.email
        }))
      )
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    const totalAmount = ordersWithProvider.reduce(
      (sum, order) => sum + (Number(order.totalAmount) || 0),
      0
    );
    const deliveredCount = ordersWithProvider.filter(
      (order) => normalizeStatusClass(order.status) === 'delivered'
    ).length;

    if (ordersWithProvider.length === 0) {
      return (
        <div className="suppliers-view-panel">
          <div className="empty-state">
            <ShoppingCart size={48} />
            <p>No orders found across service providers</p>
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
              <div className="suppliers-summary-value">{ordersWithProvider.length}</div>
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
              <div className="suppliers-summary-label">Total Spent</div>
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
                <th>Service Provider</th>
                <th>Supplier</th>
                <th>Items</th>
                <th>Amount</th>
                <th>Date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ordersWithProvider.map((order, idx) => (
                <tr key={`${order.providerId}-${order.orderNumber || idx}`}>
                  <td>
                    <span className="transaction-id">#{order.orderNumber}</span>
                  </td>
                  <td>{renderPartyCell(order.providerName, order.providerCompany)}</td>
                  <td>
                    {order.supplier
                      ? renderPartyCell(order.supplier.name, order.supplier.company)
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

  if (loading) {
    return (
      <div className="admin-loading">
        <div className="spinner" />
        <p>Loading service providers...</p>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <h1>Service Providers Management</h1>
          <p>View and manage all service providers, BOQs, and orders</p>
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
        <div className="service-providers-content">
          <div className="suppliers-toolbar">
            <div className="view-mode-toggle" role="tablist" aria-label="Service provider data views">
              <button
                className={viewMode === VIEW_MODES.boqs ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={viewMode === VIEW_MODES.boqs}
                onClick={() => setViewMode(VIEW_MODES.boqs)}
              >
                BOQs View
              </button>
              <button
                className={viewMode === VIEW_MODES.orders ? 'active' : ''}
                type="button"
                role="tab"
                aria-selected={viewMode === VIEW_MODES.orders}
                onClick={() => setViewMode(VIEW_MODES.orders)}
              >
                Orders View
              </button>
            </div>
            <p className="suppliers-view-label">
              {viewMode === VIEW_MODES.boqs
                ? 'Browse BOQs by expanding each service provider card.'
                : 'All orders placed by service providers across the platform.'}
            </p>
          </div>

          {!serviceProviderData || serviceProviderData.length === 0 ? (
            <div className="empty-state">
              <Building size={48} />
              <p>No service providers found</p>
            </div>
          ) : (
            <>
              {viewMode === VIEW_MODES.boqs && renderBoqsView()}
              {viewMode === VIEW_MODES.orders && renderOrdersView()}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminServiceProviders;
