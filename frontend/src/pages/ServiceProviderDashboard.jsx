import React, { useState, useEffect, useRef } from 'react';
import { getApiUrl, authFetch } from '../config/api';
import { 
  FileText, 
  Users, 
  ShoppingCart, 
  TrendingUp, 
  Clock, 
  CheckCircle,
  AlertCircle,
  Plus,
  Eye,
  X,
  Trash2,
  QrCode,
  RefreshCw,
  Bell
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buildOrderUpiPayUri, qrServerImageUrl } from '../utils/upiPaymentQr';
import { formatDateIST, formatDateTimeIST } from '../utils/dateTime';
import { parseSpecificationsForDisplay } from '../utils/specifications';
import ProductImageCarousel from '../components/ProductImageCarousel';
import './Dashboard.css';

const DASHBOARD_CACHE_KEY = 'sp_dashboard_cache_v1';
const DASHBOARD_CACHE_TTL_MS = 60 * 1000;

const ServiceProviderDashboard = ({ user }) => {
  const [stats, setStats] = useState({
    totalBOQs: 0,
    activePOs: 0,
    totalSpent: 0,
    pendingApprovals: 0
  });
  const [recentBOQs, setRecentBOQs] = useState([]);
  const [recentPOs, setRecentPOs] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderDetails, setOrderDetails] = useState(null);
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);
  const [updatingPayment, setUpdatingPayment] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const orderPollIntervalRef = useRef(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DASHBOARD_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        if (cached?.savedAt && Date.now() - Number(cached.savedAt) <= DASHBOARD_CACHE_TTL_MS) {
          if (cached.stats) setStats(cached.stats);
          if (Array.isArray(cached.recentBOQs)) setRecentBOQs(cached.recentBOQs);
          if (Array.isArray(cached.recentPOs)) setRecentPOs(cached.recentPOs);
        }
      }
    } catch (_e) {
      // Ignore cache parsing/storage issues.
    }

    Promise.allSettled([fetchDashboardData(), fetchNotifications()]);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showNotifications && !event.target.closest('[data-sp-notification-container]')) {
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showNotifications]);

  const fetchDashboardData = async () => {
    try {
      setDashboardError('');
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('[Dashboard] No token found');
        setDashboardError('Your session is missing. Please log in again.');
        return;
      }
      
      // Add cache-busting parameters to ensure fresh data
      const timestamp = Date.now();
      
      // Use proxy in development, full URL in production
      const isDevelopment = import.meta.env.DEV || window.location.hostname === 'localhost';
      const apiUrl = isDevelopment 
        ? `/api/dashboard/service-provider`
        : getApiUrl('/api/dashboard/service-provider');
      
      const fullUrl = `${apiUrl}?_t=${timestamp}`;
      console.log('[Dashboard] Fetching dashboard data from:', fullUrl);
      
      const response = await authFetch(fullUrl, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        }
      });
      
      if (!response.ok) {
        console.error('[Dashboard] Response not OK:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('[Dashboard] Error response:', errorText);
        let backendMessage = 'Failed to fetch dashboard data. Please refresh and try again.';
        try {
          const parsed = JSON.parse(errorText);
          backendMessage = parsed?.message || backendMessage;
        } catch (_e) {
          if (errorText && String(errorText).trim()) {
            backendMessage = String(errorText).trim();
          }
        }

        if (response.status === 401 || response.status === 403) {
          setDashboardError('Your session expired or access is denied. Please log in again.');
          localStorage.removeItem('token');
          localStorage.removeItem('user');
          navigate('/login');
          return;
        }

        setDashboardError(backendMessage);
        return;
      }
      
      const data = await response.json();
      console.log('[Dashboard] Received data:', data);
      console.log('[Dashboard] Stats:', data.stats);
      console.log('[Dashboard] Recent BOQs:', data.recentBOQs);
      console.log('[Dashboard] Recent BOQs count:', data.recentBOQs?.length || 0);
      
      if (data.stats) {
        const nextStats = {
          totalBOQs: data.stats.totalBOQs || 0,
          activePOs: data.stats.activePOs || 0,
          totalSpent: data.stats.totalSpent || 0,
          pendingApprovals: data.stats.pendingApprovals || 0
        };
        setStats(nextStats);
        try {
          sessionStorage.setItem(
            DASHBOARD_CACHE_KEY,
            JSON.stringify({
              savedAt: Date.now(),
              stats: nextStats,
              recentBOQs: data.recentBOQs || [],
              recentPOs: data.recentPOs || []
            })
          );
        } catch (_e) {
          // Ignore cache write issues.
        }
      }
      setRecentBOQs(data.recentBOQs || []);
      setRecentPOs(data.recentPOs || []);
    } catch (error) {
      console.error('[Dashboard] Failed to fetch dashboard data:', error);
      console.error('[Dashboard] Error details:', {
        message: error.message,
        stack: error.stack
      });
      setDashboardError('Network error while loading dashboard data. Please check your connection and try again.');
    }
  };

  const fetchNotifications = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const response = await authFetch('/api/supplier/notifications');
      const data = await response.json();
      if (data.status === 'success') {
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      } else {
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch (error) {
      console.error('[SP Notifications] Failed to fetch notifications:', error);
      setNotifications([]);
      setUnreadCount(0);
    }
  };

  const markNotificationAsRead = async (notificationId) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      await fetch(getApiUrl(`/api/supplier/notifications/${notificationId}/read`), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      fetchNotifications();
    } catch (error) {
      console.error('[SP Notifications] Failed to mark notification as read:', error);
    }
  };

  const getNotificationMeta = (notification) => {
    const meta = notification?.metadata;
    return meta && typeof meta === 'object' ? meta : {};
  };

  const getNotificationOrderRef = (notification) =>
    notification?.related_order?.order_number ||
    notification?.relatedOrder?.orderNumber ||
    null;

  const fetchOrderDetails = async (orderId, forceRefresh = false) => {
    if (!orderId) {
      alert('Invalid order ID');
      return;
    }
    
    setLoadingOrderDetails(true);
    if (forceRefresh) {
      setOrderDetails(null); // Clear previous details only on force refresh
    }
    
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('[Order Details] No token found');
        alert('Please log in again to view order details.');
        setSelectedOrder(null);
        setLoadingOrderDetails(false);
        return;
      }
      
      // Encode the orderId to handle special characters
      const encodedOrderId = encodeURIComponent(orderId);
      // Add cache-busting parameters to ensure fresh supplier data
      const timestamp = Date.now();
      
      // Use proxy in development, full URL in production
      const isDevelopment = import.meta.env.DEV || window.location.hostname === 'localhost';
      const apiUrl = isDevelopment 
        ? `/api/dashboard/service-provider/orders/${encodedOrderId}`
        : getApiUrl(`/api/dashboard/service-provider/orders/${encodedOrderId}`);
      
      const fullUrl = `${apiUrl}?_t=${timestamp}`;
      console.log('[Order Details] Fetching order details from:', fullUrl);
      console.log('[Order Details] Order ID:', orderId, 'Encoded:', encodedOrderId);
      
      const response = await authFetch(fullUrl, {
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        }
      });
      
      if (!response.ok) {
        console.error('[Order Details] Response not OK:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('[Order Details] Error response:', errorText);
        
        let errorMessage = 'Failed to load order details.';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorMessage;
        } catch (e) {
          // If parsing fails, use default message
        }
        
        alert(errorMessage);
        setSelectedOrder(null);
        setLoadingOrderDetails(false);
        return;
      }
      
      const data = await response.json();
      console.log('[Order Details] Response received:', data);
      console.log('[Order Details] Supplier in response:', data.order?.supplier);
      
      if (data.status === 'success' && data.order) {
        console.log('[Order Details] Order details loaded successfully:', data.order);
        console.log('[Order Details] Supplier information:', {
          hasSupplier: !!data.order.supplier,
          supplierType: typeof data.order.supplier,
          supplierName: data.order.supplier?.name,
          supplierCompany: data.order.supplier?.company
        });
        setOrderDetails(data.order);
      } else {
        console.error('[Order Details] Invalid response format:', data);
        alert(data.message || 'Failed to load order details. Please try again.');
        setSelectedOrder(null);
      }
    } catch (error) {
      console.error('[Order Details] Failed to fetch order details:', error);
      console.error('[Order Details] Error details:', {
        message: error.message,
        stack: error.stack,
        name: error.name
      });
      alert('Failed to load order details. Please check your connection and try again.');
      setSelectedOrder(null);
    } finally {
      setLoadingOrderDetails(false);
    }
  };

  const handleViewOrder = (orderId) => {
    console.log('Viewing order:', orderId);
    if (!orderId) {
      console.error('No order ID provided');
      alert('Invalid order ID');
      return;
    }
    
    // Clear any existing polling interval
    if (orderPollIntervalRef.current) {
      clearInterval(orderPollIntervalRef.current);
      orderPollIntervalRef.current = null;
    }
    
    setSelectedOrder(orderId);
    fetchOrderDetails(orderId);
    
  };

  const handleCloseOrderDetails = () => {
    // Clear polling interval when closing modal
    if (orderPollIntervalRef.current) {
      clearInterval(orderPollIntervalRef.current);
      orderPollIntervalRef.current = null;
    }
    setSelectedOrder(null);
    setOrderDetails(null);
  };

  const handleDeleteOrder = async () => {
    if (!selectedOrder || !orderDetails) {
      alert('No order selected for deletion');
      return;
    }
    
    const orderNumber = orderDetails.orderNumber || selectedOrder;
    const confirmed = window.confirm(
      `Are you sure you want to delete Order ${orderNumber}?\n\n` +
      `This action cannot be undone. The order will be permanently removed from the system.\n\n` +
      `Note: Orders that have been delivered and paid cannot be deleted.`
    );
    
    if (!confirmed) return;
    
    setDeletingOrder(true);
    try {
      const token = localStorage.getItem('token');
      const encodedOrderId = encodeURIComponent(orderNumber);
      const response = await fetch(getApiUrl(`/api/dashboard/service-provider/orders/${encodedOrderId}`), {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await response.json();
      
      if (data.status === 'success') {
        alert(`Order ${orderNumber} deleted successfully`);
        // Close the modal
        handleCloseOrderDetails();
        // Refresh dashboard to update order list
        fetchDashboardData();
      } else {
        alert(data.message || 'Failed to delete order. Please try again.');
      }
    } catch (error) {
      console.error('Failed to delete order:', error);
      alert('Failed to delete order. Please check your connection and try again.');
    } finally {
      setDeletingOrder(false);
    }
  };

  const handleDownloadReceipt = async () => {
    try {
      const orderRef = orderDetails?.orderNumber || selectedOrder;
      if (!orderRef) return;
      const token = localStorage.getItem('token');
      if (!token) return;
      const response = await fetch(getApiUrl(`/api/receipts/order/${encodeURIComponent(orderRef)}/download`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.message || 'Failed to download receipt');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${orderRef}-receipt.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.message || 'Failed to download receipt');
    }
  };

  const canRateCurrentOrder = () => {
    if (!orderDetails) return false;
    return orderDetails.status === 'delivered' && orderDetails.paymentStatus === 'paid';
  };

  const handleSubmitRating = async () => {
    if (!orderDetails || !canRateCurrentOrder()) {
      alert('You can only rate a supplier after the order is delivered and payment is marked as paid.');
      return;
    }
    if (!rating || rating < 1 || rating > 5) {
      alert('Please select a rating between 1 and 5 stars.');
      return;
    }

    try {
      setSubmittingRating(true);
      const token = localStorage.getItem('token');
      if (!token) {
        alert('You are not logged in. Please log in again.');
        return;
      }

      const orderId = encodeURIComponent(orderDetails.orderNumber || orderDetails.id);
      const response = await fetch(getApiUrl(`/api/po/${orderId}/rating`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ rating, feedback })
      });

      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        alert(data.message || 'Failed to submit rating. Please try again.');
        return;
      }

      alert('Thank you! Your rating has been submitted.');
    } catch (error) {
      console.error('[Rating] Failed to submit rating:', error);
      alert('Failed to submit rating. Please try again later.');
    } finally {
      setSubmittingRating(false);
    }
  };

  const handleCreateReturnRequest = async () => {
    if (!orderDetails || !Array.isArray(orderDetails.items) || orderDetails.items.length === 0) {
      alert('No order items available for return.');
      return;
    }

    const itemOptions = orderDetails.items
      .map((it, idx) => `${idx + 1}. ${(it.product?.name || it.name || 'Item')} (qty: ${it.quantity})`)
      .join('\n');
    const itemNumberInput = window.prompt(`Select item number to return:\n${itemOptions}`);
    if (!itemNumberInput) return;
    const itemIndex = Number(itemNumberInput) - 1;
    if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= orderDetails.items.length) {
      alert('Invalid item selection.');
      return;
    }

    const selectedItem = orderDetails.items[itemIndex];
    const qtyInput = window.prompt(`Enter return quantity (max ${selectedItem.quantity}):`, '1');
    if (!qtyInput) return;
    const qty = Number(qtyInput);
    if (!Number.isFinite(qty) || qty <= 0 || qty > Number(selectedItem.quantity || 0)) {
      alert('Invalid return quantity.');
      return;
    }

    const reason = window.prompt('Enter return reason:');
    if (!reason || !reason.trim()) {
      alert('Return reason is required.');
      return;
    }

    const trackingId = window.prompt(
      'Enter return tracking ID (optional). Leave blank to auto-generate RET-ORDERNUMBER:',
      selectedItem.productTrackingId || ''
    );

    try {
      const token = localStorage.getItem('token');
      const encodedOrderId = encodeURIComponent(orderDetails.orderNumber || selectedOrder);
      const response = await fetch(getApiUrl(`/api/dashboard/service-provider/orders/${encodedOrderId}/returns`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          orderItemId: selectedItem.id,
          quantity: qty,
          reason: reason.trim(),
          trackingId: trackingId ? trackingId.trim() : null
        })
      });

      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        alert(data.message || 'Failed to create return request.');
        return;
      }

      alert('Return request created successfully.');
      await fetchOrderDetails(selectedOrder, true);
    } catch (error) {
      console.error('Create return request failed:', error);
      alert('Failed to create return request. Please try again.');
    }
  };

  const formatDate = (dateString) => {
    return formatDateTimeIST(dateString, 'N/A');
  };

  const formatAddress = (address) =>
    [
      address?.street || address?.line1,
      address?.city,
      address?.state,
      address?.zipCode || address?.pincode,
      address?.country
    ]
      .filter(Boolean)
      .join(', ');

  const readGstSummary = (order) =>
    order?.invoice?.metadata?.gstSummary ||
    order?.deliveryAddress?.gstSummary ||
    null;

  const handleMarkAsPaid = async () => {
    if (!selectedOrder) return;
    
    const confirmed = window.confirm(
      `Mark payment as paid for Order ${orderDetails?.orderNumber}?\nAmount: ₹${orderDetails?.totalAmount?.toLocaleString()}`
    );
    
    if (!confirmed) return;
    
    setUpdatingPayment(true);
    try {
      const token = localStorage.getItem('token');
      const encodedOrderId = encodeURIComponent(selectedOrder);
      const response = await fetch(getApiUrl(`/api/dashboard/service-provider/orders/${encodedOrderId}/payment`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          paymentStatus: 'paid',
          paymentMethod: 'online'
        })
      });
      
      const data = await response.json();
      console.log('Update payment response:', data);
      
      if (data.status === 'success') {
        alert('Payment status updated to paid successfully');
        await fetchOrderDetails(selectedOrder);
        if (data.invoice?.pdfUrl) {
          setOrderDetails((prev) =>
            prev ? { ...prev, invoicePdfUrl: data.invoice.pdfUrl, paymentStatus: 'paid' } : prev
          );
        }
        fetchDashboardData();
      } else {
        console.error('Update payment error:', data);
        alert(data.message || 'Failed to update payment status. Please try again.');
      }
    } catch (error) {
      console.error('Failed to update payment status:', error);
      alert('Failed to update payment status. Please check your connection and try again.');
    } finally {
      setUpdatingPayment(false);
    }
  };

  const handleDeleteBOQ = async (boqId) => {
    if (!boqId) return;
    
    // Confirm deletion
    const confirmed = window.confirm(
      'Are you sure you want to delete this BOQ? This action cannot be undone and will also delete the uploaded file.'
    );
    
    if (!confirmed) return;
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/boq/${boqId}`), {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      const data = await response.json();
      
      if (data.status === 'success') {
        alert('BOQ deleted successfully');
        // Refresh dashboard data
        fetchDashboardData();
      } else {
        alert(data.message || 'Failed to delete BOQ');
      }
    } catch (error) {
      console.error('Failed to delete BOQ:', error);
      alert('Failed to delete BOQ. Please try again.');
    }
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          <h1>Welcome back, {user?.name}!</h1>
          <p>Here's what's happening with your procurement activities</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            className="btn-secondary"
            onClick={() => navigate('/returns')}
            style={{ whiteSpace: 'nowrap' }}
          >
            View Returns
          </button>
          <div style={{ position: 'relative' }} data-sp-notification-container>
            <button
              onClick={() => {
                if (!showNotifications) {
                  fetchNotifications();
                }
                setShowNotifications(!showNotifications);
              }}
              style={{
                position: 'relative',
                padding: '0.5rem',
                background: 'transparent',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Bell size={20} />
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-4px',
                  right: '-4px',
                  background: '#ef4444',
                  color: 'white',
                  borderRadius: '50%',
                  width: '20px',
                  height: '20px',
                  fontSize: '0.75rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 'bold'
                }}>
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {showNotifications && (
              <div
                data-sp-notification-container
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  marginTop: '0.5rem',
                  background: 'white',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  width: '350px',
                  maxHeight: '500px',
                  overflowY: 'auto',
                  zIndex: 1000
                }}
              >
                <div style={{
                  padding: '1rem',
                  borderBottom: '1px solid #e5e7eb',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Notifications</h3>
                </div>
                <div>
                  {notifications.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                      No notifications
                    </div>
                  ) : (
                    notifications.map((notification) => {
                      const notificationId = notification.id || notification._id;
                      const meta = getNotificationMeta(notification);
                      const receiptPdfUrl = meta.receiptPdfUrl || null;
                      const invoicePdfUrl = meta.invoicePdfUrl || null;
                      const orderRef = getNotificationOrderRef(notification);
                      return (
                      <div
                        key={notificationId}
                        onClick={() => {
                          if (!notification.is_read && !notification.isRead) {
                            markNotificationAsRead(notificationId);
                          }
                          if (orderRef) {
                            handleViewOrder(orderRef);
                            setShowNotifications(false);
                          }
                        }}
                        style={{
                          padding: '1rem',
                          borderBottom: '1px solid #f3f4f6',
                          cursor: 'pointer',
                          backgroundColor: notification.is_read || notification.isRead ? 'white' : '#f0f9ff',
                          transition: 'background-color 0.2s'
                        }}
                      >
                        <div style={{ fontWeight: notification.is_read || notification.isRead ? 500 : 600, marginBottom: '0.25rem', color: '#111827' }}>
                          {notification.title}
                        </div>
                        <div style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '0.25rem' }}>
                          {notification.message}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                          {formatDate(notification.created_at || notification.createdAt)}
                        </div>
                        {(receiptPdfUrl || invoicePdfUrl) && (
                          <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.55rem' }}>
                            {receiptPdfUrl && (
                              <a
                                href={receiptPdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                style={{ fontSize: '0.78rem', color: '#2563eb', textDecoration: 'underline' }}
                              >
                                Download Receipt
                              </a>
                            )}
                            {invoicePdfUrl && (
                              <a
                                href={invoicePdfUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                style={{ fontSize: '0.78rem', color: '#2563eb', textDecoration: 'underline' }}
                              >
                                Download Invoice
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
          <button 
            className="btn-primary"
            onClick={() => navigate('/boq-normalize')}
          >
            <Plus size={18} />
            New BOQ
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {dashboardError && (
        <div
          style={{
            marginBottom: '1rem',
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px solid #fecaca',
            backgroundColor: '#fef2f2',
            color: '#b91c1c',
            fontWeight: 500
          }}
        >
          {dashboardError}
        </div>
      )}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon boq">
            <FileText size={24} />
          </div>
          <div className="stat-content">
            <h3>{stats.totalBOQs}</h3>
            <p>Total BOQs</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon po">
            <ShoppingCart size={24} />
          </div>
          <div className="stat-content">
            <h3>{stats.activePOs}</h3>
            <p>Active POs</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon spent">
            <TrendingUp size={24} />
          </div>
          <div className="stat-content">
            <h3>{stats.totalSpent.toLocaleString()}</h3>
            <p>Total Spent</p>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon pending">
            <Clock size={24} />
          </div>
          <div className="stat-content">
            <h3>{stats.pendingApprovals}</h3>
            <p>Pending Approvals</p>
          </div>
        </div>
      </div>

      <div className="dashboard-content">
        {/* Recent BOQs */}
        <div className="dashboard-section">
          <div className="section-header">
            <h2>Recent BOQs</h2>
            <button 
              className="btn-secondary"
              onClick={() => navigate('/boq-normalize')}
            >
              View All
            </button>
          </div>
          
          <div className="items-list">
            {recentBOQs.length > 0 ? (
              recentBOQs.map((boq) => (
                <div key={boq.id} className="item-card">
                  <div className="item-info">
                    <h4>{boq.name}</h4>
                    <p>{boq.itemCount} items • Created {boq.createdAt}</p>
                  </div>
                  <div className="item-status">
                    <span className={`status ${boq.status}`}>
                      {boq.status === 'completed' ? <CheckCircle size={16} /> : <Clock size={16} />}
                      {boq.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      className="btn-icon"
                      title="View BOQ"
                    >
                      <Eye size={16} />
                    </button>
                    <button 
                      className="btn-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteBOQ(boq.id);
                      }}
                      title="Delete BOQ"
                      style={{ color: '#dc2626' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <FileText size={48} />
                <h3>No BOQs yet</h3>
                <p>Create your first BOQ to get started</p>
                <button 
                  className="btn-primary"
                  onClick={() => navigate('/boq-normalize')}
                >
                  Create BOQ
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Live Purchase Orders */}
        <div className="dashboard-section">
          <div className="section-header">
            <h2>Live Purchase Orders</h2>
            <button className="btn-secondary" onClick={() => navigate('/your-orders')}>
              View All
            </button>
          </div>
          
          <div className="items-list">
            {recentPOs.length > 0 ? (
              recentPOs.map((po) => (
                <div 
                  key={po.id} 
                  className="item-card"
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleViewOrder(po.orderNumber || po.id)}
                  title="Click to view order details"
                >
                  <div className="item-info">
                    <h4>Order {po.orderNumber || po.id}</h4>
                    <p>
                      {po.vendor}
                      {po.vendorCompany && ` • ${po.vendorCompany}`}
                      {po.itemCount > 0 && ` • ${po.itemCount} item${po.itemCount > 1 ? 's' : ''}`}
                    </p>
                    <p style={{ fontSize: '0.9rem', color: '#64748b', marginTop: '0.25rem' }}>
                      Amount: ₹{po.amount.toLocaleString()}
                      {po.createdAt && ` • ${po.createdAt}`}
                    </p>
                  </div>
                  <div className="item-status">
                    <span className={`status ${po.status}`}>
                      {po.status === 'delivered' ? <CheckCircle size={16} /> : 
                       po.status === 'pending' ? <Clock size={16} /> : 
                       po.status === 'confirmed' ? <CheckCircle size={16} /> :
                       <AlertCircle size={16} />}
                      {po.status === 'confirmed' ? 'Confirmed' : po.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    {po.invoicePdfUrl && String(po.paymentStatus || '').toLowerCase() === 'paid' && (
                      <a
                        href={po.invoicePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-icon"
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#4f46e5' }}
                        title="Download invoice PDF"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FileText size={16} />
                      </a>
                    )}
                    <button
                      className="btn-icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewOrder(po.orderNumber || po.id);
                      }}
                      title="View order details"
                    >
                      <Eye size={16} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state">
                <ShoppingCart size={48} />
                <h3>No Purchase Orders</h3>
                <p>Your live purchase orders will appear here</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Order Details Modal */}
      {selectedOrder && (
        <div className="modal-overlay" onClick={handleCloseOrderDetails}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div className="modal-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Order Details - {orderDetails?.orderNumber || 'Loading...'}</h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button 
                  className="btn-icon" 
                  onClick={() => fetchOrderDetails(selectedOrder, true)}
                  disabled={loadingOrderDetails}
                  title="Refresh to get latest supplier information"
                  style={{ 
                    opacity: loadingOrderDetails ? 0.5 : 1,
                    cursor: loadingOrderDetails ? 'not-allowed' : 'pointer'
                  }}
                >
                  <RefreshCw 
                    size={18} 
                    style={{ 
                      animation: loadingOrderDetails ? 'spin 1s linear infinite' : 'none' 
                    }} 
                  />
                </button>
                <button className="btn-icon" onClick={handleCloseOrderDetails}>
                  <X size={20} />
                </button>
              </div>
            </div>
            
            {loadingOrderDetails ? (
              <div className="modal-body" style={{ textAlign: 'center', padding: '2rem' }}>
                <div className="spinner" />
                <p>Loading order details...</p>
              </div>
            ) : orderDetails ? (
              <div className="modal-body">
                <div className="order-info-section">
                  <h3>Supplier Information</h3>
                  {orderDetails.supplier ? (
                    <>
                      <p><strong>Name:</strong> {orderDetails.supplier.name || 'N/A'}</p>
                      <p><strong>Company:</strong> {orderDetails.supplier.company || 'N/A'}</p>
                  {orderDetails.supplier?.email && (
                    <p><strong>Email:</strong> {orderDetails.supplier.email}</p>
                  )}
                  {orderDetails.supplier?.phone && (
                    <p><strong>Phone:</strong> {orderDetails.supplier.phone}</p>
                  )}
                  {orderDetails.supplier?.address && (
                    <div style={{ marginTop: '0.5rem' }}>
                      <p><strong>Address:</strong></p>
                      <p style={{ marginLeft: '1rem', color: '#64748b' }}>
                        {[
                          orderDetails.supplier.address.line1 || orderDetails.supplier.address.street,
                          orderDetails.supplier.address.line2,
                          orderDetails.supplier.address.city,
                          orderDetails.supplier.address.state,
                          orderDetails.supplier.address.zipCode || orderDetails.supplier.address.pincode,
                          orderDetails.supplier.address.country
                        ].filter(Boolean).join(', ')}
                      </p>
                    </div>
                  )}
                    </>
                  ) : (
                    <p style={{ color: '#64748b' }}>Supplier information not available</p>
                  )}
                </div>

                <div className="order-info-section">
                  <h3>Order Items</h3>
                  {orderDetails.items && orderDetails.items.length > 0 ? (
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
                        {orderDetails.items.map((item, idx) => (
                          <tr key={idx}>
                            <td>
                              {(item.productImage || item.product?.image || item.images?.[0] || item.product?.images?.[0]) && (
                                <div style={{ marginBottom: '0.35rem' }}>
                                  <ProductImageCarousel
                                    images={[
                                      item.productImage,
                                      item.product?.image,
                                      ...(Array.isArray(item.images) ? item.images : []),
                                      ...(Array.isArray(item.product?.images) ? item.product.images : [])
                                    ]}
                                    alt={item.product?.name || item.name || 'Product'}
                                    height={80}
                                    rounded={6}
                                  />
                                </div>
                              )}
                              <div>
                                <strong>{item.product?.name || item.name || 'Product'}</strong>
                                {item.product?.category && (
                                  <span className="product-category"> ({item.product.category})</span>
                                )}
                              </div>
                              {item.product?.description && (
                                <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>
                                  {item.product.description}
                                </div>
                              )}
                              {parseSpecificationsForDisplay(item.specifications).length > 0 && (
                                <div
                                  style={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '0.35rem',
                                    marginTop: '0.45rem'
                                  }}
                                >
                                  {parseSpecificationsForDisplay(item.specifications).map((entry) => (
                                    <span
                                      key={`${entry.label}-${entry.value}`}
                                      style={{
                                        fontSize: '0.78rem',
                                        color: '#334155',
                                        background: '#f1f5f9',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '9999px',
                                        padding: '0.2rem 0.55rem',
                                        lineHeight: 1.35
                                      }}
                                      title={`${entry.label}: ${entry.value}`}
                                    >
                                      <strong>{entry.label}:</strong> {entry.value}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {item.brandModel && (
                                <div style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.35rem' }}>
                                  {item.brandModel}
                                </div>
                              )}
                            </td>
                            <td>{item.quantity} {item.product?.unit || item.unit || 'units'}</td>
                            <td>₹{item.unitPrice?.toLocaleString()}</td>
                            <td>₹{item.totalPrice?.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan="3"><strong>Total Amount</strong></td>
                          <td><strong>₹{orderDetails.totalAmount?.toLocaleString()}</strong></td>
                        </tr>
                      </tfoot>
                    </table>
                  ) : (
                    <p style={{ color: '#64748b' }}>No items found in this order.</p>
                  )}
                  {readGstSummary(orderDetails) && (
                    <div style={{ marginTop: '0.75rem', fontSize: '0.9rem', color: '#334155' }}>
                      <p style={{ margin: 0 }}>
                        <strong>Taxable subtotal:</strong> ₹{Number(readGstSummary(orderDetails)?.subtotalAmount || 0).toLocaleString('en-IN')}
                      </p>
                      <p style={{ margin: '0.2rem 0 0' }}>
                        <strong>GST type:</strong> {readGstSummary(orderDetails)?.taxType === 'IGST' ? 'IGST' : 'CGST + SGST'}
                      </p>
                      {readGstSummary(orderDetails)?.taxType === 'IGST' ? (
                        <p style={{ margin: '0.2rem 0 0' }}>
                          <strong>IGST:</strong> ₹{Number(readGstSummary(orderDetails)?.igstAmount || 0).toLocaleString('en-IN')}
                        </p>
                      ) : (
                        <p style={{ margin: '0.2rem 0 0' }}>
                          <strong>CGST:</strong> ₹{Number(readGstSummary(orderDetails)?.cgstAmount || 0).toLocaleString('en-IN')} | <strong>SGST:</strong> ₹{Number(readGstSummary(orderDetails)?.sgstAmount || 0).toLocaleString('en-IN')}
                        </p>
                      )}
                      <p style={{ margin: '0.2rem 0 0' }}>
                        <strong>Total GST:</strong> ₹{Number(readGstSummary(orderDetails)?.taxAmount || 0).toLocaleString('en-IN')}
                      </p>
                    </div>
                  )}
                </div>

                {orderDetails.deliveryAddress && (
                  <div className="order-info-section">
                    <h3>Delivery Address</h3>
                    <p>{formatAddress(orderDetails.deliveryAddress)}</p>
                    {orderDetails.deliveryAddress.contactPerson && (
                      <p><strong>Contact Person:</strong> {orderDetails.deliveryAddress.contactPerson}</p>
                    )}
                    {orderDetails.deliveryAddress.contactPhone && (
                      <p><strong>Contact Phone:</strong> {orderDetails.deliveryAddress.contactPhone}</p>
                    )}
                    {(orderDetails.deliveryAddress.shippingAddress ||
                      orderDetails.deliveryAddress.billingAddress ||
                      orderDetails.deliveryAddress.deliveryDestination ||
                      orderDetails.deliveryAddress.gstin) && (
                      <div style={{ marginTop: '0.45rem', fontSize: '0.88rem', color: '#475569' }}>
                        <p style={{ margin: 0 }}>
                          <strong>Delivery destination:</strong>{' '}
                          {orderDetails.deliveryAddress.deliveryDestination === 'billing'
                            ? 'Billing address'
                            : 'Shipping address'}
                        </p>
                        {orderDetails.deliveryAddress.gstin && (
                          <p style={{ margin: '0.2rem 0 0' }}>
                            <strong>GSTIN:</strong> {orderDetails.deliveryAddress.gstin}
                          </p>
                        )}
                        {orderDetails.deliveryAddress.shippingAddress && (
                          <p style={{ margin: '0.2rem 0 0' }}>
                            <strong>Shipping:</strong> {formatAddress(orderDetails.deliveryAddress.shippingAddress)}
                          </p>
                        )}
                        {orderDetails.deliveryAddress.billingAddress && (
                          <p style={{ margin: '0.2rem 0 0' }}>
                            <strong>Billing (GST):</strong> {formatAddress(orderDetails.deliveryAddress.billingAddress)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="order-info-section">
                  <h3>Order Status & Dates</h3>
                  <p><strong>Status:</strong> {orderDetails.status || 'pending'}</p>
                  <p><strong>Payment Status:</strong> {orderDetails.paymentStatus || 'pending'}</p>
                  {orderDetails.paymentMethod && (
                    <p><strong>Payment Method:</strong> {orderDetails.paymentMethod.replace('_', ' ').toUpperCase()}</p>
                  )}
                  {orderDetails.invoicePdfUrl && (
                    <div style={{ marginTop: '0.75rem' }}>
                      <a
                        href={orderDetails.invoicePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary"
                      >
                        Download Invoice PDF
                      </a>
                    </div>
                  )}
                  <div style={{ marginTop: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={handleDownloadReceipt}
                      className="btn-primary"
                    >
                      Download Payment Receipt
                    </button>
                  </div>
                  {orderDetails.createdAt && (
                    <p><strong>Order Date:</strong> {(() => {
                      const date = new Date(orderDetails.createdAt);
                      const day = String(date.getDate()).padStart(2, '0');
                      const month = String(date.getMonth() + 1).padStart(2, '0');
                      const year = date.getFullYear();
                      const hours = String(date.getHours()).padStart(2, '0');
                      const minutes = String(date.getMinutes()).padStart(2, '0');
                      const seconds = String(date.getSeconds()).padStart(2, '0');
                      return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds}`;
                    })()}</p>
                  )}
                  {orderDetails.expectedDeliveryDate && (
                    <p><strong>Expected Delivery:</strong> {formatDateIST(orderDetails.expectedDeliveryDate)}</p>
                  )}
                  {orderDetails.actualDeliveryDate && (
                    <p><strong>Actual Delivery:</strong> {formatDateIST(orderDetails.actualDeliveryDate)}</p>
                  )}
                </div>

                {/* Payment QR Code - Show only when order is delivered */}
                {orderDetails.status === 'delivered' && (
                  <div className="order-info-section" style={{
                    textAlign: 'center',
                    padding: '2rem',
                    backgroundColor: '#f8fafc',
                    borderRadius: '12px',
                    border: '2px solid #e2e8f0'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                      <QrCode size={20} color="#4f46e5" />
                      <h3 style={{ margin: 0, color: '#1e293b' }}>Payment QR Code</h3>
                    </div>
                    <p style={{ color: '#64748b', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                      Scan this QR code to pay ₹{orderDetails.totalAmount?.toLocaleString()}
                    </p>
                    <div style={{ 
                      display: 'flex', 
                      justifyContent: 'center', 
                      padding: '1.5rem',
                      backgroundColor: 'white',
                      borderRadius: '8px',
                      marginBottom: '1rem',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                    }}>
                      {(() => {
                        const upiUri = buildOrderUpiPayUri({
                          amountRupees: orderDetails.totalAmount,
                          orderNumber: orderDetails.orderNumber,
                          payeeName: orderDetails.supplier?.company || orderDetails.supplier?.name,
                          payeeVpa: orderDetails.supplier?.upiVpa
                        });
                        return (
                          <img
                            src={qrServerImageUrl(upiUri, 200)}
                            alt="Payment QR Code"
                            style={{
                              width: '200px',
                              height: '200px',
                              border: '1px solid #e5e7eb',
                              borderRadius: '4px'
                            }}
                          />
                        );
                      })()}
                    </div>
                    <div style={{ 
                      fontSize: '0.85rem', 
                      color: '#64748b',
                      lineHeight: '1.6',
                      marginBottom: '1rem'
                    }}>
                      <p style={{ margin: '0.25rem 0' }}><strong>Order:</strong> {orderDetails.orderNumber}</p>
                      <p style={{ margin: '0.25rem 0' }}><strong>Amount:</strong> ₹{orderDetails.totalAmount?.toLocaleString()}</p>
                      <p style={{ margin: '0.25rem 0' }}><strong>Supplier:</strong> {orderDetails.supplier?.name || orderDetails.supplier?.company || 'N/A'}</p>
                    </div>
                    {orderDetails.paymentStatus !== 'paid' && (
                      <button
                        className="btn-primary"
                        onClick={handleMarkAsPaid}
                        disabled={updatingPayment}
                        style={{
                          width: '100%',
                          marginTop: '1rem',
                          padding: '0.75rem 1.5rem',
                          fontSize: '1rem',
                          fontWeight: '600'
                        }}
                      >
                        {updatingPayment ? (
                          <>Processing...</>
                        ) : (
                          <>✓ Mark Payment as Paid</>
                        )}
                      </button>
                    )}
                    {orderDetails.paymentStatus === 'paid' && (
                      <div style={{
                        padding: '0.75rem',
                        backgroundColor: '#d1fae5',
                        borderRadius: '8px',
                        color: '#065f46',
                        fontWeight: '600',
                        textAlign: 'center',
                        marginTop: '1rem'
                      }}>
                        ✓ Payment Completed
                      </div>
                    )}
                  </div>
                )}

                {orderDetails.boq && (
                  <div className="order-info-section">
                    <h3>Related BOQ</h3>
                    <p><strong>BOQ Name:</strong> {orderDetails.boq.name || 'N/A'}</p>
                    {orderDetails.boq.itemCount && (
                      <p><strong>Total Items:</strong> {orderDetails.boq.itemCount}</p>
                    )}
                  </div>
                )}

                {orderDetails.notes && (
                  <div className="order-info-section">
                    <h3>Notes</h3>
                    <p>{orderDetails.notes}</p>
                  </div>
                )}

                <div className="order-info-section">
                  <h3>Returns</h3>
                  {Array.isArray(orderDetails.returns) && orderDetails.returns.length > 0 ? (
                    <div style={{ display: 'grid', gap: '0.5rem' }}>
                      {orderDetails.returns.map((ret) => (
                        <div key={ret.id} style={{ padding: '0.6rem', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                          <div><strong>Status:</strong> {ret.status}</div>
                          <div><strong>Qty:</strong> {ret.quantity}</div>
                          <div><strong>Reason:</strong> {ret.reason}</div>
                          {ret.tracking_id ? <div><strong>Tracking ID:</strong> {ret.tracking_id}</div> : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: '#64748b' }}>No return requests yet.</p>
                  )}
                  <button
                    className="btn-secondary"
                    type="button"
                    onClick={handleCreateReturnRequest}
                    style={{ marginTop: '0.75rem' }}
                  >
                    Request Return
                  </button>
                </div>

                {/* Supplier Rating & Feedback - only after delivery + payment */}
                {canRateCurrentOrder() && (
                  <div className="order-info-section" style={{ 
                    borderTop: '2px solid #e5e7eb',
                    paddingTop: '1.5rem',
                    marginTop: '1.5rem'
                  }}>
                    <h3>Rate Supplier</h3>
                    <p style={{ color: '#64748b', fontSize: '0.9rem', marginBottom: '0.75rem' }}>
                      Please share your experience with this supplier for this order. Your rating helps improve future recommendations.
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setRating(star)}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '1.5rem',
                            color: star <= rating ? '#f59e0b' : '#d1d5db',
                            padding: 0,
                            lineHeight: 1
                          }}
                        >
                          ★
                        </button>
                      ))}
                      <span style={{ fontSize: '0.9rem', color: '#4b5563' }}>
                        {rating ? `${rating} / 5` : 'Select rating'}
                      </span>
                    </div>
                    <textarea
                      placeholder="Write your feedback about product quality, delivery time, communication, etc."
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      rows={3}
                      style={{
                        width: '100%',
                        borderRadius: '8px',
                        border: '1px solid #d1d5db',
                        padding: '0.75rem',
                        fontSize: '0.9rem',
                        resize: 'vertical',
                        marginBottom: '0.75rem'
                      }}
                    />
                    <button
                      className="btn-primary"
                      type="button"
                      onClick={handleSubmitRating}
                      disabled={submittingRating}
                      style={{ padding: '0.6rem 1.25rem', fontSize: '0.9rem' }}
                    >
                      {submittingRating ? 'Submitting...' : 'Submit Rating'}
                    </button>
                  </div>
                )}

                {/* Delete Order Section */}
                <div className="order-info-section" style={{ 
                  borderTop: '2px solid #fee2e2',
                  paddingTop: '1.5rem',
                  marginTop: '1.5rem'
                }}>
                  <h3 style={{ color: '#dc2626' }}>Danger Zone</h3>
                  <p style={{ color: '#64748b', marginBottom: '1rem', fontSize: '0.875rem' }}>
                    Deleting an order will permanently remove it from the system. This action cannot be undone.
                    {orderDetails.status === 'delivered' && orderDetails.paymentStatus === 'paid' && (
                      <span style={{ display: 'block', color: '#dc2626', marginTop: '0.5rem', fontWeight: '600' }}>
                        ⚠️ This order has been delivered and paid. Deletion may not be allowed.
                      </span>
                    )}
                  </p>
                  <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {orderDetails.invoicePdfUrl && (
                      <a
                        className="btn-secondary"
                        href={orderDetails.invoicePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
                      >
                        <FileText size={16} />
                        Download Invoice
                      </a>
                    )}
                    <button
                      className="btn-secondary"
                      onClick={handleDeleteOrder}
                      disabled={deletingOrder || (orderDetails.status === 'delivered' && orderDetails.paymentStatus === 'paid')}
                      style={{
                        backgroundColor: deletingOrder ? '#9ca3af' : '#fee2e2',
                        color: deletingOrder ? '#6b7280' : '#dc2626',
                        border: '1px solid #dc2626',
                        cursor: deletingOrder || (orderDetails.status === 'delivered' && orderDetails.paymentStatus === 'paid') ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        opacity: deletingOrder || (orderDetails.status === 'delivered' && orderDetails.paymentStatus === 'paid') ? 0.6 : 1
                      }}
                    >
                      <Trash2 size={16} />
                      {deletingOrder ? 'Deleting...' : 'Delete Order'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="modal-body" style={{ textAlign: 'center', padding: '2rem' }}>
                <p style={{ color: '#dc2626' }}>Failed to load order details. Please try again.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ServiceProviderDashboard;