import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getApiUrl, authFetch, buildAuthHeaders } from '../config/api';
import { getVaultBalanceForUi, payOrderFromVault } from '../services/vaultService';
import { formatPaymentMethodLabel, isVaultPaymentMethod } from '../utils/vaultPaymentMethod';
import { canDeleteOrder, getOrderDeleteBlockReason } from '../utils/orderDeleteRules';
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
  Package,
  Save
} from 'lucide-react';
import { buildOrderUpiPayUri, qrServerImageUrl } from '../utils/upiPaymentQr';
import { formatDateIST, formatDateTimeIST } from '../utils/dateTime';
import {
  SUPPLIER_RETURN_ACTIONS,
  canRequestReturnForOrder,
  getReturnRequestBlockReason,
  labelReturnStatus
} from '../utils/orderReturnUi';
import ProductImageCarousel from '../components/ProductImageCarousel';
import { getOrderItemImages } from '../utils/productImages';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpStatCard from '../components/sp/SpStatCard';
import OrderChargeSummary from '../components/sp/OrderChargeSummary';
import SupplierOrderScopeNav from '../components/supplier/SupplierOrderScopeNav';
import { Button } from '@/components/ui/button';

const BUYER_SCOPE_FILTERS = [
  { id: 'all', label: 'All buyers' },
  { id: 'retail', label: 'Customers (retail)' },
  { id: 'chain', label: 'Chain partners' }
];

const sortStatusHistory = (raw) =>
  [...(raw || [])].sort((a, b) => {
    const ta = new Date(a.timestamp || a.at || 0).getTime();
    const tb = new Date(b.timestamp || b.at || 0).getTime();
    return ta - tb;
  });

const paymentMethodLabel = (method) => formatPaymentMethodLabel(method);

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
  const direction = searchParams.get('direction') === 'upstream' ? 'upstream' : 'downstream';
  const isDownstream = direction === 'downstream';

  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [buyerScopeFilter, setBuyerScopeFilter] = useState('all');

  const [orderModalId, setOrderModalId] = useState(null);
  const [orderDetails, setOrderDetails] = useState(null);
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);
  const [updatingPayment, setUpdatingPayment] = useState(false);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [vaultBalance, setVaultBalance] = useState(0);
  const [loadingVaultBalance, setLoadingVaultBalance] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [shipCarrier, setShipCarrier] = useState('');
  const [shipTrackingNumber, setShipTrackingNumber] = useState('');
  const [shipTrackingUrl, setShipTrackingUrl] = useState('');

  const fetchOrders = useCallback(async () => {
    if (isDownstream) {
      const scopeQuery = buyerScopeFilter === 'all' ? '' : `?scope=${buyerScopeFilter}`;
      const res = await authFetch(`/api/supplier/orders${scopeQuery}`, { cache: 'no-cache' });
      const data = await res.json();
      if (data.status === 'success') {
        setOrders(Array.isArray(data.orders) ? data.orders : []);
      } else {
        throw new Error(data.message || 'Failed to load orders');
      }
      return;
    }
    const res = await authFetch('/api/supplier/upstream/orders?all=true', { cache: 'no-cache' });
    const data = await res.json();
    if (data.status === 'success') {
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } else {
      throw new Error(data.message || 'Failed to load orders');
    }
  }, [isDownstream, buyerScopeFilter]);

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
    setOrderModalId(null);
    setOrderDetails(null);
    setLoading(true);
    (async () => {
      try {
        await fetchOrders();
      } catch (e) {
        console.error('Failed to load orders:', e);
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
      const encoded = encodeURIComponent(orderNumberOrId);
      if (isDownstream) {
        const res = await authFetch(`/api/supplier/orders/${encoded}`, { cache: 'no-cache' });
        const data = await res.json();
        if (data.status === 'success' && data.order) {
          setOrderDetails(data.order);
          setNewStatus(data.order.status || 'pending');
          setShipCarrier(data.order.shippingProvider || '');
          setShipTrackingNumber(data.order.trackingNumber || '');
          setShipTrackingUrl(data.order.trackingUrl || '');
        } else {
          alert(data.message || 'Failed to load order details.');
        }
        return;
      }
      const token = localStorage.getItem('token');
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
  }, [isDownstream]);

  const openOrder = useCallback(
    (orderNumber) => {
      if (!orderNumber) return;
      setOrderModalId(orderNumber);
      const next = new URLSearchParams(searchParams);
      next.set('order', orderNumber);
      setSearchParams(next, { replace: true });
      fetchOrderDetails(orderNumber);
    },
    [fetchOrderDetails, searchParams, setSearchParams]
  );

  const closeOrderModal = () => {
    setOrderModalId(null);
    setOrderDetails(null);
    setNewStatus('');
    setShipCarrier('');
    setShipTrackingNumber('');
    setShipTrackingUrl('');
    if (searchParams.get('order')) {
      const next = new URLSearchParams(searchParams);
      next.delete('order');
      setSearchParams(next, { replace: true });
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
      const searchFields = isDownstream
        ? [order.orderNumber, order.customer, order.company, order.status, order.paymentStatus]
        : [order.orderNumber, order.supplierName, order.status, order.paymentStatus, order.paymentMethod];
      return searchFields.map((v) => String(v || '').toLowerCase()).some((v) => v.includes(q));
    });
  }, [orders, query, statusFilter, paymentFilter, isDownstream]);

  const stats = useMemo(() => {
    const active = orders.filter((o) => !['delivered', 'cancelled'].includes(String(o.status || '').toLowerCase()));
    const inTransit = orders.filter((o) =>
      ['shipped', 'processing'].includes(String(o.status || '').toLowerCase())
    );
    const pendingPayment = orders.filter(
      (o) => String(o.paymentStatus || '').toLowerCase() !== 'paid'
    );
    const chain = orders.filter((o) => o.chainUpstreamOrder);
    const retail = orders.filter((o) => !o.chainUpstreamOrder);
    const totalValue = orders.reduce(
      (sum, o) => sum + Number(o.totalAmount || o.amount || 0),
      0
    );
    return {
      total: orders.length,
      active: active.length,
      inTransit: inTransit.length,
      pendingPayment: pendingPayment.length,
      chain: chain.length,
      retail: retail.length,
      totalValue
    };
  }, [orders]);

  const orderPaymentMethod = String(orderDetails?.paymentMethod || orderDetails?.payment_method || '').toLowerCase();
  const orderIsPayLater = orderPaymentMethod === 'credit';
  const orderVaultPaymentPending =
    !isDownstream &&
    orderDetails &&
    String(orderDetails.paymentStatus || '').toLowerCase() !== 'paid';
  const canPayFromVaultNow = orderVaultPaymentPending;

  const handleUpdateDownstreamStatus = async () => {
    if (!orderModalId || !newStatus) {
      alert('Please select a status to update');
      return;
    }
    setUpdatingStatus(true);
    try {
      const token = localStorage.getItem('token');
      const encodedOrderId = encodeURIComponent(orderModalId);
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
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (data.status === 'success') {
        alert('Order status updated successfully');
        await fetchOrderDetails(orderModalId);
        await fetchOrders();
      } else {
        alert(data.message || 'Failed to update order status.');
      }
    } catch (error) {
      console.error('Failed to update order status:', error);
      alert('Failed to update order status. Please try again.');
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
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          status: nextStatus,
          ...(supplierNotes ? { supplierNotes } : {})
        })
      });
      const data = await response.json();
      if (data.status !== 'success') {
        alert(data.message || 'Failed to update return status.');
        return;
      }
      alert('Return status updated.');
      await fetchOrderDetails(orderModalId);
    } catch (error) {
      console.error('Failed to update return status:', error);
      alert('Failed to update return status.');
    }
  };

  const handleMarkAsPaid = async () => {
    if (!orderModalId) return;
    const confirmed = window.confirm(
      `Pay this order from vault?\nOrder: ${orderDetails?.orderNumber}\nAmount: ₹${orderDetails?.totalAmount?.toLocaleString()}`
    );
    if (!confirmed) return;

    setUpdatingPayment(true);
    try {
      const data = await payOrderFromVault(orderDetails?.id || orderModalId, {
        idempotencyKey: `supplier-vault-order-pay-${orderDetails?.id || orderModalId}-${Date.now()}`
      });
      if (data?.status === 'success') {
        alert('Order payment completed from vault successfully.');
        await fetchOrderDetails(orderModalId);
        await fetchOrders();
      } else {
        alert(data?.message || 'Failed to pay from vault. Please try again.');
      }
    } catch (error) {
      console.error('Failed to pay from vault:', error);
      alert(error?.message || 'Failed to pay from vault. Please check your connection and try again.');
    } finally {
      setUpdatingPayment(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (isDownstream || !orderDetails || String(orderDetails.paymentStatus || '').toLowerCase() === 'paid') {
      return undefined;
    }
    const loadVaultBalance = async () => {
      setLoadingVaultBalance(true);
      try {
        const token = localStorage.getItem('token');
        if (!token) return;
        const balance = await getVaultBalanceForUi();
        if (!cancelled) setVaultBalance(balance);
      } catch {
        if (!cancelled) setVaultBalance(0);
      } finally {
        if (!cancelled) setLoadingVaultBalance(false);
      }
    };
    void loadVaultBalance();
    return () => {
      cancelled = true;
    };
  }, [isDownstream, orderDetails?.id, orderDetails?.paymentStatus]);

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
    const order = orders.find((row) => String(row.orderNumber) === String(orderNumber));
    if (
      order &&
      !canDeleteOrder({
        paymentStatus: order.paymentStatus,
        status: order.status
      })
    ) {
      alert(
        getOrderDeleteBlockReason({
          paymentStatus: order.paymentStatus,
          status: order.status
        }) || 'This order cannot be deleted.'
      );
      return;
    }
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
        <p>Loading orders…</p>
      </div>
    );
  }

  return (
    <SpPageLayout showStepper={false}>
      <div className="supplier-upstream-orders-page">
        <SpPageHeader
          title="Orders"
          description={
            isDownstream
              ? 'Orders where you are the seller — from service providers and supply-chain partners.'
              : 'Purchase orders placed with tier-above partners — track status, payment, and shipment.'
          }
          icon={ClipboardList}
          actions={
            <>
              <Button variant="outline" onClick={refreshOrders} disabled={refreshing}>
                <RefreshCw size={16} className={refreshing ? 'upstream-spin' : ''} />
                Refresh
              </Button>
              {!isDownstream ? (
                <Button onClick={() => navigate('/supplier-upstream')}>
                  <Plus size={16} />
                  Place new order
                </Button>
              ) : null}
            </>
          }
        />

        <SupplierOrderScopeNav />

        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SpStatCard label="Total orders" value={stats.total} icon={ClipboardList} accent="indigo" />
          <SpStatCard label="Active" value={stats.active} icon={Package} accent="amber" />
          <SpStatCard
            label={isDownstream ? 'Retail buyers' : 'In transit'}
            value={isDownstream ? stats.retail : stats.inTransit}
            icon={Package}
            accent="sky"
          />
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
                placeholder={
                  isDownstream ? 'Search order #, buyer, status…' : 'Search order #, supplier, status…'
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {isDownstream ? (
              <select
                className="supplier-upstream-orders-select"
                value={buyerScopeFilter}
                onChange={(e) => setBuyerScopeFilter(e.target.value)}
                aria-label="Filter by buyer type"
              >
                {BUYER_SCOPE_FILTERS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            ) : null}
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
              <p>
                {isDownstream
                  ? 'When buyers place orders with you, they will appear here.'
                  : 'Place a stock order from upstream sourcing to see it tracked here.'}
              </p>
              {!isDownstream ? (
                <Button onClick={() => navigate('/supplier-upstream')}>Go to upstream sourcing</Button>
              ) : null}
            </div>
          ) : (
            <div className="supplier-upstream-orders-table-wrap">
              <table className="supplier-upstream-orders-table">
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>{isDownstream ? 'Buyer' : 'Supplier'}</th>
                    <th>Items</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Expected dispatch date</th>
                    <th>Ordered</th>
                    <th>Updated</th>
                    {!isDownstream ? <th aria-label="Actions" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => (
                    <tr
                      key={o.id || o.orderNumber}
                      className="supplier-upstream-orders-row"
                      onClick={() => openOrder(o.orderNumber)}
                    >
                      <td>
                        <strong>{o.orderNumber}</strong>
                        {isDownstream && o.chainUpstreamOrder ? (
                          <div className="supplier-upstream-orders-tracking">Chain partner</div>
                        ) : null}
                        {o.trackingNumber ? (
                          <div className="supplier-upstream-orders-tracking">
                            {o.trackingNumber}
                            {o.shippingProvider ? ` · ${o.shippingProvider}` : ''}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {isDownstream ? (
                          <>
                            {o.customer || 'Buyer'}
                            {o.company ? (
                              <div className="supplier-upstream-orders-tracking">{o.company}</div>
                            ) : null}
                          </>
                        ) : (
                          o.supplierName || 'Supplier'
                        )}
                      </td>
                      <td>{o.itemCount ?? '—'}</td>
                      <td>₹{Number(o.totalAmount || o.amount || 0).toLocaleString('en-IN')}</td>
                      <td>
                        <StatusBadge status={o.status} />
                      </td>
                      <td>
                        <span className="supplier-upstream-orders-payment">
                          {String(o.paymentStatus || 'pending')}
                        </span>
                        {!isDownstream ? (
                          <span className="supplier-upstream-orders-payment-method">
                            {paymentMethodLabel(o.paymentMethod)}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {o.expectedDeliveryDate ? formatDateIST(o.expectedDeliveryDate, '—') : '—'}
                      </td>
                      <td>{o.createdAt ? formatDateTimeIST(o.createdAt, '—') : '—'}</td>
                      <td>{o.updatedAt ? formatDateTimeIST(o.updatedAt, '—') : '—'}</td>
                      {!isDownstream ? (
                        <td>
                          {canDeleteOrder({
                            paymentStatus: o.paymentStatus,
                            status: o.status
                          }) ? (
                            <button
                              type="button"
                              className="btn-icon upstream-delete-btn"
                              title="Delete order"
                              onClick={(e) => handleDeleteOrder(o.orderNumber, e)}
                            >
                              <Trash2 size={16} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-icon upstream-delete-btn upstream-delete-btn--disabled"
                              title={
                                getOrderDeleteBlockReason({
                                  paymentStatus: o.paymentStatus,
                                  status: o.status
                                }) || 'Delete unavailable'
                              }
                              disabled
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                        </td>
                      ) : null}
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
                {isDownstream ? (
                  <>
                    <div className="order-info-section">
                      <h3>Buyer</h3>
                      <p><strong>Name:</strong> {orderDetails.serviceProvider?.name || 'N/A'}</p>
                      <p><strong>Company:</strong> {orderDetails.serviceProvider?.company || 'N/A'}</p>
                      {orderDetails.channel === 'b2b_po' &&
                      orderDetails.serviceProvider?.user_type === 'supplier' ? (
                        <p className="upstream-muted-meta">Supply-chain partner (B2B upstream purchase)</p>
                      ) : null}
                    </div>

                    <div className="order-info-section">
                      <h3>Order items</h3>
                      {Array.isArray(orderDetails.items) && orderDetails.items.length > 0 ? (
                        <>
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
                                  <td>{item.product?.name || item.name || 'Product'}</td>
                                  <td>{item.quantity}</td>
                                  <td>₹{Number(item.unitPrice || 0).toLocaleString('en-IN')}</td>
                                  <td>₹{Number(item.totalPrice || 0).toLocaleString('en-IN')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <OrderChargeSummary order={orderDetails} />
                        </>
                      ) : (
                        <p className="upstream-muted-meta">No items found.</p>
                      )}
                    </div>

                    <div className="order-info-section">
                      <h3>Order status</h3>
                      <label>
                        <strong>Status:</strong>
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
                      {newStatus === 'shipped' ? (
                        <div style={{ marginTop: '0.75rem', display: 'grid', gap: '0.5rem' }}>
                          <input
                            type="text"
                            value={shipCarrier}
                            onChange={(e) => setShipCarrier(e.target.value)}
                            placeholder="Carrier (optional)"
                            disabled={updatingStatus}
                          />
                          <input
                            type="text"
                            value={shipTrackingNumber}
                            onChange={(e) => setShipTrackingNumber(e.target.value)}
                            placeholder="Tracking number (optional)"
                            disabled={updatingStatus}
                          />
                          <input
                            type="url"
                            value={shipTrackingUrl}
                            onChange={(e) => setShipTrackingUrl(e.target.value)}
                            placeholder="Tracking URL (optional)"
                            disabled={updatingStatus}
                          />
                        </div>
                      ) : null}
                      <div style={{ marginTop: '0.75rem' }}>
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={handleUpdateDownstreamStatus}
                          disabled={updatingStatus || newStatus === orderDetails.status}
                        >
                          {updatingStatus ? 'Updating…' : <><Save size={16} /> Update status</>}
                        </button>
                      </div>
                      <p style={{ marginTop: '0.75rem' }}>
                        <strong>Payment:</strong> {orderDetails.paymentStatus || 'pending'}
                      </p>
                      {orderDetails.invoicePdfUrl ? (
                        <a
                          href={orderDetails.invoicePdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-primary"
                          style={{ display: 'inline-block', marginTop: '0.5rem' }}
                        >
                          Download invoice
                        </a>
                      ) : null}
                    </div>

                    <div className="order-info-section">
                      <h3>Return requests</h3>
                      {Array.isArray(orderDetails.returns) && orderDetails.returns.length > 0 ? (
                        <div className="upstream-returns-list">
                          {orderDetails.returns.map((ret) => (
                            <div key={ret.id} className="upstream-return-card">
                              <div><strong>Status:</strong> {labelReturnStatus(ret.status)}</div>
                              <div><strong>Qty:</strong> {ret.quantity}</div>
                              <div><strong>Reason:</strong> {ret.reason}</div>
                              {ret.tracking_id ? <div><strong>Tracking:</strong> {ret.tracking_id}</div> : null}
                              <div className="upstream-return-actions">
                                {(SUPPLIER_RETURN_ACTIONS[ret.status] || []).map((nextStatus) => (
                                  <button
                                    key={nextStatus}
                                    type="button"
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
                        <p className="upstream-muted-meta">No return requests for this order.</p>
                      )}
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{ marginTop: '0.75rem' }}
                        onClick={() => navigate('/supplier-returns?tab=incoming')}
                      >
                        View all downstream returns
                      </button>
                    </div>
                  </>
                ) : (
                  <>
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
                    <strong>Order date:</strong>{' '}
                    {orderDetails?.createdAt
                      ? formatDateTimeIST(orderDetails.createdAt, 'N/A')
                      : '—'}
                  </p>
                  <p>
                    <strong>Expected dispatch date:</strong>{' '}
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
                {canPayFromVaultNow ? (
                  <div className="order-info-section">
                    <h3>Vault payment</h3>
                    <p className="upstream-muted-meta">
                      {orderIsPayLater
                        ? 'This order is on pay later. Settle anytime by debiting your vault — top up first if your balance is short.'
                        : isVaultPaymentMethod(orderPaymentMethod)
                          ? 'Vault checkout should debit at order placement. If payment is still pending, complete it here before dispatch.'
                          : 'Complete payment from your vault. All order payments on this platform go through vault only.'}
                    </p>
                    <p>
                      <strong>Order amount:</strong> ₹
                      {Number(orderDetails?.totalAmount || 0).toLocaleString('en-IN')}
                    </p>
                    <p>
                      <strong>Vault balance:</strong>{' '}
                      {loadingVaultBalance
                        ? 'Loading...'
                        : `₹${Number(vaultBalance || 0).toLocaleString('en-IN')}`}
                    </p>
                    {Number(vaultBalance || 0) < Number(orderDetails?.totalAmount || 0) ? (
                      <p className="upstream-muted-meta" style={{ color: '#b91c1c' }}>
                        Insufficient balance. Add ₹
                        {Number((orderDetails?.totalAmount || 0) - (vaultBalance || 0)).toLocaleString('en-IN')} to
                        your vault, then pay.
                      </p>
                    ) : (
                      <p className="upstream-muted-meta" style={{ color: '#166534' }}>
                        Vault balance is sufficient for this payment.
                      </p>
                    )}
                    <div className="upstream-delivered-meta" style={{ marginTop: '0.75rem' }}>
                      <button
                        type="button"
                        className="btn-primary upstream-pay-btn"
                        onClick={handleMarkAsPaid}
                        disabled={
                          updatingPayment ||
                          loadingVaultBalance ||
                          Number(vaultBalance || 0) < Number(orderDetails?.totalAmount || 0)
                        }
                      >
                        {updatingPayment ? 'Processing…' : 'Pay from vault'}
                      </button>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => navigate('/supplier-wallet')}
                      >
                        Credit vault
                      </button>
                    </div>
                  </div>
                ) : orderDetails.paymentStatus === 'paid' ? (
                  <div className="order-info-section">
                    <div className="upstream-paid-badge">✓ Payment completed from vault</div>
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
                        {orderDetails.items.map((item, idx) => {
                          const itemImages = getOrderItemImages(item);
                          return (
                          <tr key={idx}>
                            <td>
                              {itemImages.length > 0 && (
                                <div className="upstream-item-image-wrap">
                                  <ProductImageCarousel
                                    images={itemImages}
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
                          );
                        })}
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
                  <div className="upstream-return-actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={!canRequestReturnForOrder(orderDetails)}
                      title={getReturnRequestBlockReason(orderDetails) || undefined}
                      onClick={handleCreateReturnRequest}
                    >
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
                  {!canRequestReturnForOrder(orderDetails) && getReturnRequestBlockReason(orderDetails) ? (
                    <p className="upstream-muted-meta">{getReturnRequestBlockReason(orderDetails)}</p>
                  ) : null}
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

                {orderDetails.status === 'delivered' && orderDetails?.paymentMethod === 'online' ? (
                  <div className="order-info-section upstream-delivered-card">
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
                  </div>
                ) : null}
                  </>
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
