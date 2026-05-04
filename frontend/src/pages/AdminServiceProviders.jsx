import { useState, useEffect } from 'react';
import { getApiUrl } from '../config/api';
import { 
  Building, 
  RefreshCw
} from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import './AdminDashboard.css';

const AdminServiceProviders = ({ user }) => {
  const [serviceProviderData, setServiceProviderData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedProviders, setExpandedProviders] = useState({});
  const [viewMode, setViewMode] = useState('boqs');

  useEffect(() => {
    fetchAdminData();
  }, []);

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
        setServiceProviderData(data.serviceProviderData || []);
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
    setExpandedProviders(prev => ({
      ...prev,
      [providerId]: !prev[providerId]
    }));
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
          <p>View and manage all service providers and their BOQs</p>
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
          <div className="providers-header-controls">
            <div className="view-mode-toggle">
              <button 
                className={viewMode === 'boqs' ? 'active' : ''}
                onClick={() => {
                  console.log('🔄 Switching to BOQs view');
                  setViewMode('boqs');
                }}
              >
                BOQs View
              </button>
              <button 
                className={viewMode === 'orders' ? 'active' : ''}
                onClick={() => {
                  console.log('🔄 Switching to Orders view');
                  setViewMode('orders');
                }}
              >
                Orders View
              </button>
            </div>
          </div>
          
          {!serviceProviderData || serviceProviderData.length === 0 ? (
            <div className="empty-state">
              <Building size={48} />
              <p>No service providers found</p>
            </div>
          ) : (
            <div className="providers-list">
              {serviceProviderData.map((provider, index) => {
                const providerId = provider._id || provider.id || index;
                const isExpanded = expandedProviders[providerId];
                const boqCount = provider.boqs?.length || 0;
                const orderCount = provider.orders?.length || 0;
                const totalSpent = provider.totalSpent || 0;
                const activeOrders = provider.activeOrders || 0;
                const activeBOQs = provider.activeBOQs || 0;
                
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
                            <span>{orderCount} order{orderCount !== 1 ? 's' : ''}</span>
                            <span>•</span>
                            <span>₹{totalSpent.toLocaleString()} spent</span>
                            {provider.suppliersWorkedWith > 0 && (
                              <>
                                <span>•</span>
                                <span>{provider.suppliersWorkedWith} supplier{provider.suppliersWorkedWith !== 1 ? 's' : ''}</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="provider-stats">
                        <div className="stat-item">
                          <span className="stat-label">Active Orders</span>
                          <span className="stat-value">{activeOrders}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">Active BOQs</span>
                          <span className="stat-value">{activeBOQs}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">Total BOQ Value</span>
                          <span className="stat-value">₹{(provider.totalBOQValue || 0).toLocaleString('en-IN')}</span>
                        </div>
                      </div>
                      <div className="expand-icon">
                        {isExpanded ? '▼' : '▶'}
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div className="provider-expanded-content">
                        {viewMode === 'boqs' ? (
                          <div key="boqs-view">
                            <h4 style={{ color: '#4f46e5', marginBottom: '1rem' }}>BOQs ({boqCount})</h4>
                            {provider.boqs && provider.boqs.length > 0 ? (
                              <div className="provider-boqs">
                                {provider.boqs.map((boq, idx) => (
                                  <div key={boq._id || boq.id || idx} className="boq-item">
                                    <div className="boq-item-header">
                                      <span className="boq-name">{boq.name}</span>
                                      <span className={`status-badge ${boq.status}`}>
                                        {boq.status}
                                      </span>
                                    </div>
                                    <div className="boq-item-details">
                                      {boq.description && (
                                        <div className="boq-description">{boq.description}</div>
                                      )}
                                      <div className="boq-stats">
                                        <span>Items: {boq.itemCount || 0}</span>
                                        <span>•</span>
                                        <span>Value: ₹{(boq.totalValue || 0).toLocaleString()}</span>
                                        {boq.createdAt && (
                                          <>
                                            <span>•</span>
                                            <span>Created: {new Date(boq.createdAt).toLocaleDateString()}</span>
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
                        ) : viewMode === 'orders' ? (
                          <div key="orders-view">
                            <h4 style={{ color: '#4f46e5', marginBottom: '1rem' }}>Orders ({orderCount})</h4>
                            {provider.orders && provider.orders.length > 0 ? (
                              <div className="provider-orders">
                                {provider.orders.map((order, idx) => (
                                  <div key={order.orderNumber || order._id || idx} className="order-item">
                                    <div className="order-item-header">
                                      <span className="order-number">#{order.orderNumber}</span>
                                      <span className={`status-badge ${order.status}`}>
                                        {order.status}
                                      </span>
                                    </div>
                                    <div className="order-item-details">
                                      {order.supplier && (
                                        <div className="order-supplier">
                                          <strong>Supplier:</strong> {order.supplier.name} 
                                          {order.supplier.company && ` (${order.supplier.company})`}
                                        </div>
                                      )}
                                      <div className="order-amount">
                                        <strong>Amount:</strong> ₹{order.totalAmount?.toLocaleString() || '0'}
                                      </div>
                                      <div className="order-items">
                                        <strong>Items:</strong> {order.items || 0}
                                      </div>
                                      {order.createdAt && (
                                        <div className="order-date">
                                          <strong>Date:</strong> {new Date(order.createdAt).toLocaleDateString()}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="provider-orders-empty">
                                <p>No orders found for this service provider</p>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminServiceProviders;
