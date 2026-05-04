import { useState, useEffect, useRef } from 'react';
import { getApiUrl } from '../config/api';
import { Bell, X, Package, Eye, Check } from 'lucide-react';
import { formatDateIST, parseServerDate } from '../utils/dateTime';
import './AdminNotifications.css';

const AdminNotifications = ({ onProductClick }) => {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [loading, setLoading] = useState(false);
  const notificationsRef = useRef(null);

  useEffect(() => {
    fetchNotifications();
    
    // Poll for new notifications every 30 seconds
    const notificationInterval = setInterval(() => {
      fetchNotifications();
    }, 30000);
    
    return () => {
      clearInterval(notificationInterval);
    };
  }, []);

  // Close notifications when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showNotifications && notificationsRef.current && !notificationsRef.current.contains(event.target)) {
        setShowNotifications(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);

  const fetchNotifications = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/admin/notifications?limit=20'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.status === 'success') {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
    }
  };

  const markAsRead = async (notificationId) => {
    try {
      const token = localStorage.getItem('token');
      await fetch(getApiUrl(`/api/admin/notifications/${notificationId}/read`), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      fetchNotifications();
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const handleNotificationClick = async (notification) => {
    // Mark as read if unread
    if (!notification.isRead) {
      await markAsRead(notification._id);
    }

    // If notification is product-related, open the product
    if (notification.relatedProduct || notification.type === 'product_approval') {
      // Get product ID - handle both populated object and plain ID string
      let productId = null;
      if (notification.relatedProduct) {
        if (typeof notification.relatedProduct === 'object' && notification.relatedProduct._id) {
          productId = notification.relatedProduct._id;
        } else if (typeof notification.relatedProduct === 'string') {
          productId = notification.relatedProduct;
        }
      }
      
      if (productId && onProductClick) {
        // Fetch the full product details
        try {
          const token = localStorage.getItem('token');
          const response = await fetch(getApiUrl(`/api/admin/products/${productId}`), {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          if (response.ok) {
            const result = await response.json();
            if (result.status === 'success' && result.product) {
              // Close notifications dropdown
              setShowNotifications(false);
              
              // Navigate to Product Status page
              window.location.href = '/admin-product-status';
              
              // Store product data in sessionStorage to show in modal after navigation
              sessionStorage.setItem('pendingProductModal', JSON.stringify({
                product: result.product,
                supplier: result.supplier || null
              }));
            } else {
              console.error('Failed to fetch product:', result);
              // Navigate to Product Status page anyway
              window.location.href = '/admin-product-status';
            }
          } else {
            console.error('Failed to fetch product:', response.status);
            // Navigate to Product Status page
            window.location.href = '/admin-product-status';
          }
        } catch (error) {
          console.error('Error fetching product:', error);
          // Navigate to Product Status page
          window.location.href = '/admin-product-status';
        }
      } else {
        console.warn('No product ID found in notification:', notification);
      }
    }
  };

  const markAllAsRead = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      await fetch(getApiUrl('/api/admin/notifications/read-all'), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      fetchNotifications();
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Just now';

    const date = parseServerDate(dateString);
    if (!date) return 'Just now';
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    
    return formatDateIST(date, 'N/A');
  };

  return (
    <div className="admin-notifications-container" ref={notificationsRef}>
      <button
        onClick={() => setShowNotifications(!showNotifications)}
        className="admin-notification-button"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="admin-notification-badge">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
      
      {showNotifications && (
        <div className="admin-notifications-dropdown">
          <div className="admin-notifications-header">
            <h3>Notifications</h3>
            {unreadCount > 0 && (
              <button 
                onClick={markAllAsRead} 
                className="mark-all-read-btn"
                disabled={loading}
              >
                <Check size={14} />
                Mark all as read
              </button>
            )}
          </div>
          
          <div className="admin-notifications-list">
            {notifications.length === 0 ? (
              <div className="admin-notification-empty">
                <Bell size={32} />
                <p>No notifications</p>
              </div>
            ) : (
              notifications.map((notification) => {
                const isProductNotification = notification.relatedProduct || notification.type === 'product_approval';
                return (
                <div
                  key={notification._id}
                    className={`admin-notification-item ${!notification.isRead ? 'unread' : ''} ${isProductNotification ? 'clickable' : ''}`}
                  onClick={() => {
                      if (isProductNotification) {
                        handleNotificationClick(notification);
                      } else if (!notification.isRead) {
                      markAsRead(notification._id);
                    }
                  }}
                    style={{
                      cursor: isProductNotification ? 'pointer' : 'default'
                    }}
                >
                  <div className="admin-notification-icon">
                    <Package size={18} />
                  </div>
                  <div className="admin-notification-content">
                    <div className="admin-notification-title">
                      {notification.title}
                    </div>
                    <div className="admin-notification-message">
                      {notification.message}
                    </div>
                    
                    {/* Show complete product information in notification */}
                    {isProductNotification && (notification.relatedProduct || notification.metadata) && (
                      <div className="admin-notification-product-details">
                        <div style={{ 
                          marginTop: '0.75rem', 
                          padding: '0.75rem', 
                          background: '#f8fafc', 
                          border: '1px solid #e2e8f0', 
                          borderRadius: '8px' 
                        }}>
                          <div style={{ 
                            fontSize: '0.875rem', 
                            fontWeight: '600', 
                            marginBottom: '0.5rem',
                            color: '#1e293b'
                          }}>
                            Product Details:
                          </div>
                          
                          {/* Product info from populated object or metadata */}
                          {notification.relatedProduct && typeof notification.relatedProduct === 'object' ? (
                            <>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8125rem' }}>
                                <div><strong>Category:</strong> {notification.relatedProduct.category || 'N/A'}</div>
                                <div><strong>Price:</strong> ₹{notification.relatedProduct.price?.toLocaleString() || '0'} / {notification.relatedProduct.unit || 'unit'}</div>
                                <div><strong>Stock:</strong> {notification.relatedProduct.stock?.toLocaleString() || '0'} {notification.relatedProduct.unit || 'units'}</div>
                                {notification.relatedProduct.location && (
                                  <div><strong>Location:</strong> {notification.relatedProduct.location}</div>
                                )}
                              </div>
                              {notification.relatedProduct.description && (
                                <div style={{ marginTop: '0.5rem', fontSize: '0.8125rem', color: '#64748b' }}>
                                  <strong>Description:</strong> {notification.relatedProduct.description}
                                </div>
                              )}
                            </>
                          ) : notification.metadata ? (
                            <>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.8125rem' }}>
                                <div><strong>Category:</strong> {notification.metadata.productCategory || 'N/A'}</div>
                                <div><strong>Price:</strong> ₹{notification.metadata.productPrice?.toLocaleString() || '0'} / {notification.metadata.productUnit || 'unit'}</div>
                                {notification.metadata.productStock && (
                                  <div><strong>Stock:</strong> {notification.metadata.productStock?.toLocaleString() || '0'} {notification.metadata.productUnit || 'units'}</div>
                                )}
                                {notification.metadata.productLocation && (
                                  <div><strong>Location:</strong> {notification.metadata.productLocation}</div>
                                )}
                              </div>
                              {notification.metadata.productDescription && (
                                <div style={{ marginTop: '0.5rem', fontSize: '0.8125rem', color: '#64748b' }}>
                                  <strong>Description:</strong> {notification.metadata.productDescription}
                                </div>
                              )}
                            </>
                          ) : null}
                        </div>
                      </div>
                    )}
                    
                    {notification.metadata && notification.metadata.changes && (
                      <div className="admin-notification-changes">
                        <strong>Changes:</strong>
                        <ul>
                          {notification.metadata.changes.map((change, idx) => (
                            <li key={idx}>{change}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {notification.relatedSupplier && (
                      <div className="admin-notification-supplier">
                        <strong>Supplier:</strong> {notification.relatedSupplier.name || notification.metadata?.supplierName}
                        {notification.relatedSupplier.company && ` (${notification.relatedSupplier.company})`}
                        {!notification.relatedSupplier.company && notification.metadata?.supplierCompany && ` (${notification.metadata.supplierCompany})`}
                      </div>
                    )}
                    <div className="admin-notification-time">
                      {formatDate(notification.createdAt)}
                    </div>
                      {isProductNotification && (
                        <div style={{
                          marginTop: '0.75rem',
                          padding: '0.75rem',
                          background: '#fef3c7',
                          border: '1px solid #f59e0b',
                          borderRadius: '6px',
                          fontSize: '0.875rem',
                          color: '#92400e',
                          fontWeight: '600',
                          textAlign: 'center'
                        }}>
                          👆 Click to view full details and approve/reject
                        </div>
                      )}
                  </div>
                  {!notification.isRead && (
                    <div className="admin-notification-unread-dot" />
                  )}
                </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminNotifications;
