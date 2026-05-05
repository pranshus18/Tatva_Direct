import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getApiUrl } from '../config/api';
import { 
  ShoppingCart, 
  AlertTriangle,
  CheckCircle,
  Clock,
  X,
  Eye,
  RefreshCw
} from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import './AdminDashboard.css';

const AdminTransactions = ({ user }) => {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTransaction, setSelectedTransaction] = useState(null);

  useEffect(() => {
    fetchAdminData();
  }, []);

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('[Admin Transactions] No token found');
        setLoading(false);
        return;
      }
      
      // Use proxy in development, full URL in production
      const isDevelopment = import.meta.env.DEV || window.location.hostname === 'localhost';
      const apiUrl = isDevelopment 
        ? '/api/admin/dashboard'
        : getApiUrl('/api/admin/dashboard');
      
      console.log('[Admin Transactions] Fetching data from:', apiUrl);
      
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      
      if (!response.ok) {
        console.error('[Admin Transactions] Response not OK:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('[Admin Transactions] Error response:', errorText);
        return;
      }
      
      const result = await response.json();
      console.log('[Admin Transactions] Response received:', result);
      
      if (result.status === 'success') {
        const data = result.data;
        const transactions = data.transactions || [];
        console.log('[Admin Transactions] Transactions loaded:', transactions.length);
        if (transactions.length > 0) {
          console.log('[Admin Transactions] Sample transaction:', {
            id: transactions[0].id,
            hasItems: !!transactions[0].items,
            itemsCount: transactions[0].items?.length || 0,
            hasServiceProvider: !!transactions[0].serviceProvider,
            hasSupplier: !!transactions[0].supplier
          });
        }
        setTransactions(transactions);
      } else {
        console.error('[Admin Transactions] Failed to fetch admin data:', result.message);
      }
    } catch (error) {
      console.error('[Admin Transactions] Failed to fetch admin data:', error);
      console.error('[Admin Transactions] Error details:', {
        message: error.message,
        stack: error.stack
      });
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <div className="spinner" />
        <p>Loading transactions...</p>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <h1>Transactions</h1>
          <p>View and manage all platform transactions</p>
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
        <div className="transactions-content">
          <div className="transactions-table">
            <table>
              <thead>
                <tr>
                  <th>Order Number</th>
                  <th>Service Provider</th>
                  <th>Supplier</th>
                  <th>Products</th>
                  <th>Amount</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => (
                  <tr 
                    key={transaction.id}
                    onClick={() => {
                      setSelectedTransaction(transaction);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <span className="transaction-id">#{transaction.id}</span>
                    </td>
                    <td>
                      {transaction.serviceProvider ? (
                        <div className="transaction-party">
                          <div className="party-name">{transaction.serviceProvider.name}</div>
                          {transaction.serviceProvider.company && (
                            <div className="party-company">{transaction.serviceProvider.company}</div>
                          )}
                        </div>
                      ) : (
                        <span>N/A</span>
                      )}
                    </td>
                    <td>
                      {transaction.supplier ? (
                        <div className="transaction-party">
                          <div className="party-name">{transaction.supplier.name}</div>
                          {transaction.supplier.company && (
                            <div className="party-company">{transaction.supplier.company}</div>
                          )}
                        </div>
                      ) : (
                        <span>N/A</span>
                      )}
                    </td>
                    <td>
                      <div className="transaction-products">
                        <span className="product-names">{transaction.products}</span>
                        {transaction.productCount > 0 && (
                          <span className="product-count-badge">
                            {transaction.productCount} items
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="amount">₹{transaction.amount.toLocaleString()}</td>
                    <td>{transaction.date}</td>
                    <td>
                      <span className={`status-badge ${transaction.status}`}>
                        {transaction.status === 'delivered' ? <CheckCircle size={14} /> : 
                         transaction.status === 'pending' ? <Clock size={14} /> : 
                         transaction.status === 'cancelled' ? <X size={14} /> : <AlertTriangle size={14} />}
                        {transaction.status}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${transaction.paymentStatus || 'pending'}`}>
                        {transaction.paymentStatus || 'pending'}
                      </span>
                    </td>
                    <td>
                      <button 
                        className="btn-icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTransaction(transaction);
                        }}
                      >
                        <Eye size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {selectedTransaction && createPortal(
            <div className="modal-overlay" onClick={() => setSelectedTransaction(null)} style={{ padding: 0, margin: 0, position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999 }}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ width: '100vw', height: '100vh', maxWidth: '100vw', maxHeight: '100vh', margin: 0, borderRadius: 0, position: 'fixed', top: 0, left: 0 }}>
                <div className="modal-header">
                  <h2>Transaction Details - #{selectedTransaction.id}</h2>
                  <button onClick={() => setSelectedTransaction(null)} className="btn-close-modal">
                    <X size={24} />
                  </button>
                </div>
                <div className="modal-body" style={{ 
                  overflowY: 'auto', 
                  overflowX: 'hidden', 
                  height: 'calc(100vh - 120px)', 
                  maxHeight: 'calc(100vh - 120px)',
                  boxSizing: 'border-box',
                  padding: '2rem 3rem'
                }}>
                  <div className="order-info-section">
                    <h3>Customer Information</h3>
                    {selectedTransaction.serviceProvider ? (
                      <>
                        <p><strong>Name:</strong> {selectedTransaction.serviceProvider.name || 'N/A'}</p>
                        <p><strong>Company:</strong> {selectedTransaction.serviceProvider.company || 'N/A'}</p>
                        {selectedTransaction.serviceProvider.email && (
                          <p><strong>Email:</strong> {selectedTransaction.serviceProvider.email}</p>
                        )}
                        {selectedTransaction.serviceProvider.phone && (
                          <p><strong>Phone:</strong> {selectedTransaction.serviceProvider.phone}</p>
                        )}
                        {selectedTransaction.serviceProvider.address && (
                          <div style={{ marginTop: '0.5rem' }}>
                            <p><strong>Address:</strong></p>
                            <p style={{ marginLeft: '1rem', color: '#64748b' }}>
                              {typeof selectedTransaction.serviceProvider.address === 'object' 
                                ? [
                                    selectedTransaction.serviceProvider.address.street,
                                    selectedTransaction.serviceProvider.address.city,
                                    selectedTransaction.serviceProvider.address.state,
                                    selectedTransaction.serviceProvider.address.zipCode
                                  ].filter(Boolean).join(', ')
                                : selectedTransaction.serviceProvider.address || 'N/A'
                              }
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <p style={{ color: '#64748b' }}>Customer information not available</p>
                    )}
                  </div>

                  <div className="order-info-section">
                    <h3>Order Items</h3>
                    {selectedTransaction.items && selectedTransaction.items.length > 0 ? (
                      <table className="order-items-table">
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th>Quantity</th>
                            <th>Unit Price</th>
                            <th>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedTransaction.items.map((item, idx) => (
                            <tr key={idx}>
                              <td>
                                {(item.productImage || item.product?.image || item.images?.[0] || item.product?.images?.[0]) && (
                                  <div style={{ marginBottom: '0.35rem' }}>
                                    <img
                                      src={item.productImage || item.product?.image || item.images?.[0] || item.product?.images?.[0]}
                                      alt={item.product || item.productName || item.name || 'Product'}
                                      style={{
                                        width: '56px',
                                        height: '56px',
                                        objectFit: 'cover',
                                        borderRadius: '6px',
                                        border: '1px solid #e5e7eb'
                                      }}
                                    />
                                  </div>
                                )}
                                <div>
                                  <strong>{item.product || item.productName || item.name || 'Product'}</strong>
                                  {item.category && (
                                    <span className="product-category"> ({item.category})</span>
                                  )}
                                </div>
                                {item.description && (
                                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>
                                    {item.description}
                                  </div>
                                )}
                                {item.specifications && (
                                  <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>
                                    <strong>Specs:</strong> {item.specifications}
                                  </div>
                                )}
                              </td>
                              <td>{item.quantity || 0} {item.unit || 'units'}</td>
                              <td>₹{((item.unitPrice || item.unit_price || 0)).toLocaleString()}</td>
                              <td>₹{((item.totalPrice || item.total_price || 0)).toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr>
                            <td colSpan="3"><strong>Total Amount</strong></td>
                            <td><strong>₹{selectedTransaction.amount.toLocaleString()}</strong></td>
                          </tr>
                        </tfoot>
                      </table>
                    ) : (
                      <p style={{ color: '#64748b' }}>No items found in this order.</p>
                    )}
                  </div>

                  <div className="order-info-section">
                    <h3>Order Status & Dates</h3>
                    <p><strong>Current Status:</strong> {selectedTransaction.status || 'pending'}</p>
                    <p><strong>Payment Status:</strong> {selectedTransaction.paymentStatus || 'pending'}</p>
                    <p><strong>Order Date:</strong> {selectedTransaction.date || selectedTransaction.createdAt || 'N/A'}</p>
                    {selectedTransaction.createdAt && selectedTransaction.date !== selectedTransaction.createdAt && (
                      <p><strong>Created At:</strong> {new Date(selectedTransaction.createdAt).toLocaleString()}</p>
                    )}
                  </div>

                  {selectedTransaction.boq && (
                    <div className="order-info-section">
                      <h3>Related BOQ</h3>
                      <p><strong>BOQ Name:</strong> {selectedTransaction.boq.name || 'N/A'}</p>
                      {selectedTransaction.boq.description && (
                        <p style={{ wordBreak: 'break-word', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', marginTop: '0.5rem' }}>
                          {selectedTransaction.boq.description}
                        </p>
                      )}
                    </div>
                  )}

                  {selectedTransaction.supplier && (
                    <div className="order-info-section">
                      <h3>Supplier Information</h3>
                      <p><strong>Name:</strong> {selectedTransaction.supplier.name || 'N/A'}</p>
                      <p><strong>Company:</strong> {selectedTransaction.supplier.company || 'N/A'}</p>
                      {selectedTransaction.supplier.email && (
                        <p><strong>Email:</strong> {selectedTransaction.supplier.email}</p>
                      )}
                      {selectedTransaction.supplier.phone && (
                        <p><strong>Phone:</strong> {selectedTransaction.supplier.phone}</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminTransactions;
