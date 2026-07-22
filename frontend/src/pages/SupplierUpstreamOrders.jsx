import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getApiUrl, authFetch, buildAuthHeaders } from '../config/api';
import './Dashboard.css';
import './SupplierUpstream.css';
import './SupplierUpstreamOrders.css';
import {
  ClipboardList,
  Search,
  RefreshCw,
  Trash2,
  Loader2,
  AlertTriangle,
  CheckCircle,
  X,
  QrCode,
  Plus,
  Package
} from 'lucide-react';
import { buildOrderUpiPayUri, qrServerImageUrl } from '../utils/upiPaymentQr';
import { formatDateIST, formatDateTimeIST } from '../utils/dateTime';
import {
  canRequestReturnForOrder,
  getReturnRequestBlockReason,
  labelReturnStatus
} from '../utils/orderReturnUi';
import ProductImageCarousel from '../components/ProductImageCarousel';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpStatCard from '../components/sp/SpStatCard';
import { Button } from '@/components/ui/button';

const sortStatusHistory = (raw) =>
  [...(raw || [])].sort((a, b) => {
    const ta = new Date(a.timestamp || a.at || 0).getTime();
    const tb = new Date(b.timestamp || b.at || 0).getTime();
    return ta - tb;
  });

const paymentMethodLabel = (method) => {
  const pm = String(method || '').toLowerCase();
  if (pm === 'cash') return 'Cash on delivery';
  if (pm === 'online') return 'Pay online';
  if (pm === 'upi') return 'UPI';
  if (pm === 'bank_transfer') return 'Bank transfer';
  if (pm === 'card') return 'Credit / Debit Card';
  if (pm === 'credit') return 'Credit / pay later';
  if (!pm) return 'Pay online';
  return pm.replace(/_/g, ' ');
};

function StatusBadge({ status }) {
  const normalized = String(status || 'pending');
  const map = {
    delivered: { tone: 'success', icon: CheckCircle },
    confirmed: { tone: 'info', icon: CheckCircle },
    pending: { tone: 'warning', icon: AlertTriangle },
    cancelled: { tone: 'danger', icon: AlertTriangle },
    processing: { tone: 'sky', icon: AlertTriangle },
    shipped: { tone: 'sky', icon: AlertTriangle },
    returned: { tone: 'danger', icon: AlertTriangle }
  };
  const cfg = map[normalized] || map.pending;
  const Icon = cfg.icon;
  return (
    <span className={`upstream-status-pill upstream-status-${cfg.tone}`}>
      <Icon size={14} className="upstream-icon-gap" />
      {normalized}
    </span>
  );
}

export default function SupplierUpstreamOrders() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');

  const [orderModalId, setOrderModalId] = useState(null);
  const [orderDetails, setOrderDetails] = useState(null);
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);
  const [updatingPayment, setUpdatingPayment] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [loadingWalletBalance, setLoadingWalletBalance] = useState(false);

  const fetchOrders = useCallback(async () => {
    const res = await authFetch('/api/supplier/upstream/orders?all=true', { cache: 'no-cache' });
    const data = await res.json();
    if (data.status === 'success') {
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } else {
      throw new Error(data.message || 'Failed to load orders');
    }
  }, []);

  const refreshOrders = async () => {
    setRefreshing(true);
    try {
      await fetchOrders();
    } catch (e) {
      console.error('Failed to refresh upstream orders:', e);
      alert(e?.message || 'Failed to refresh orders');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await fetchOrders();
      } catch (e) {
        console.error('Failed to load upstream orders:', e);
        alert(e?.message || 'Failed to load orders');
      } finally {
        setLoading(false);
      }
    })();
  }, [fetchOrders]);

  const fetchOrderDetails = useCallback(async (orderNumberOrId) => {
    if (!orderNumberOrId) return;
    setLoadingOrderDetails(true);
    setOrderDetails(null);
    try {
      const token = localStorage.getItem('token');
      const encoded = encodeURIComponent(orderNumberOrId);
      const res = await fetch(getApiUrl(`/api/dashboard/service-provider/orders/${encoded}`), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-cache'
      });
      const data = await res.json();
      if (data.status === 'success') {
        setOrderDetails(data.order);
      } else {
        alert(data.message || 'Failed to load order details.');
      }
    } catch (e) {
      console.error('Order details fetch error:', e);
      alert('Failed to load order details. Please try again.');
    } finally {
      setLoadingOrderDetails(false);
    }
  }, []);

  const openOrder = useCallback(
    (orderNumber) => {
      if (!orderNumber) return;
      setOrderModalId(orderNumber);
      setSearchParams({ order: orderNumber }, { replace: true });
      fetchOrderDetails(orderNumber);
    },
    [fetchOrderDetails, setSearchParams]
  );

  const closeOrderModal = () => {
    setOrderModalId(null);
    setOrderDetails(null);
    if (searchParams.get('order')) {
      setSearchParams({}, { replace: true });
    }
  };

  useEffect(() => {
    const fromUrl = searchParams.get('order');
    if (!fromUrl || loading) return;
    if (orderModalId === fromUrl) return;
    openOrder(fromUrl);
  }, [searchParams, loading, orderModalId, openOrder]);

  const filteredOrders = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    return (orders || []).filter((order) => {
      const status = String(order.status || '').toLowerCase();
      const payment = String(order.paymentStatus || '').toLowerCase();
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (paymentFilter !== 'all' && payment !== paymentFilter) return false;
      if (!q) return true;
      return [order.orderNumber, order.supplierName, order.status, order.paymentStatus, order.paymentMethod]
        .map((v) => String(v || '').toLowerCase())
        .some((v) => v.includes(q));
    });
  }, [orders, query, statusFilter, paymentFilter]);

  const stats = useMemo(() => {
    const active = orders.filter((o) => !['delivered', 'cancelled'].includes(String(o.status || '').toLowerCase()));
    const inTransit = orders.filter((o) =>
      ['shipped', 'processing'].includes(String(o.status || '').toLowerCase())
    );
    const pendingPayment = orders.filter(
      (o) => String(o.paymentStatus || '').toLowerCase() !== 'paid'
    );
    const totalValue = orders.reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);
    return {
      total: orders.length,
      active: active.length,
      inTransit: inTransit.length,
      pendingPayment: pendingPayment.length,
      totalValue
    };
  }, [orders]);

  const handleMarkAsPaid = async () => {
    if (!orderModalId) return;
    const confirmed = window.confirm(
      `Pay this order from wallet?\nOrder: ${orderDetails?.orderNumber}\nAmount: ₹${orderDetails?.totalAmount?.toLocaleString()}`
    );
    if (!confirmed) return;

    setUpdatingPayment(true);
    try {
      const encodedOrderId = encodeURIComponent(orderDetails?.id || orderModalId);
      const response = await fetch(getApiUrl(`/api/supplier/wallet/orders/${encodedOrderId}/pay`), {
        method: 'POST',
        headers: buildAuthHeaders({
          'Content-Type': 'application/json',
          Accept: 'application/json'
        }),
        body: JSON.stringify({
          idempotencyKey: `supplier-wallet-order-pay-${orderDetails?.id || orderModalId}-${Date.now()}`
        })
      });

      const data = await response.json().catch(() => ({}));
      if (response.ok && data.status === 'success') {
        alert('Order payment completed from vault successfully.');
        await fetchOrderDetails(orderModalId);
        await fetchOrders();
      } else {
        alert(data.message || 'Failed to pay from vault. Please try again.');
      }
    } catch (error) {
      console.error('Failed to pay from vault:', error);
      alert('Failed to pay from vault. Please check your connection and try again.');
    } finally {
      setUpdatingPayment(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!orderDetails || String(orderDetails.paymentStatus || '').toLowerCase() === 'paid') return undefined;
    const loadWalletBalance = async () => {
      setLoadingWalletBalance(true);
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const resp = await fetch(getApiUrl('/api/supplier/wallet/balance'), {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-cache'
        });
        const data = await resp.json().catch(() => ({}));
        if (!cancelled && resp.ok && data.status === 'success') {
          setWalletBalance(Number(data.balance || data.wallet?.balance || 0));
        }
      } finally {
        if (!cancelled) setLoadingWalletBalance(false);
      }
    };
    void loadWalletBalance();
    return () => {
      cancelled = true;
    };
  }, [orderDetails?.id, orderDetails?.paymentStatus]);

  const canCancelUpstreamOrder = (order) => {
    const status = String(order?.status || '').toLowerCase();
    const payment = String(order?.paymentStatus || order?.payment_status || '').toLowerCase();
    return ['pending', 'confirmed'].includes(status) && payment !== 'paid';
  };

  const handleCancelOrder = async () => {
    if (!orderModalId || cancellingOrder) return;
    if (!canCancelUpstreamOrder(orderDetails)) {
      alert('This order can only be cancelled before fulfillment or payment.');
      return;
    }
    const reason = window.prompt('Cancellation reason (optional):', '') || '';
    const confirmed = window.confirm(`Cancel upstream order ${orderDetails?.orderNumber}?`);
    if (!confirmed) return;

    setCancellingOrder(true);
    try {
      const token = localStorage.getItem('token');
      const resp = await fetch(getApiUrl(`/api/po/${encodeURIComponent(orderModalId)}/cancel`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: reason.trim() || null })
      });
      const data = await resp.json();
      if (!resp.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to cancel order');
      }
      alert('Order cancelled. Upstream partner inventory has been restored.');
      await Promise.all([fetchOrderDetails(orderModalId), fetchOrders()]);
    } catch (e) {
      alert(e.message || 'Failed to cancel order');
    } finally {
      setCancellingOrder(false);
    }
  };

  const handleCreateReturnRequest = async () => {
    if (!orderDetails || !Array.isArray(orderDetails.items) || orderDetails.items.length === 0) {
      alert('No order items available for return.');
      return;
    }
    if (!canRequestReturnForOrder(orderDetails)) {
      alert(getReturnRequestBlockReason(orderDetails) || 'This order is not eligible for return.');
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
      'Enter return tracking ID (optional). Leave blank to auto-generate a unique ID for this product line (RET-ORDER-ITEM).',
      ''
    );

    try {
      const token = localStorage.getItem('token');
      const encodedOrderId = encodeURIComponent(orderDetails.orderNumber || orderModalId);
      const response = await fetch(
        getApiUrl(`/api/dashboard/service-provider/orders/${encodedOrderId}/returns`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            orderItemId: selectedItem.id,
            quantity: qty,
            reason: reason.trim(),
            ...(trackingId?.trim() ? { trackingId: trackingId.trim() } : {})
          })
        }
      );
      const data = await response.json();
      if (!response.ok || data.status !== 'success') {
        alert(data.message || 'Failed to create return request.');
        return;
      }
      alert('Return request sent to your upstream partner.');
      await fetchOrderDetails(orderModalId);
    } catch (error) {
      console.error('Create upstream return failed:', error);
      alert('Failed to create return request. Please try again.');
    }
  };

  const handleDeleteOrder = async (orderNumber, e) => {
    e?.stopPropagation();
    const confirmed = window.confirm(`Delete order ${orderNumber}?`);
    if (!confirmed) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl(`/api/dashboard/service-provider/orders/${encodeURIComponent(orderNumber)}`), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') {
        alert(data.message || 'Failed to delete order.');
        return;
      }
      if (orderModalId === orderNumber) closeOrderModal();
      setOrders((prev) => prev.filter((x) => x.orderNumber !== orderNumber));
      await fetchOrders();
    } catch (err) {
      console.error('Delete upstream order error:', err);
      alert('Failed to delete order.');
    }
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading your upstream orders…</p>
      </div>
    );
  }

  return (
    <SpPageLayout showStepper={false}>
      <div className="supplier-upstream-orders-page">
        <SpPageHeader
          title="My Upstream Orders"
          description="Track purchase orders placed with tier-above partners. Status, payment, shipment, and invoices update here as your supplier progresses the order."
          icon={ClipboardList}
          actions={
            <>
              <Button variant="outline" onClick={refreshOrders} disabled={refreshing}>
                <RefreshCw size={16} className={refreshing ? 'upstream-spin' : ''} />
                Refresh
              </Button>
              <Button onClick={() => navigate('/supplier-upstream')}>
                <Plus size={16} />
                Place new order
              </Button>
            </>
          }
        />

        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SpStatCard label="Total orders" value={stats.total} icon={ClipboardList} accent="indigo" />
          <SpStatCard label="Active" value={stats.active} icon={Package} accent="amber" />
          <SpStatCard label="In transit" value={stats.inTransit} icon={Package} accent="sky" />
          <SpStatCard
            label="Order value"
            value={`₹${stats.totalValue.toLocaleString('en-IN')}`}
            icon={ClipboardList}
            accent="emerald"
          />
        </div>

        <section className="supplier-upstream-orders-panel">
          <div className="supplier-upstream-orders-toolbar">
            <div className="search-box supplier-upstream-orders-search">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search order #, supplier, status…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <select
              className="supplier-upstream-orders-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by order status"
            >
              <option value="all">All statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="shipped">Shipped</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select
              className="supplier-upstream-orders-select"
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value)}
              aria-label="Filter by payment status"
            >
              <option value="all">All payments</option>
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
            </select>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="supplier-upstream-orders-empty">
              <ClipboardList size={48} strokeWidth={1.25} />
              <h3>No orders match your filters</h3>
              <p>Place a stock order from upstream sourcing to see it tracked here.</p>
              <Button onClick={() => navigate('/supplier-upstream')}>Go to upstream sourcing</Button>
            </div>
          ) : (
            <div className="supplier-upstream-orders-table-wrap">
              <table className="supplier-upstream-orders-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Supplier</th>
                    <th>Items</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Required by</th>
                    <th>Updated</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => (
                    <tr
                      key={o.id}
                      className="supplier-upstream-orders-row"
                      onClick={() => openOrder(o.orderNumber)}
                    >
                      <td>
                        <strong>{o.orderNumber}</strong>
                        {o.trackingNumber ? (
                          <div className="supplier-upstream-orders-tracking">
                            {o.trackingNumber}
                            {o.shippingProvider ? ` · ${o.shippingProvider}` : ''}
                          </div>
                        ) : null}
                      </td>
                      <td>{o.supplierName || 'Supplier'}</td>
                      <td>{o.itemCount ?? '—'}</td>
                      <td>₹{Number(o.totalAmount || 0).toLocaleString('en-IN')}</td>
                      <td>
                        <StatusBadge status={o.status} />
                      </td>
                      <td>
                        <span className="supplier-upstream-orders-payment">
                          {String(o.paymentStatus || 'pending')}
                        </span>
                        <span className="supplier-upstream-orders-payment-method">
                          {paymentMethodLabel(o.paymentMethod)}
                        </span>
                      </td>
                      <td>
                        {o.expectedDeliveryDate
                          ? formatDateIST(o.expectedDeliveryDate, '—')
                          : '—'}
                      </td>
                      <td>{o.updatedAt ? formatDateTimeIST(o.updatedAt, '—') : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-icon upstream-delete-btn"
                          title="Delete order"
                          onClick={(e) => handleDeleteOrder(o.orderNumber, e)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {orderModalId ? createPortal((
        <div className="modal-overlay" onClick={closeOrderModal}>
          <div className="modal-content upstream-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Order {orderModalId}</h2>
              <div className="upstream-modal-header-actions">
                <button
                  type="button"
                  className="btn-secondary upstream-inline-btn"
                  disabled={loadingOrderDetails}
                  onClick={() => fetchOrderDetails(orderModalId)}
                >
                  <RefreshCw size={16} className={loadingOrderDetails ? 'upstream-spin' : ''} />
                  Refresh
                </button>
                <button type="button" className="btn-icon" onClick={closeOrderModal} aria-label="Close">
                  <X size={20} />
                </button>
              </div>
            </div>

            {loadingOrderDetails ? (
              <div className="modal-body upstream-modal-loading">
                <Loader2 size={32} className="upstream-spin" />
                <p>Loading order details…</p>
              </div>
            ) : orderDetails ? (
              <div className="modal-body">
                <div className="order-info-section">
                  <h3>Supplier</h3>
                  <p>
                    <strong>Name:</strong> {orderDetails?.supplier?.name || orderDetails?.supplier?.company || 'N/A'}
                  </p>
                  <p>
                    <strong>Amount:</strong> ₹{Number(orderDetails?.totalAmount || 0).toLocaleString()}
                  </p>
                  <p>
                    <strong>Status:</strong> {orderDetails?.status}
                  </p>
                  <p>
                    <strong>Payment:</strong> {orderDetails?.paymentStatus || 'pending'} •{' '}
                    {paymentMethodLabel(orderDetails?.paymentMethod)}
                  </p>
                  <p>
                    <strong>Required by:</strong>{' '}
                    {orderDetails?.expectedDeliveryDate
                      ? formatDateIST(orderDetails.expectedDeliveryDate, 'N/A')
                      : '—'}
                  </p>
                  {orderDetails?.updatedAt ? (
                    <p className="upstream-muted-meta">
                      <strong>Last updated:</strong> {formatDateTimeIST(orderDetails.updatedAt, 'N/A')}
                    </p>
                  ) : null}
                </div>
                {orderDetails.paymentStatus !== 'paid' ? (
                  <div className="order-info-section">
                    <h3>Wallet payment readiness</h3>
                    <p>
                      <strong>Order amount:</strong> ₹
                      {Number(orderDetails?.totalAmount || 0).toLocaleString('en-IN')}
                    </p>
                    <p>
                      <strong>Wallet balance:</strong>{' '}
                      {loadingWalletBalance
                        ? 'Loading...'
                        : `₹${Number(walletBalance || 0).toLocaleString('en-IN')}`}
                    </p>
                    {Number(walletBalance || 0) < Number(orderDetails?.totalAmount || 0) ? (
                      <p className="upstream-muted-meta" style={{ color: '#b91c1c' }}>
                        Insufficient balance. Add ₹
                        {Number((orderDetails?.totalAmount || 0) - (walletBalance || 0)).toLocaleString('en-IN')} to
                        continue.
                      </p>
                    ) : (
                      <p className="upstream-muted-meta" style={{ color: '#166534' }}>
                        Wallet balance is sufficient for this payment.
                      </p>
                    )}
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => navigate('/supplier-wallet')}
                    >
                      Credit wallet
                    </button>
                  </div>
                ) : null}

                {orderDetails?.receiptPdfUrl && (
                  <div className="order-info-section">
                    <h3>Receipt</h3>
                    <a
                      href={orderDetails.receiptPdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary"
                    >
                      Download payment receipt
                    </a>
                  </div>
                )}

                {orderDetails?.invoicePdfUrl && (
                  <div className="order-info-section">
                    <h3>Invoice</h3>
                    <a
                      href={orderDetails.invoicePdfUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-primary"
                    >
                      Download invoice PDF
                    </a>
                  </div>
                )}

                {(orderDetails?.trackingNumber ||
                  orderDetails?.trackingUrl ||
                  orderDetails?.shippingProvider) && (
                  <div className="order-info-section">
                    <h3>Shipment</h3>
                    {orderDetails.shippingProvider ? (
                      <p>
                        <strong>Carrier:</strong> {orderDetails.shippingProvider}
                      </p>
                    ) : null}
                    {orderDetails.trackingNumber ? (
                      <p>
                        <strong>Tracking #:</strong> {orderDetails.trackingNumber}
                      </p>
                    ) : null}
                    {orderDetails.trackingUrl ? (
                      <p>
                        <a href={orderDetails.trackingUrl} target="_blank" rel="noopener noreferrer">
                          Open tracking link
                        </a>
                      </p>
                    ) : null}
                  </div>
                )}

                {Array.isArray(orderDetails?.statusHistory) && orderDetails.statusHistory.length > 0 && (
                  <div className="order-info-section">
                    <h3>Status timeline</h3>
                    <ol className="upstream-status-timeline">
                      {sortStatusHistory(orderDetails.statusHistory).map((ev, idx) => (
                        <li key={idx} className="upstream-status-timeline-item">
                          <strong>{ev.status || '—'}</strong>
                          {ev.timestamp || ev.at ? (
                            <span className="upstream-muted-meta">
                              {' '}
                              — {formatDateTimeIST(ev.timestamp || ev.at, 'N/A')}
                            </span>
                          ) : null}
                          {ev.notes ? <div className="upstream-muted-meta">{ev.notes}</div> : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                <div className="order-info-section">
                  <h3>Items</h3>
                  {Array.isArray(orderDetails.items) && orderDetails.items.length > 0 ? (
                    <table className="order-items-table">
                      <thead>
                        <tr>
                          <th>Product</th>
                          <th>Qty</th>
                          <th>Unit</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderDetails.items.map((item, idx) => (
                          <tr key={idx}>
                            <td>
                              {(item.productImage ||
                                item.product?.image ||
                                item.images?.[0] ||
                                item.product?.images?.[0]) && (
                                <div className="upstream-item-image-wrap">
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
                              </div>
                              {item.brandModel ? (
                                <div className="upstream-item-brand-meta">{item.brandModel}</div>
                              ) : null}
                            </td>
                            <td>{item.quantity}</td>
                            <td>₹{Number(item.unitPrice || 0).toLocaleString()}</td>
                            <td>₹{Number(item.totalPrice || 0).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="upstream-muted-meta">No items found in this order.</p>
                  )}
                </div>

                <div className="order-info-section">
                  <h3>Returns to upstream partner</h3>
                  {Array.isArray(orderDetails.returns) && orderDetails.returns.length > 0 ? (
                    <div className="upstream-returns-list">
                      {orderDetails.returns.map((ret) => (
                        <div key={ret.id} className="upstream-return-card">
                          <div>
                            <strong>Status:</strong> {labelReturnStatus(ret.status)}
                          </div>
                          <div>
                            <strong>Qty:</strong> {ret.quantity}
                          </div>
                          <div>
                            <strong>Reason:</strong> {ret.reason}
                          </div>
                          {ret.tracking_id ? (
                            <div>
                              <strong>Tracking ID:</strong> {ret.tracking_id}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="upstream-muted-meta">No return requests yet.</p>
                  )}
                  {canRequestReturnForOrder(orderDetails) ? (
                    <div className="upstream-return-actions">
                      <button type="button" className="btn-secondary" onClick={handleCreateReturnRequest}>
                        Request return
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => navigate('/supplier-returns?tab=outgoing')}
                      >
                        View all upstream returns
                      </button>
                    </div>
                  ) : (
                    <p className="upstream-muted-meta">{getReturnRequestBlockReason(orderDetails)}</p>
                  )}
                </div>

                {canCancelUpstreamOrder(orderDetails) ? (
                  <div className="order-info-section">
                    <h3>Cancel order</h3>
                    <p className="upstream-muted-meta">
                      Cancel before your upstream partner ships or before you mark payment as paid. Seller
                      inventory will be restored automatically.
                    </p>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={handleCancelOrder}
                      disabled={cancellingOrder}
                    >
                      {cancellingOrder ? 'Cancelling…' : 'Cancel upstream order'}
                    </button>
                  </div>
                ) : null}

                {orderDetails.status === 'delivered' && (
                  <div className="order-info-section upstream-delivered-card">
                    {orderDetails?.paymentMethod === 'online' ? (
                      <>
                        <div className="upstream-delivered-title">
                          <QrCode size={20} color="#4f46e5" />
                          <h3 className="upstream-delivered-h3">Payment QR code</h3>
                        </div>
                        <p className="upstream-delivered-help">
                          After delivery, scan to pay ₹{Number(orderDetails.totalAmount || 0).toLocaleString()} to the
                          supplier (UPI).
                        </p>
                        <div className="upstream-delivered-qr-wrap">
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
                                alt="UPI payment QR"
                                className="upstream-delivered-qr-image"
                              />
                            );
                          })()}
                        </div>
                      </>
                    ) : (
                      <p className="upstream-delivered-help">
                        Payment method: <strong>{paymentMethodLabel(orderDetails?.paymentMethod)}</strong>. After
                        payment, mark payment as paid.
                      </p>
                    )}
                    <div className="upstream-delivered-meta">
                      <p>
                        <strong>Order:</strong> {orderDetails.orderNumber}
                      </p>
                      <p>
                        <strong>Amount:</strong> ₹{Number(orderDetails.totalAmount || 0).toLocaleString()}
                      </p>
                      <p>
                        <strong>Pay to:</strong>{' '}
                        {orderDetails.supplier?.name || orderDetails.supplier?.company || 'Supplier'}
                      </p>
                    </div>
                    {orderDetails.paymentStatus !== 'paid' && (
                      <button
                        type="button"
                        className="btn-primary upstream-pay-btn"
                        onClick={handleMarkAsPaid}
                        disabled={updatingPayment || loadingWalletBalance || Number(walletBalance || 0) < Number(orderDetails?.totalAmount || 0)}
                      >
                        {updatingPayment ? 'Processing…' : 'Pay from wallet'}
                      </button>
                    )}
                    {orderDetails.paymentStatus === 'paid' && (
                      <div className="upstream-paid-badge">✓ Payment completed</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="modal-body upstream-modal-loading">
                <p className="upstream-error-text">Failed to load order details.</p>
              </div>
            )}
          </div>
        </div>
      ), document.body) : null}
    </SpPageLayout>
  );
}
