import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { authFetch, getApiUrl, resolveApiPath } from '../config/api';
import { useNavigate } from 'react-router-dom';
import { 
  Package,
  TrendingUp,
  ShoppingCart,
  Clock,
  CheckCircle,
  AlertTriangle,
  Eye,
  X,
  Save,
  Bell,
  Wallet,
  Trash2,
  FileText,
  Search
} from 'lucide-react';
import { formatDateIST, formatDateTimeIST } from '../utils/dateTime';
import {
  SUPPLIER_RETURN_ACTIONS,
  labelReturnStatus
} from '../utils/orderReturnUi';
import { SUPPLIER_CURRENT_STOCK_LABEL } from '../utils/supplierStockLabel';
import { parseSpecificationsForDisplay } from '../utils/specifications';
import ProductImageCarousel from '../components/ProductImageCarousel';
import SupplierTsinLine from '../components/SupplierTsinLine';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpStatCard from '../components/sp/SpStatCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import './Dashboard.css';
import './SupplierDashboard.css';

const SupplierDashboard = ({ user }) => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    totalProducts: 0,
    activeOrders: 0,
    totalRevenue: 0,
    pendingQuotes: 0
  });
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [orderDetails, setOrderDetails] = useState(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);
  const [deletingOrder, setDeletingOrder] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [inventorySummary, setInventorySummary] = useState(null);
  const [restockSuggestions, setRestockSuggestions] = useState(null);
  const [settlementReport, setSettlementReport] = useState(null);
  const [shipCarrier, setShipCarrier] = useState('');
  const [shipTrackingNumber, setShipTrackingNumber] = useState('');
  const [shipTrackingUrl, setShipTrackingUrl] = useState('');
  const [liveOrdersSearch, setLiveOrdersSearch] = useState('');

  const filteredLiveOrders = useMemo(() => {
    const q = (liveOrdersSearch || '').trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) => {
      const num = String(order.orderNumber ?? '').toLowerCase();
      const id = String(order.id ?? '').toLowerCase();
      return num.includes(q) || id.includes(q);
    });
  }, [orders, liveOrdersSearch]);

  const sortStatusHistory = (raw) =>
    [...(raw || [])].sort((a, b) => {
      const ta = new Date(a.timestamp || a.at || 0).getTime();
      const tb = new Date(b.timestamp || b.at || 0).getTime();
      return ta - tb;
    });

  useEffect(() => {
    const initializeDashboard = async () => {
      try {
        // Load all dashboard dependencies in parallel to reduce tab-switch buffering time.
        await Promise.allSettled([
          fetchDashboardData(),
          fetchNotifications(),
          fetchInventorySummary(),
          fetchRestockSuggestions(),
          fetchSettlementReport()
        ]);
      } catch (error) {
        console.error('Error initializing dashboard:', error);
        setLoading(false);
      }
    };
    
    initializeDashboard();
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login', { replace: true });
    }
  }, [loading, user, navigate]);

  // Close notifications when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showNotifications && !event.target.closest('[data-notification-container]')) {
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
      const response = await authFetch('/api/dashboard/supplier');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.status === 'success') {
        setStats(data.stats || {
          totalProducts: 0,
          activeOrders: 0,
          totalRevenue: 0,
          pendingQuotes: 0
        });
        setOrders(data.orders || []);
      } else {
        console.error('Failed to fetch dashboard data:', data.message);
        setStats({
          totalProducts: 0,
          activeOrders: 0,
          totalRevenue: 0,
          pendingQuotes: 0
        });
        setOrders([]);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
      setStats({
        totalProducts: 0,
        activeOrders: 0,
        totalRevenue: 0,
        pendingQuotes: 0
      });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchInventorySummary = async () => {
    try {
      const res = await authFetch('/api/supplier/inventory/summary');
      const data = await res.json();
      if (data.status === 'success') {
        setInventorySummary(data);
      }
    } catch (e) {
      console.error('Failed to fetch inventory summary:', e);
    }
  };

  const fetchRestockSuggestions = async () => {
    try {
      const res = await authFetch('/api/supplier/inventory/restock-suggestions?threshold=10&limit=3');
      const data = await res.json();
      if (data.status === 'success') {
        setRestockSuggestions(data);
      }
    } catch (e) {
      console.error('Failed to fetch restock suggestions:', e);
    }
  };

  const fetchSettlementReport = async () => {
    try {
      const res = await authFetch('/api/payments/settlement/report');
      const data = await res.json();
      if (data.status === 'success') {
        setSettlementReport(data.report || null);
      }
    } catch (e) {
      console.error('Failed to fetch settlement report:', e);
    }
  };

  const fetchOrderDetails = async (orderId) => {
    if (!orderId) {
      alert('Invalid order ID');
      return;
    }
    
    setLoadingOrderDetails(true);
    setOrderDetails(null); // Clear previous details
    
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        console.error('[Supplier Order Details] No token found');
        alert('Please log in again to view order details.');
        setSelectedOrder(null);
        setLoadingOrderDetails(false);
        return;
      }
      
      // Encode the orderId to handle special characters
      const encodedOrderId = encodeURIComponent(orderId);
      
      const apiUrl = resolveApiPath(`/api/supplier/orders/${encodedOrderId}`);
      
      console.log('[Supplier Order Details] Fetching order details from:', apiUrl);
      console.log('[Supplier Order Details] Order ID:', orderId, 'Encoded:', encodedOrderId);
      
      const response = await fetch(apiUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      
      if (!response.ok) {
        console.error('[Supplier Order Details] Response not OK:', response.status, response.statusText);
        const errorText = await response.text();
        console.error('[Supplier Order Details] Error response:', errorText);
        
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
      console.log('[Supplier Order Details] Response received:', data);
      console.log('[Supplier Order Details] Service Provider in response:', data.order?.serviceProvider);
      
      if (data.status === 'success' && data.order) {
        console.log('[Supplier Order Details] Order details loaded successfully:', data.order);
        console.log('[Supplier Order Details] Service Provider information:', {
          hasServiceProvider: !!data.order.serviceProvider,
          serviceProviderType: typeof data.order.serviceProvider,
          serviceProviderName: data.order.serviceProvider?.name,
          serviceProviderCompany: data.order.serviceProvider?.company
        });
        setOrderDetails(data.order);
        setNewStatus(data.order.status);
        setShipCarrier(data.order.shippingProvider || '');
        setShipTrackingNumber(data.order.trackingNumber || '');
        setShipTrackingUrl(data.order.trackingUrl || '');
      } else {
        console.error('[Supplier Order Details] Invalid response format:', data);
        alert(data.message || 'Failed to load order details. Please try again.');
        setSelectedOrder(null);
      }
    } catch (error) {
      console.error('[Supplier Order Details] Failed to fetch order details:', error);
      console.error('[Supplier Order Details] Error details:', {
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
    console.log('Viewing supplier order:', orderId);
    if (!orderId) {
      console.error('No order ID provided');
      alert('Invalid order ID');
      return;
    }
    setSelectedOrder(orderId);
    fetchOrderDetails(orderId);
  };

  const handleCloseOrderDetails = () => {
    setSelectedOrder(null);
    setOrderDetails(null);
    setNewStatus('');
    setShipCarrier('');
    setShipTrackingNumber('');
    setShipTrackingUrl('');
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
      const response = await fetch(getApiUrl(`/api/dashboard/supplier/orders/${encodedOrderId}`), {
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

  const handleUpdateStatus = async () => {
    if (!selectedOrder || !newStatus) {
      alert('Please select a status to update');
      return;
    }
    
    setUpdatingStatus(true);
    try {
      const token = localStorage.getItem('token');
      // Encode the orderId to handle special characters
      const encodedOrderId = encodeURIComponent(selectedOrder);
      const body = {
        status: newStatus,
        notes: `Status updated to ${newStatus} by supplier`
      };
      if (newStatus === 'shipped') {
        if (shipCarrier.trim()) body.shippingProvider = shipCarrier.trim();
        if (shipTrackingNumber.trim()) body.trackingNumber = shipTrackingNumber.trim();
        if (shipTrackingUrl.trim()) body.trackingUrl = shipTrackingUrl.trim();
      }

      const response = await fetch(getApiUrl(`/api/supplier/orders/${encodedOrderId}/status`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      
      const data = await response.json();
      console.log('Update status response:', data);
      
      if (data.status === 'success') {
        alert('Order status updated successfully');
        // Refresh order details to show updated status
        await fetchOrderDetails(selectedOrder);
        // Refresh dashboard to update order list
        fetchDashboardData();
      } else {
        console.error('Update status error:', data);
        alert(data.message || 'Failed to update order status. Please try again.');
      }
    } catch (error) {
      console.error('Failed to update order status:', error);
      alert('Failed to update order status. Please check your connection and try again.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handleUpdateReturnStatus = async (returnId, nextStatus) => {
    const supplierNotes = window.prompt(`Optional notes for status "${nextStatus}":`, '');
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/supplier/returns/${returnId}/status`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          status: nextStatus,
          ...(supplierNotes ? { supplierNotes } : {})
        })
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        alert(data.message || 'Failed to update return status.');
        return;
      }
      alert('Return status updated.');
      await fetchOrderDetails(selectedOrder);
      fetchDashboardData();
    } catch (error) {
      console.error('Failed to update return status:', error);
      alert('Failed to update return status.');
    }
  };

  const fetchNotifications = async () => {
    try {
      const response = await authFetch('/api/supplier/notifications');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      if (data.status === 'success') {
        console.log('Notifications fetched:', data.notifications?.length || 0, 'notifications,', data.unreadCount || 0, 'unread');
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      } else {
        console.error('Failed to fetch notifications:', data.message);
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
      setNotifications([]);
      setUnreadCount(0);
    }
  };

  const markNotificationAsRead = async (notificationId) => {
    try {
      const token = localStorage.getItem('token');
        await fetch(getApiUrl(`/api/supplier/notifications/${notificationId}/read`), {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      fetchNotifications(); // Refresh notifications
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  const normalizeNotification = (notification) => ({
    id: notification?.id || notification?._id,
    isRead: notification?.is_read ?? notification?.isRead ?? false,
    createdAt: notification?.created_at || notification?.createdAt || null,
    title: notification?.title || '',
    message: notification?.message || '',
    type: notification?.type || '',
    relatedOrderNumber:
      notification?.related_order?.order_number ||
      notification?.relatedOrder?.orderNumber ||
      null,
    metadata:
      notification?.metadata && typeof notification.metadata === 'object'
        ? notification.metadata
        : {}
  });

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


  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading dashboard...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Redirecting to login…</p>
      </div>
    );
  }

  return (
    <SpPageLayout showStepper={false}>
      <div className="dashboard-container supplier-dashboard-page !max-w-none !p-0">
        <SpPageHeader
          title={`Welcome back, ${user?.name || 'Supplier'}`}
          description="Manage your products, inventory, POS sales and incoming orders"
          icon={Package}
          actions={
            <>
              <Button variant="outline" onClick={() => navigate('/supplier-returns')}>
                Returns
              </Button>
              <Button variant="outline" onClick={() => navigate('/product-management')}>
                Manage Products
              </Button>
              <Button variant="outline" onClick={() => navigate('/supplier-upstream')}>Upstream sourcing</Button>
              <Button onClick={() => navigate('/supplier-upstream-orders')}>My upstream orders</Button>
            </>
          }
        />
        <div className="supplier-dashboard-notifications-wrap">
        <div className="supplier-dashboard-notifications-anchor" data-notification-container>
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="supplier-dashboard-notifications-toggle"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="supplier-dashboard-notifications-badge">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
          
          {showNotifications && (
            <div 
              data-notification-container
              className="supplier-dashboard-notifications-panel"
            >
              <div className="supplier-dashboard-notifications-header">
                <h3 className="supplier-dashboard-notifications-title">Notifications</h3>
                {unreadCount > 0 && (
                  <button
                    onClick={async () => {
                      try {
                        const token = localStorage.getItem('token');
                        await fetch(getApiUrl('/api/supplier/notifications/read-all'), {
                          method: 'PATCH',
                          headers: {
                            'Authorization': `Bearer ${token}`
                          }
                        });
                        fetchNotifications();
                      } catch (error) {
                        console.error('Failed to mark all as read:', error);
                      }
                    }}
                    className="supplier-dashboard-notifications-read-all"
                  >
                    Mark all as read
                  </button>
                )}
              </div>
              <div>
                {notifications.length === 0 ? (
                  <div className="supplier-dashboard-notifications-empty">
                    No notifications
                  </div>
                ) : (
                  notifications.map((rawNotification) => {
                    const notification = normalizeNotification(rawNotification);
                    const receiptPdfUrl = notification.metadata?.receiptPdfUrl || null;
                    const invoicePdfUrl = notification.metadata?.invoicePdfUrl || null;
                    return (
                    <div
                      key={notification.id}
                      onClick={() => {
                        if (!notification.isRead) {
                          markNotificationAsRead(notification.id);
                        }
                        if (notification.relatedOrderNumber) {
                          setSelectedOrder(notification.relatedOrderNumber);
                          fetchOrderDetails(notification.relatedOrderNumber);
                          setShowNotifications(false);
                        }
                      }}
                      className={`supplier-dashboard-notification-item ${
                        notification.isRead ? 'supplier-dashboard-notification-item-read' : 'supplier-dashboard-notification-item-unread'
                      }`}
                      onMouseEnter={(e) => {
                        if (notification.isRead) {
                          e.currentTarget.classList.add('supplier-dashboard-notification-item-hover');
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (notification.isRead) {
                          e.currentTarget.classList.remove('supplier-dashboard-notification-item-hover');
                        }
                      }}
                    >
                      <div className="supplier-dashboard-notification-row">
                        <div
                          className="supplier-dashboard-notification-icon-wrap"
                          style={{
                            background:
                            notification.type === 'payment_received'
                              ? '#d1fae5'
                              : notification.type === 'credit_limit'
                                ? '#fef3c7'
                                : '#dbeafe',
                          }}
                        >
                          {notification.type === 'payment_received' ? (
                            <Wallet size={20} color="#059669" />
                          ) : notification.type === 'credit_limit' ? (
                            <AlertTriangle size={20} color="#d97706" />
                          ) : (
                            <Bell size={20} color="#3b82f6" />
                          )}
                        </div>
                        <div className="supplier-dashboard-notification-content">
                          <div
                            className={`supplier-dashboard-notification-title ${
                              notification.isRead
                                ? 'supplier-dashboard-notification-title-read'
                                : 'supplier-dashboard-notification-title-unread'
                            }`}
                          >
                            {notification.title}
                          </div>
                          <div className="supplier-dashboard-notification-message">
                            {notification.message}
                          </div>
                          {(receiptPdfUrl || invoicePdfUrl) && (
                            <div className="supplier-dashboard-notification-links">
                              {receiptPdfUrl && (
                                <a
                                  href={receiptPdfUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="supplier-dashboard-notification-link"
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
                                  className="supplier-dashboard-notification-link"
                                >
                                  Download Invoice
                                </a>
                              )}
                            </div>
                          )}
                          <div className="supplier-dashboard-notification-time">
                            {formatDate(notification.createdAt)}
                          </div>
                        </div>
                        {!notification.isRead && (
                          <div className="supplier-dashboard-notification-dot" />
                        )}
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
        </div>
      {/* Stats Cards */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <SpStatCard label="Total Products" value={stats.totalProducts} icon={Package} accent="indigo" />
        <SpStatCard label="Active Orders" value={stats.activeOrders} icon={ShoppingCart} accent="emerald" />
        <SpStatCard
          label="Net Platform Revenue"
          value={`₹${Number(stats.totalRevenue || 0).toLocaleString()}`}
          icon={TrendingUp}
          accent="amber"
        />
        <SpStatCard label="Pending Quotes" value={stats.pendingQuotes} icon={Clock} accent="rose" />
        <SpStatCard
          label="Inventory Units"
          value={inventorySummary?.summary?.totalStockQty ?? 0}
          icon={Package}
          accent="indigo"
          hint={`Value ₹${Number(inventorySummary?.summary?.totalStockValue || 0).toLocaleString()}`}
        />
      </div>

      <Card className="sp-market-card supplier-dashboard-restock-card mb-6">
        <CardContent className="p-5">
          <div className="supplier-dashboard-restock-header">
            <div>
              <div className="supplier-dashboard-restock-title">Restock suggestions</div>
              <div className="supplier-dashboard-restock-subtitle">
                Items with {SUPPLIER_CURRENT_STOCK_LABEL.toLowerCase()} at or below{' '}
                {restockSuggestions?.threshold ?? 10}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/supplier-upstream')}>
              Open upstream sourcing
            </Button>
          </div>

          {Array.isArray(restockSuggestions?.items) && restockSuggestions.items.length > 0 ? (
            <div className="supplier-dashboard-restock-list">
              {restockSuggestions.items.slice(0, 5).map((it) => (
                <div key={it.supplierProductId} className="supplier-dashboard-restock-item">
                  <div className="supplier-dashboard-restock-item-head">
                    <div>
                      <div className="supplier-dashboard-restock-product">
                        {it.productName || 'Unmapped product'}
                      </div>
                      <div className="supplier-dashboard-restock-meta">
                        {SUPPLIER_CURRENT_STOCK_LABEL}: {it.stock ?? 0}
                        {it.brandModel ? (
                          <span className="supplier-dashboard-restock-brand"> · {it.brandModel}</span>
                        ) : null}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="supplier-dashboard-restock-action"
                      onClick={() =>
                        navigate(
                          `/supplier-upstream?supplierProductIds=${encodeURIComponent(it.supplierProductId)}`
                        )
                      }
                    >
                      Source
                    </Button>
                  </div>
                  {Array.isArray(it.suggestions) && it.suggestions.length > 0 ? (
                    <div className="supplier-dashboard-restock-suggestions">
                      {it.suggestions.map((s) => (
                        <div key={s.supplierProductId} className="supplier-dashboard-restock-offer">
                          <span className="supplier-dashboard-restock-offer-name">{s.supplierName}</span>
                          <span className="supplier-dashboard-restock-offer-meta">
                            {typeof s.distanceKm === 'number' ? `${s.distanceKm} km` : 'Distance n/a'}
                            {typeof s.stock === 'number'
                              ? ` · ${SUPPLIER_CURRENT_STOCK_LABEL.toLowerCase()} ${s.stock}`
                              : ''}
                            {typeof s.price === 'number' ? ` · ₹${Number(s.price).toLocaleString()}` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="supplier-dashboard-restock-empty">
                      {it.message || 'No upstream matches found for this item.'}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="supplier-dashboard-restock-empty supplier-dashboard-restock-empty--panel">
              No low-stock items right now. Inventory above the restock threshold looks healthy.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="dashboard-content">
        <div className="dashboard-section">
          <div className="section-header">
            <h2>Payment Confidence & Settlement</h2>
          </div>
          <div className="items-list">
            <div className="item-card">
              <div className="item-info">
                <h4>Captured Payments</h4>
                <p>{settlementReport?.transactionCount || 0} transactions</p>
              </div>
              <div className="item-status">
                <span className="status confirmed">
                  ₹{Number(settlementReport?.totalCaptured || 0).toLocaleString()}
                </span>
              </div>
            </div>
            {settlementReport?.byMethod && Object.keys(settlementReport.byMethod).length > 0 && (
              Object.entries(settlementReport.byMethod).map(([method, amount]) => (
                <div className="item-card" key={method}>
                  <div className="item-info">
                    <h4>{String(method).replace('_', ' ').toUpperCase()}</h4>
                    <p>Settlement method breakdown</p>
                  </div>
                  <div className="item-status">
                    <span className="status delivered">₹{Number(amount || 0).toLocaleString()}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Live Orders */}
        <div className="dashboard-section">
          <div className="section-header">
            <h2>Live Orders</h2>
            <button className="btn-secondary">View All</button>
          </div>

          <div className="live-orders-search supplier-dashboard-live-search">
            <Search size={18} className="supplier-dashboard-live-search-icon" aria-hidden />
            <input
              type="search"
              value={liveOrdersSearch}
              onChange={(e) => setLiveOrdersSearch(e.target.value)}
              placeholder="Search by order number…"
              aria-label="Search orders by order number"
              className="supplier-dashboard-live-search-input"
            />
          </div>
          
          <div className="items-list">
            {orders.length > 0 ? (
              filteredLiveOrders.length > 0 ? (
              filteredLiveOrders.map((order) => (
                <div 
                  key={order.id} 
                  className="item-card supplier-dashboard-live-order-card"
                  onClick={() => handleViewOrder(order.orderNumber || order.id)}
                  title="Click to view order details"
                >
                  <div className="item-info">
                    <h4 className="supplier-dashboard-live-order-title">
                      Order {order.orderNumber || `#${order.id}`}
                      {order.chainUpstreamOrder ? (
                        <span className="supplier-dashboard-chain-chip" title="Buyer is a supply-chain partner (upstream purchase)">
                          Chain / upstream
                        </span>
                      ) : null}
                    </h4>
                    <p>
                      {order.customer}
                      {order.company && ` • ${order.company}`}
                      {order.itemCount > 0 && ` • ${order.itemCount} item${order.itemCount > 1 ? 's' : ''}`}
                    </p>
                    <p className="supplier-dashboard-live-order-amount">
                      Amount: ₹{order.amount.toLocaleString()}
                      {order.createdAt && ` • ${formatDateIST(order.createdAt, '—')}`}
                    </p>
                  </div>
                  <div className="item-status">
                    <span className={`status ${order.status}`}>
                      {order.status === 'delivered' ? <CheckCircle size={16} /> : 
                       order.status === 'confirmed' ? <CheckCircle size={16} /> :
                       order.status === 'pending' ? <Clock size={16} /> : <AlertTriangle size={16} />}
                      {order.status === 'confirmed' ? 'Confirmed' : order.status}
                    </span>
                  </div>
                  <div className="supplier-dashboard-live-order-actions">
                    {order.invoicePdfUrl && String(order.paymentStatus || '').toLowerCase() === 'paid' && (
                      <a
                        href={order.invoicePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-icon supplier-dashboard-invoice-link"
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
                        handleViewOrder(order.orderNumber || order.id);
                      }}
                      title="View order details"
                    >
                      <Eye size={16} />
                    </button>
                  </div>
                </div>
              ))
              ) : (
                <div className="empty-state supplier-dashboard-empty-orders">
                  <p className="supplier-dashboard-empty-orders-text">
                    No orders match <strong>“{liveOrdersSearch.trim()}”</strong>. Try another order number.
                  </p>
                </div>
              )
            ) : (
              <div className="empty-state">
                <ShoppingCart size={48} />
                <h3>No orders yet</h3>
                <p>Orders from buyers (service providers and supply-chain partners) will appear here</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Order Details Modal */}
      {selectedOrder ? createPortal((
        <div className="modal-overlay" onClick={handleCloseOrderDetails}>
          <div className="modal-content supplier-dashboard-order-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Order Details - {orderDetails?.orderNumber || 'Loading...'}</h2>
              <button className="btn-icon" onClick={handleCloseOrderDetails}>
                <X size={20} />
              </button>
            </div>
            
            {loadingOrderDetails ? (
              <div className="modal-body supplier-dashboard-modal-body-center">
                <div className="spinner" />
                <p>Loading order details...</p>
              </div>
            ) : orderDetails ? (
              <div className="modal-body">
                <div className="order-info-section">
                  <h3>Customer Information</h3>
                  <p><strong>Name:</strong> {orderDetails.serviceProvider?.name || 'N/A'}</p>
                  <p><strong>Company:</strong> {orderDetails.serviceProvider?.company || 'N/A'}</p>
                  {orderDetails.serviceProvider?.email && (
                    <p><strong>Email:</strong> {orderDetails.serviceProvider.email}</p>
                  )}
                  {orderDetails.serviceProvider?.phone && (
                    <p><strong>Phone:</strong> {orderDetails.serviceProvider.phone}</p>
                  )}
                  {orderDetails.serviceProvider?.address && (
                    <div className="supplier-dashboard-address-wrap">
                      <p><strong>Address:</strong></p>
                      <p className="supplier-dashboard-address-text">
                        {[
                          orderDetails.serviceProvider.address.line1 || orderDetails.serviceProvider.address.street,
                          orderDetails.serviceProvider.address.line2,
                          orderDetails.serviceProvider.address.city,
                          orderDetails.serviceProvider.address.state,
                          orderDetails.serviceProvider.address.zipCode || orderDetails.serviceProvider.address.pincode,
                          orderDetails.serviceProvider.address.country
                        ].filter(Boolean).join(', ')}
                      </p>
                    </div>
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
                                <div className="supplier-dashboard-item-image-wrap">
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
                                <div className="supplier-dashboard-item-description">
                                  {item.product.description}
                                </div>
                              )}
                              <SupplierTsinLine
                                asin={item.asin || item.parentAsin}
                                variantAsin={item.variantAsin}
                              />
                              {parseSpecificationsForDisplay(item.specifications).length > 0 && (
                                <div className="supplier-dashboard-specifications-wrap">
                                  {parseSpecificationsForDisplay(item.specifications).map((entry) => (
                                    <span
                                      key={`${entry.label}-${entry.value}`}
                                      className="supplier-dashboard-spec-pill"
                                      title={`${entry.label}: ${entry.value}`}
                                    >
                                      <strong>{entry.label}:</strong> {entry.value}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {item.brandModel && (
                                <div className="supplier-dashboard-item-brand-model">
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
                    <p className="supplier-dashboard-muted-text">No items found in this order.</p>
                  )}
                  {readGstSummary(orderDetails) && (
                    <div className="supplier-dashboard-gst-summary">
                      <p className="supplier-dashboard-gst-row supplier-dashboard-gst-row-first">
                        <strong>Taxable subtotal:</strong> ₹{Number(readGstSummary(orderDetails)?.subtotalAmount || 0).toLocaleString('en-IN')}
                      </p>
                      <p className="supplier-dashboard-gst-row">
                        <strong>GST type:</strong> {readGstSummary(orderDetails)?.taxType === 'IGST' ? 'IGST' : 'CGST + SGST'}
                      </p>
                      {readGstSummary(orderDetails)?.taxType === 'IGST' ? (
                        <p className="supplier-dashboard-gst-row">
                          <strong>IGST:</strong> ₹{Number(readGstSummary(orderDetails)?.igstAmount || 0).toLocaleString('en-IN')}
                        </p>
                      ) : (
                        <p className="supplier-dashboard-gst-row">
                          <strong>CGST:</strong> ₹{Number(readGstSummary(orderDetails)?.cgstAmount || 0).toLocaleString('en-IN')} | <strong>SGST:</strong> ₹{Number(readGstSummary(orderDetails)?.sgstAmount || 0).toLocaleString('en-IN')}
                        </p>
                      )}
                      <p className="supplier-dashboard-gst-row">
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
                      <div className="supplier-dashboard-delivery-meta">
                        <p className="supplier-dashboard-delivery-row supplier-dashboard-delivery-row-first">
                          <strong>Delivery destination:</strong>{' '}
                          {orderDetails.deliveryAddress.deliveryDestination === 'billing'
                            ? 'Billing address'
                            : 'Shipping address'}
                        </p>
                        {orderDetails.deliveryAddress.gstin && (
                          <p className="supplier-dashboard-delivery-row">
                            <strong>GSTIN:</strong> {orderDetails.deliveryAddress.gstin}
                          </p>
                        )}
                        {orderDetails.deliveryAddress.shippingAddress && (
                          <p className="supplier-dashboard-delivery-row">
                            <strong>Shipping:</strong> {formatAddress(orderDetails.deliveryAddress.shippingAddress)}
                          </p>
                        )}
                        {orderDetails.deliveryAddress.billingAddress && (
                          <p className="supplier-dashboard-delivery-row">
                            <strong>Billing (GST):</strong> {formatAddress(orderDetails.deliveryAddress.billingAddress)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="order-info-section">
                  <h3>Order Status & Dates</h3>
                  <div className="status-update-section">
                    <label>
                      <strong>Current Status:</strong>
                      <select 
                        value={newStatus} 
                        onChange={(e) => setNewStatus(e.target.value)}
                        disabled={updatingStatus}
                      >
                        <option value="pending">Pending</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="processing">Processing</option>
                        <option value="shipped">Shipped</option>
                        <option value="delivered">Delivered</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </label>
                    {newStatus === 'shipped' && (
                      <div className="supplier-dashboard-shipping-fields">
                        <label className="supplier-dashboard-shipping-label">
                          <span className="supplier-dashboard-shipping-label-text">Carrier (optional)</span>
                          <input
                            type="text"
                            value={shipCarrier}
                            onChange={(e) => setShipCarrier(e.target.value)}
                            placeholder="e.g. BlueDart"
                            disabled={updatingStatus}
                            className="supplier-dashboard-shipping-input"
                          />
                        </label>
                        <label className="supplier-dashboard-shipping-label">
                          <span className="supplier-dashboard-shipping-label-text">Tracking number (optional)</span>
                          <input
                            type="text"
                            value={shipTrackingNumber}
                            onChange={(e) => setShipTrackingNumber(e.target.value)}
                            placeholder="AWB / tracking ID"
                            disabled={updatingStatus}
                            className="supplier-dashboard-shipping-input"
                          />
                        </label>
                        <label className="supplier-dashboard-shipping-label">
                          <span className="supplier-dashboard-shipping-label-text">Tracking URL (optional)</span>
                          <input
                            type="url"
                            value={shipTrackingUrl}
                            onChange={(e) => setShipTrackingUrl(e.target.value)}
                            placeholder="https://..."
                            disabled={updatingStatus}
                            className="supplier-dashboard-shipping-input"
                          />
                        </label>
                      </div>
                    )}
                    <button 
                      className="btn-primary"
                      onClick={handleUpdateStatus}
                      disabled={updatingStatus || newStatus === orderDetails.status}
                    >
                      {updatingStatus ? 'Updating...' : <><Save size={16} /> Update Status</>}
                    </button>
                  </div>
                  <p><strong>Payment Status:</strong> {orderDetails.paymentStatus || 'pending'}</p>
                  {orderDetails.paymentMethod && (
                    <p><strong>Payment Method:</strong> {orderDetails.paymentMethod.replace('_', ' ').toUpperCase()}</p>
                  )}
                  {orderDetails.invoicePdfUrl && (
                    <div className="supplier-dashboard-invoice-cta-wrap">
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
                  <div className="supplier-dashboard-receipt-cta-wrap">
                    <button
                      type="button"
                      onClick={handleDownloadReceipt}
                      className="btn-primary"
                    >
                      Download Payment Receipt
                    </button>
                  </div>
                  {orderDetails.createdAt && (
                    <p><strong>Order Date:</strong> {formatDate(orderDetails.createdAt)}</p>
                  )}
                  {orderDetails.expectedDeliveryDate && (
                    <p><strong>Expected Delivery:</strong> {formatDateIST(orderDetails.expectedDeliveryDate)}</p>
                  )}
                  {orderDetails.actualDeliveryDate && (
                    <p><strong>Actual Delivery:</strong> {formatDateIST(orderDetails.actualDeliveryDate)}</p>
                  )}
                  {(orderDetails.trackingNumber || orderDetails.trackingUrl || orderDetails.shippingProvider) && (
                    <div className="supplier-dashboard-shipment-box">
                      <strong>Shipment</strong>
                      {orderDetails.shippingProvider ? <p className="supplier-dashboard-shipment-row">Carrier: {orderDetails.shippingProvider}</p> : null}
                      {orderDetails.trackingNumber ? <p className="supplier-dashboard-shipment-row">Tracking: {orderDetails.trackingNumber}</p> : null}
                      {orderDetails.trackingUrl ? (
                        <p className="supplier-dashboard-shipment-row">
                          <a href={orderDetails.trackingUrl} target="_blank" rel="noopener noreferrer">Open tracking</a>
                        </p>
                      ) : null}
                    </div>
                  )}
                </div>

                {Array.isArray(orderDetails.statusHistory) && orderDetails.statusHistory.length > 0 && (
                  <div className="order-info-section">
                    <h3>Status timeline</h3>
                    <ol className="supplier-dashboard-status-timeline">
                      {sortStatusHistory(orderDetails.statusHistory).map((ev, idx) => (
                        <li key={idx} className="supplier-dashboard-status-timeline-item">
                          <strong>{ev.status || '—'}</strong>
                          {ev.timestamp || ev.at ? (
                            <span className="supplier-dashboard-muted-text"> — {formatDateTimeIST(ev.timestamp || ev.at, '—')}</span>
                          ) : null}
                          {ev.notes ? <div className="supplier-dashboard-status-note">{ev.notes}</div> : null}
                        </li>
                      ))}
                    </ol>
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

                {orderDetails.internalNotes && (
                  <div className="order-info-section">
                    <h3>Internal Notes</h3>
                    <p>{orderDetails.internalNotes}</p>
                  </div>
                )}

                <div className="order-info-section">
                  <h3>Return Requests</h3>
                  {Array.isArray(orderDetails.returns) && orderDetails.returns.length > 0 ? (
                    <div className="supplier-dashboard-returns-grid">
                      {orderDetails.returns.map((ret) => (
                        <div key={ret.id} className="supplier-dashboard-return-card">
                          <div><strong>Status:</strong> {labelReturnStatus(ret.status)}</div>
                          <div><strong>Qty:</strong> {ret.quantity}</div>
                          <div><strong>Reason:</strong> {ret.reason}</div>
                          {ret.tracking_id ? <div><strong>Tracking ID:</strong> {ret.tracking_id}</div> : null}
                          <div className="supplier-dashboard-return-actions">
                            {(SUPPLIER_RETURN_ACTIONS[ret.status] || []).map((nextStatus) => (
                              <button
                                key={nextStatus}
                                className="btn-secondary"
                                onClick={() => handleUpdateReturnStatus(ret.id, nextStatus)}
                              >
                                Mark {labelReturnStatus(nextStatus)}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="supplier-dashboard-muted-text">No return requests for this order.</p>
                  )}
                </div>

                {/* Delete Order Section */}
                <div className="order-info-section supplier-dashboard-danger-zone">
                  <h3 className="supplier-dashboard-danger-title">Danger Zone</h3>
                  <p className="supplier-dashboard-danger-text">
                    Deleting an order will permanently remove it from the system. This action cannot be undone.
                    {orderDetails.status === 'delivered' && orderDetails.paymentStatus === 'paid' && (
                      <span className="supplier-dashboard-danger-warning">
                        ⚠️ This order has been delivered and paid. Deletion may not be allowed.
                      </span>
                    )}
                  </p>
                  <div className="supplier-dashboard-danger-actions">
                    {orderDetails.invoicePdfUrl && (
                      <a
                        className="btn-secondary supplier-dashboard-danger-link"
                        href={orderDetails.invoicePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <FileText size={16} />
                        Download Invoice
                      </a>
                    )}
                    <button
                      className={`btn-secondary supplier-dashboard-danger-delete ${
                        deletingOrder || (orderDetails.status === 'delivered' && orderDetails.paymentStatus === 'paid')
                          ? 'supplier-dashboard-danger-delete-disabled'
                          : 'supplier-dashboard-danger-delete-active'
                      }`}
                      onClick={handleDeleteOrder}
                      disabled={deletingOrder || (orderDetails.status === 'delivered' && orderDetails.paymentStatus === 'paid')}
                    >
                      <Trash2 size={16} />
                      {deletingOrder ? 'Deleting...' : 'Delete Order'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="modal-body supplier-dashboard-modal-body-center">
                <p className="supplier-dashboard-error-text">Failed to load order details. Please try again.</p>
              </div>
            )}
          </div>
        </div>
      ), document.body) : null}

      </div>
    </SpPageLayout>
  );
};

export default SupplierDashboard;