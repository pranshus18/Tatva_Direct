import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiUrl, resolveApiPath } from '../config/api';
import { Eye, ShoppingCart, CheckCircle, Clock, AlertCircle, X, FileText } from 'lucide-react';
import { formatDateIST, formatDateTimeIST, parseServerDate } from '../utils/dateTime';
import './Dashboard.css';
import './YourOrders.css';

const YOUR_ORDERS_CACHE_KEY = 'sp_your_orders_cache_v1';
const YOUR_ORDERS_CACHE_TTL_MS = 60 * 1000;

const formatDate = (dateString) => {
  return formatDateTimeIST(dateString, 'N/A');
};

const formatDateShort = (dateString) => {
  return formatDateIST(dateString, '—');
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

const paymentMethodLabel = (order) => {
  const pm = String(order?.paymentMethod || order?.payment_method || '').toLowerCase();
  if (pm === 'cash') return 'Cash on delivery';
  if (pm === 'online') return 'Pay online';
  if (pm === 'bank_transfer') return 'Bank transfer';
  if (pm === 'credit') return 'Credit / pay later';
  if (pm === 'upi') return 'UPI';
  if (pm === 'card') return 'Card';
  if (!pm) return 'Not set (pay online)';
  return pm.replace(/_/g, ' ');
};

const getSelfServeLockReason = (order) => {
  const paymentStatus = String(order?.paymentStatus || '').toLowerCase();
  const status = String(order?.status || '').toLowerCase();
  if (paymentStatus === 'paid') return 'Locked: order is already paid.';
  if (!['pending', 'confirmed'].includes(status)) return 'Locked: order is already in fulfillment.';
  return '';
};

const YourOrders = () => {
  const [yourOrders, setYourOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [orderDetails, setOrderDetails] = useState(null);
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);
  const [processingPayment, setProcessingPayment] = useState(false);
  const [paymentNotice, setPaymentNotice] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [savingOrderEdit, setSavingOrderEdit] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [ratingLoading, setRatingLoading] = useState(false);
  const [submittingRating, setSubmittingRating] = useState(false);

  const navigate = useNavigate();

  const fetchDashboard = async () => {
    setLoading(true);
    setLoadError('');
    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const timestamp = Date.now();
      const isDevelopment = import.meta.env.DEV || window.location.hostname === 'localhost';
      const apiUrl = isDevelopment
        ? `/api/dashboard/service-provider`
        : getApiUrl('/api/dashboard/service-provider');

      const fullUrl = `${apiUrl}?_t=${timestamp}`;
      const response = await fetch(fullUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        let message = 'Failed to load your orders.';
        try {
          const parsed = JSON.parse(errorText);
          message = parsed?.message || message;
        } catch (_e) {
          if (errorText && String(errorText).trim()) message = String(errorText).trim();
        }
        setLoadError(message);
        setYourOrders([]);
        return;
      }

      const data = await response.json();
      if (data.status === 'success') {
        const nextOrders = data.yourOrders || [];
        setYourOrders(nextOrders);
        try {
          sessionStorage.setItem(
            YOUR_ORDERS_CACHE_KEY,
            JSON.stringify({ savedAt: Date.now(), yourOrders: nextOrders })
          );
        } catch (_e) {
          // Ignore cache write failures.
        }
      } else {
        setLoadError(data?.message || 'Failed to load your orders.');
        setYourOrders([]);
      }
    } catch (e) {
      console.error('[YourOrders] Failed to load:', e);
      setLoadError('Network error while loading your orders.');
      setYourOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(YOUR_ORDERS_CACHE_KEY);
      if (raw) {
        const cached = JSON.parse(raw);
        const isFresh = cached?.savedAt && Date.now() - Number(cached.savedAt) <= YOUR_ORDERS_CACHE_TTL_MS;
        if (isFresh && Array.isArray(cached.yourOrders)) {
          setYourOrders(cached.yourOrders);
          setLoading(false);
        }
      }
    } catch (_e) {
      // Ignore cache parsing failures.
    }
    fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchOrderDetails = async (orderId) => {
    if (!orderId) return;
    setLoadingOrderDetails(true);
    setOrderDetails(null);

    try {
      const token = localStorage.getItem('token');
      if (!token) return;

      const encodedOrderId = encodeURIComponent(orderId);
      const timestamp = Date.now();
      const isDevelopment = import.meta.env.DEV || window.location.hostname === 'localhost';
      const apiUrl = isDevelopment
        ? `/api/dashboard/service-provider/orders/${encodedOrderId}`
        : getApiUrl(`/api/dashboard/service-provider/orders/${encodedOrderId}`);

      const fullUrl = `${apiUrl}?_t=${timestamp}`;
      const response = await fetch(fullUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          Pragma: 'no-cache'
        }
      });

      const data = await response.json();
      if (data.status === 'success' && data.order) {
        setOrderDetails(data.order);
        setEditingOrder({
          expectedDeliveryDate: data.order.expectedDeliveryDate || '',
          paymentMethod: data.order.paymentMethod || '',
          notes: data.order.notes || '',
          deliveryAddress: {
            line1: data.order.deliveryAddress?.line1 || data.order.deliveryAddress?.street || '',
            city: data.order.deliveryAddress?.city || '',
            state: data.order.deliveryAddress?.state || '',
            pincode: data.order.deliveryAddress?.pincode || data.order.deliveryAddress?.zipCode || '',
            country: data.order.deliveryAddress?.country || ''
          }
        });
        setEditMode(false);
      } else {
        setOrderDetails(null);
      }
    } catch (e) {
      console.error('[YourOrders] Failed to load order details:', e);
    } finally {
      setLoadingOrderDetails(false);
    }
  };

  const loadRazorpayScript = () =>
    new Promise((resolve) => {
      if (window.Razorpay) return resolve(true);
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });

  const handlePayWithRazorpay = async () => {
    if (!orderDetails?.id || processingPayment) return;
    setProcessingPayment(true);
    setPaymentNotice('');
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');

      const configResp = await fetch(resolveApiPath('/api/payments/razorpay/config'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const configData = await configResp.json().catch(() => ({}));
      const backendKeyId = configData?.razorpay?.keyId || '';
      const keyId = backendKeyId || import.meta.env.VITE_RAZORPAY_KEY_ID || '';
      if (!keyId || configData?.razorpay?.isConfigured === false) {
        throw new Error(
          'Online payment is not configured yet. Add Razorpay keys in backend .env and frontend .env, or use bank transfer.'
        );
      }

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) throw new Error('Razorpay SDK failed to load');

      const createResp = await fetch(resolveApiPath(`/api/payments/orders/${orderDetails.id}/razorpay/create`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ idempotencyKey: `ui-${orderDetails.id}-${Date.now()}` })
      });
      const createData = await createResp.json();
      if (!createResp.ok || createData.status !== 'success') {
        if (createData.code === 'RAZORPAY_NOT_CONFIGURED') {
          throw new Error('Razorpay is not configured on server yet. Please add keys or use bank transfer.');
        }
        throw new Error(createData.message || 'Failed to create payment intent');
      }

      const options = {
        key: keyId,
        order_id: createData.paymentIntent.orderId,
        name: 'Tatva Direct',
        description: `Payment for ${orderDetails.orderNumber || orderDetails.id}`,
        amount: createData.paymentIntent.amount,
        currency: createData.paymentIntent.currency || 'INR',
        handler: async (response) => {
          try {
            const confirmResp = await fetch(resolveApiPath(`/api/payments/orders/${orderDetails.id}/razorpay/confirm`), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
                method: 'upi'
              })
            });
            const confirmData = await confirmResp.json();
            if (!confirmResp.ok || confirmData.status !== 'success') {
              throw new Error(confirmData.message || 'Payment verification failed');
            }
            setPaymentNotice(
              confirmData.invoice?.invoicePdfUrl
                ? 'Payment successful. Your invoice PDF is ready — use the link below.'
                : 'Payment successful and verified.'
            );
            await Promise.allSettled([
              fetchDashboard(),
              fetchOrderDetails(orderDetails.orderNumber || orderDetails.id)
            ]);
            if (confirmData.invoice?.invoicePdfUrl) {
              setOrderDetails((prev) =>
                prev ? { ...prev, invoicePdfUrl: confirmData.invoice.invoicePdfUrl } : prev
              );
            }
          } catch (err) {
            setPaymentNotice(err.message || 'Payment completed but verification failed');
          } finally {
            setProcessingPayment(false);
          }
        },
        modal: {
          ondismiss: () => {
            setProcessingPayment(false);
          }
        },
        prefill: {},
        theme: { color: '#4f46e5' }
      };

      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (err) {
      setPaymentNotice(err.message || 'Unable to start payment');
      setProcessingPayment(false);
    }
  };

  const handleBankTransferFallback = async () => {
    if (!orderDetails?.id || processingPayment) return;
    setProcessingPayment(true);
    setPaymentNotice('');
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const resp = await fetch(resolveApiPath(`/api/payments/orders/${orderDetails.id}/bank-transfer/request`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ note: 'Requested via service provider portal fallback' })
      });
      const data = await resp.json();
      if (!resp.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to request bank transfer');
      }
      setPaymentNotice('Bank transfer request submitted. Finance will verify and mark payment.');
      await fetchOrderDetails(orderDetails.orderNumber || orderDetails.id);
    } catch (err) {
      setPaymentNotice(err.message || 'Failed to request bank transfer');
    } finally {
      setProcessingPayment(false);
    }
  };

  const stepsFor = (po) => {
    const history = Array.isArray(po.statusHistory)
      ? po.statusHistory
      : Array.isArray(po.status_history)
        ? po.status_history
        : [];
    const sorted = [...history].sort((a, b) => {
      const ta = a?.timestamp ? (parseServerDate(a.timestamp)?.getTime() || 0) : 0;
      const tb = b?.timestamp ? (parseServerDate(b.timestamp)?.getTime() || 0) : 0;
      return ta - tb;
    });

    const statusOrder = { confirmed: 1, processing: 2, shipped: 3, delivered: 4 };
    const currentRank = statusOrder[po.status] || 0;

    const tsFor = (s) => sorted.find((h) => h?.status === s)?.timestamp || null;
    const placedTs = po.createdAt || null;
    const confirmedTs = tsFor('confirmed') || placedTs;
    const processingTs = tsFor('processing');
    const shippedTs = tsFor('shipped');
    const deliveredTs = po.actualDeliveryDate || tsFor('delivered');

    return {
      currentRank,
      steps: [
        { key: 'placed', label: 'Placed', ts: placedTs, rank: 0 },
        { key: 'confirmed', label: 'Confirmed', ts: confirmedTs, rank: 1 },
        { key: 'processing', label: 'Processing', ts: processingTs, rank: 2 },
        { key: 'shipped', label: 'Shipped', ts: shippedTs, rank: 3 },
        { key: 'delivered', label: 'Delivered', ts: deliveredTs, rank: 4 }
      ]
    };
  };

  const statusIcon = (status) => {
    if (status === 'delivered') return <CheckCircle size={14} />;
    if (status === 'pending') return <Clock size={14} />;
    if (status === 'confirmed') return <CheckCircle size={14} />;
    if (status === 'processing') return <Clock size={14} />;
    if (status === 'shipped') return <Clock size={14} />;
    return <AlertCircle size={14} />;
  };

  const statusText = (status) => {
    if (status === 'delivered') return 'Delivered';
    if (status === 'pending') return 'Pending';
    if (status === 'confirmed') return 'Confirmed';
    if (status === 'processing') return 'Processing';
    if (status === 'shipped') return 'Shipped';
    return status || 'Pending';
  };

  const statusBadgeClass = (status) => {
    const s = (status || 'pending').toLowerCase();
    if (s === 'delivered') return 'yo-badge yo-badge--delivered';
    if (s === 'pending') return 'yo-badge yo-badge--pending';
    if (s === 'cancelled') return 'yo-badge yo-badge--cancelled';
    return 'yo-badge yo-badge--confirmed';
  };

  const paymentBadgeClass = (paymentStatus) => {
    const p = (paymentStatus || 'pending').toLowerCase();
    if (p === 'paid') return 'yo-badge yo-badge--paid';
    return 'yo-badge yo-badge--payment-pending';
  };

  const paymentBadgeText = (paymentStatus) => {
    const p = (paymentStatus || 'pending').toLowerCase();
    if (p === 'paid') return 'Paid';
    if (p === 'partial') return 'Partially paid';
    if (p === 'refunded') return 'Refunded';
    return 'Payment pending';
  };

  const progressPercent = (currentRank) => {
    const pct = Math.round((currentRank / 4) * 100);
    return Math.min(100, Math.max(6, pct));
  };

  const openOrder = (po) => {
    setSelectedOrderId(po.orderNumber || po.id);
    fetchOrderDetails(po.orderNumber || po.id);
  };

  const downloadReceiptFallback = async (orderRef, event) => {
    if (event) event.stopPropagation();
    try {
      const token = localStorage.getItem('token');
      if (!token || !orderRef) return;
      const resp = await fetch(getApiUrl(`/api/receipts/order/${encodeURIComponent(orderRef)}/download`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) {
        const payload = await resp.json().catch(() => ({}));
        throw new Error(payload.message || 'Receipt download failed');
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${orderRef}-receipt.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setPaymentNotice(e.message || 'Unable to download receipt');
    }
  };

  const fetchOrderRating = async (orderRef) => {
    if (!orderRef) return;
    setRatingLoading(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) return;
      const resp = await fetch(getApiUrl(`/api/po/${encodeURIComponent(orderRef)}/rating`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await resp.json();
      if (resp.ok && data.status === 'success' && data.rating) {
        setRating(Number(data.rating.rating) || 0);
        setFeedback(data.rating.feedback || '');
      } else {
        setRating(0);
        setFeedback('');
      }
    } catch (e) {
      console.error('Failed to load rating:', e);
    } finally {
      setRatingLoading(false);
    }
  };

  const handleUpdateOrder = async () => {
    if (!orderDetails?.orderNumber || !editingOrder || savingOrderEdit) return;
    setSavingOrderEdit(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const resp = await fetch(getApiUrl(`/api/po/${encodeURIComponent(orderDetails.orderNumber)}/self-serve`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(editingOrder)
      });
      const data = await resp.json();
      if (!resp.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to update order');
      }
      setPaymentNotice('Order updated successfully.');
      await Promise.allSettled([
        fetchDashboard(),
        fetchOrderDetails(orderDetails.orderNumber)
      ]);
      setEditMode(false);
    } catch (e) {
      setPaymentNotice(e.message || 'Failed to update order');
    } finally {
      setSavingOrderEdit(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!orderDetails?.orderNumber || cancellingOrder) return;
    const confirmed = window.confirm('Cancel this order? This cannot be undone.');
    if (!confirmed) return;
    setCancellingOrder(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const resp = await fetch(getApiUrl(`/api/po/${encodeURIComponent(orderDetails.orderNumber)}/cancel`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ reason: cancelReason || null })
      });
      const data = await resp.json();
      if (!resp.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to cancel order');
      }
      setPaymentNotice('Order cancelled successfully.');
      await Promise.allSettled([
        fetchDashboard(),
        fetchOrderDetails(orderDetails.orderNumber)
      ]);
    } catch (e) {
      setPaymentNotice(e.message || 'Failed to cancel order');
    } finally {
      setCancellingOrder(false);
    }
  };

  const handleSubmitRating = async () => {
    if (!orderDetails?.orderNumber || submittingRating) return;
    if (!rating || rating < 1 || rating > 5) {
      setPaymentNotice('Please select a rating between 1 and 5.');
      return;
    }
    setSubmittingRating(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const resp = await fetch(getApiUrl(`/api/po/${encodeURIComponent(orderDetails.orderNumber)}/rating`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ rating, feedback })
      });
      const data = await resp.json();
      if (!resp.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to submit rating');
      }
      setPaymentNotice('Rating submitted successfully.');
      await fetchOrderRating(orderDetails.orderNumber);
    } catch (e) {
      setPaymentNotice(e.message || 'Failed to submit rating');
    } finally {
      setSubmittingRating(false);
    }
  };

  useEffect(() => {
    if (!orderDetails?.orderNumber) return;
    fetchOrderRating(orderDetails.orderNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderDetails?.orderNumber]);

  const selectedOrderSteps = useMemo(() => {
    if (!orderDetails) return null;
    return stepsFor(orderDetails);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderDetails]);

  const orderPaymentPending =
    orderDetails && String(orderDetails.paymentStatus || '').toLowerCase() !== 'paid';
  const orderStatus = String(orderDetails?.status || '').toLowerCase();
  const selfServeEditable = ['pending', 'confirmed'].includes(orderStatus) && !['paid'].includes(String(orderDetails?.paymentStatus || '').toLowerCase());
  const selfServeLockReason = orderDetails ? getSelfServeLockReason(orderDetails) : '';
  const canRateOrder = orderStatus === 'delivered' && String(orderDetails?.paymentStatus || '').toLowerCase() === 'paid';
  const orderPm = String(orderDetails?.paymentMethod || orderDetails?.payment_method || '').toLowerCase();
  const showRazorpayForOrder = orderPaymentPending && (orderPm === 'online' || !orderPm);
  const showBankTransferForOrder =
    orderPaymentPending && (orderPm === 'bank_transfer' || orderPm === 'online' || !orderPm);
  const codChosen = orderPaymentPending && orderPm === 'cash';
  const creditChosen = orderPaymentPending && orderPm === 'credit';
  const bankOnlyChosen = orderPaymentPending && orderPm === 'bank_transfer';

  return (
    <div className="page yo-page">
      <header className="yo-hero">
        <h1>Your orders</h1>
        <p>Track purchase orders, delivery milestones, and payment documents in one place.</p>
      </header>
      {loadError ? (
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
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <div className="your-orders-loading-wrap">
          <div className="your-orders-loading-bar">
            <div className="your-orders-loading-bar-inner" />
          </div>
          <div className="your-orders-runner-area">
            <div className="boy-runner-stage" aria-hidden="true">
              <div className="boy-runner-ground" />
              <div className="boy-runner-moving">
                <div className="boy-runner">
                  <div className="boy-head" />
                  <div className="boy-torso" />
                  <div className="boy-arm boy-arm-left" />
                  <div className="boy-arm boy-arm-right" />
                  <div className="boy-leg boy-leg-left" />
                  <div className="boy-leg boy-leg-right" />
                </div>
                <div className="boy-dust dust-1" />
                <div className="boy-dust dust-2" />
                <div className="boy-dust dust-3" />
              </div>
            </div>
            <div style={{ textAlign: 'center', paddingTop: '0.75rem', color: '#64748b', fontWeight: 600, fontSize: '0.875rem' }}>
              Loading your orders…
            </div>
          </div>
        </div>
      ) : yourOrders.length === 0 ? (
        <div className="empty-state" style={{ borderRadius: 16, border: '1px solid #e8ecf1', background: '#fff' }}>
          <ShoppingCart size={48} strokeWidth={1.5} color="#94a3b8" />
          <h3>No orders yet</h3>
          <p style={{ maxWidth: 360, margin: '0 auto 1.25rem' }}>
            When you confirm purchase orders from a BOQ, they will appear here with full tracking.
          </p>
          <button type="button" className="btn-primary" onClick={() => navigate('/boq-normalize')}>
            Create BOQ / PO
          </button>
        </div>
      ) : (
        <div className="yo-list">
          {yourOrders.map((po, idx) => {
            const { currentRank, steps } = stepsFor(po);
            const orderRef = po.orderNumber || po.id;
            return (
              <div
                key={po.id}
                role="button"
                tabIndex={0}
                className="yo-card your-order-card-anim"
                style={{ animationDelay: `${idx * 60}ms` }}
                onClick={() => openOrder(po)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openOrder(po);
                  }
                }}
              >
                <div className="yo-card__main">
                  <div className="yo-card__top">
                    <span className="yo-card__ref">{orderRef}</span>
                    <span className={statusBadgeClass(po.status)}>
                      {statusIcon(po.status)}
                      {statusText(po.status)}
                    </span>
                    <span className={paymentBadgeClass(po.paymentStatus)}>
                      {paymentBadgeText(po.paymentStatus)}
                    </span>
                  </div>

                  <p className="yo-card__supplier">
                    <strong>{po.vendor}</strong>
                    {po.vendorCompany && po.vendorCompany !== po.vendor && (
                      <span> · {po.vendorCompany}</span>
                    )}
                  </p>

                  <div className="yo-card__row">
                    <div>
                      <span className="yo-card__amount-label">Order total</span>
                      <div className="yo-card__amount">₹{Number(po.amount || 0).toLocaleString('en-IN')}</div>
                    </div>
                  </div>

                  {String(po.paymentStatus || '').toLowerCase() === 'paid' && (
                    <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                      {po.invoicePdfUrl && (
                        <a
                          href={po.invoicePdfUrl}
                          className="yo-doc-link"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: '0.8125rem' }}
                        >
                          <FileText size={14} />
                          Invoice PDF
                        </a>
                      )}
                      {po.receiptPdfUrl && (
                        <a
                          href={po.receiptPdfUrl}
                          className="yo-doc-link yo-doc-link--receipt"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{ fontSize: '0.8125rem' }}
                        >
                          <FileText size={14} />
                          Payment Receipt
                        </a>
                      )}
                      {!po.receiptPdfUrl && (
                        <button
                          type="button"
                          className="yo-doc-link yo-doc-link--receipt"
                          onClick={(e) => downloadReceiptFallback(po.orderNumber || po.id, e)}
                          style={{ fontSize: '0.8125rem' }}
                        >
                          <FileText size={14} />
                          Payment Receipt
                        </button>
                      )}
                    </div>
                  )}

                  {(po.expectedDeliveryDate || po.actualDeliveryDate) && (
                    <div className="yo-card__dates">
                      {po.expectedDeliveryDate && (
                        <span>
                          <strong>Expected</strong> {formatDateShort(po.expectedDeliveryDate)}
                        </span>
                      )}
                      {po.actualDeliveryDate && (
                        <span className="yo-arrived">
                          <strong>Delivered</strong> {formatDateShort(po.actualDeliveryDate)}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="yo-track" aria-hidden="true">
                    <div className="yo-track__bar-wrap">
                      <div className="yo-track__bar" style={{ width: `${progressPercent(currentRank)}%` }} />
                    </div>
                    <div className="yo-track__labels">
                      {steps.map((step) => {
                        const done = step.rank === 0 ? true : step.rank <= currentRank;
                        const active = step.rank !== 0 && step.rank === currentRank;
                        return (
                          <span
                            key={step.key}
                            className={`yo-track__step ${done ? 'yo-track__step--done' : ''} ${active ? 'yo-track__step--active' : ''}`}
                          >
                            {step.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="yo-card__action">
                  <button
                    type="button"
                    className="yo-btn-view"
                    onClick={(e) => {
                      e.stopPropagation();
                      openOrder(po);
                    }}
                    title="View details"
                    aria-label={`View order ${orderRef}`}
                  >
                    <Eye size={18} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedOrderId && (
        <div
          className="modal-overlay"
          onClick={() => {
            setSelectedOrderId(null);
            setOrderDetails(null);
          }}
        >
          <div className="modal-content yo-modal" onClick={(e) => e.stopPropagation()}>
            <div className="yo-modal__head">
              <div>
                <h2>Order {orderDetails?.orderNumber || selectedOrderId}</h2>
                <p className="yo-modal__sub">Supplier, timeline, and documents</p>
                {orderDetails && (
                  <div className="yo-modal__docs">
                    {orderDetails.invoicePdfUrl && (
                      <a
                        href={orderDetails.invoicePdfUrl}
                        className="yo-doc-link"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FileText size={16} />
                        Invoice PDF
                      </a>
                    )}
                    {orderDetails.receiptPdfUrl && (
                      <a
                        href={orderDetails.receiptPdfUrl}
                        className="yo-doc-link yo-doc-link--receipt"
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <FileText size={16} />
                        Payment receipt
                      </a>
                    )}
                    {!orderDetails.receiptPdfUrl && (
                      <button
                        type="button"
                        className="yo-doc-link yo-doc-link--receipt"
                        onClick={(e) => downloadReceiptFallback(orderDetails.orderNumber || orderDetails.id, e)}
                      >
                        <FileText size={16} />
                        Payment receipt
                      </button>
                    )}
                  </div>
                )}
                {orderDetails && orderPaymentPending && (
                  <div style={{ marginTop: '0.65rem' }}>
                    <p style={{ margin: '0 0 0.5rem', fontSize: '0.8125rem', color: '#475569' }}>
                      <strong>Payment method:</strong> {paymentMethodLabel(orderDetails)}
                    </p>
                    {codChosen && (
                      <p style={{ margin: 0, fontSize: '0.8125rem', color: '#92400e', background: '#fffbeb', padding: '0.5rem 0.65rem', borderRadius: 8, border: '1px solid #fcd34d' }}>
                        You chose cash on delivery. Pay the supplier in cash when the order is delivered; they will mark payment as received.
                      </p>
                    )}
                    {creditChosen && (
                      <p style={{ margin: 0, fontSize: '0.8125rem', color: '#1e3a5f', background: '#eff6ff', padding: '0.5rem 0.65rem', borderRadius: 8, border: '1px solid #bfdbfe' }}>
                        This order is on credit terms. Complete payment per your agreement with the supplier.
                      </p>
                    )}
                    {(showRazorpayForOrder || showBankTransferForOrder) && (
                      <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.55rem', flexWrap: 'wrap' }}>
                        {showRazorpayForOrder && (
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={handlePayWithRazorpay}
                            disabled={processingPayment}
                          >
                            {processingPayment ? 'Processing...' : 'Pay now (Razorpay)'}
                          </button>
                        )}
                        {showBankTransferForOrder && (
                          <button
                            type="button"
                            className={bankOnlyChosen ? 'btn-primary' : 'btn-secondary'}
                            onClick={handleBankTransferFallback}
                            disabled={processingPayment}
                          >
                            Request bank transfer
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {paymentNotice ? (
                  <p style={{ marginTop: '0.55rem', marginBottom: 0, color: '#1e40af', fontSize: '0.85rem' }}>
                    {paymentNotice}
                  </p>
                ) : null}
                {orderDetails && (
                  <div style={{ display: 'flex', gap: '0.55rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
                    {selfServeEditable && (
                      <>
                        <button
                          type="button"
                          className={editMode ? 'btn-secondary' : 'btn-primary'}
                          onClick={() => setEditMode((prev) => !prev)}
                        >
                          {editMode ? 'Close edit' : 'Edit order'}
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={handleCancelOrder}
                          disabled={cancellingOrder}
                        >
                          {cancellingOrder ? 'Cancelling...' : 'Cancel order'}
                        </button>
                      </>
                    )}
                  </div>
                )}
                {orderDetails && !selfServeEditable && selfServeLockReason && (
                  <p
                    style={{
                      marginTop: '0.55rem',
                      marginBottom: 0,
                      fontSize: '0.82rem',
                      color: '#9a3412',
                      background: '#fff7ed',
                      border: '1px solid #fdba74',
                      borderRadius: 8,
                      padding: '0.45rem 0.6rem'
                    }}
                  >
                    {selfServeLockReason}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="btn-icon"
                onClick={() => {
                  setSelectedOrderId(null);
                  setOrderDetails(null);
                }}
                title="Close"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>

            {loadingOrderDetails ? (
              <div className="modal-body yo-section" style={{ textAlign: 'center', padding: '2.5rem' }}>
                <div className="spinner" />
                <p style={{ marginTop: '1rem', color: '#64748b' }}>Loading details…</p>
              </div>
            ) : orderDetails ? (
              <>
                <div className="yo-section">
                  <h3>Supplier</h3>
                  {orderDetails.supplier ? (
                    <p style={{ margin: 0, fontSize: '0.9375rem', color: '#334155', lineHeight: 1.6 }}>
                      <strong style={{ color: '#0f172a' }}>{orderDetails.supplier.name || '—'}</strong>
                      {orderDetails.supplier.company && (
                        <>
                          <br />
                          <span style={{ color: '#64748b' }}>{orderDetails.supplier.company}</span>
                        </>
                      )}
                    </p>
                  ) : (
                    <p style={{ margin: 0, color: '#64748b' }}>Supplier information not available.</p>
                  )}
                </div>

                <div className="yo-section">
                  <h3>Fulfillment timeline</h3>
                  {selectedOrderSteps ? (
                    <div className="arrival-timeline">
                      {selectedOrderSteps.steps.map((step) => {
                        const done = step.rank === 0 ? true : step.rank <= selectedOrderSteps.currentRank;
                        const active = step.rank !== 0 && step.rank === selectedOrderSteps.currentRank;
                        return (
                          <div
                            key={step.key}
                            className={`arrival-step ${done ? 'done' : ''} ${active ? 'active' : ''}`}
                          >
                            <div className="arrival-dot" />
                            <div className="arrival-step-body">
                              <div className="arrival-step-label">{step.label}</div>
                              <div className="arrival-step-date">{step.ts ? formatDate(step.ts) : '—'}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p style={{ color: '#64748b', margin: 0 }}>No timeline data.</p>
                  )}
                  <div style={{ marginTop: '1rem', fontSize: '0.8125rem', color: '#64748b' }}>
                    <div>
                      Expected delivery:{' '}
                      {orderDetails.expectedDeliveryDate ? formatDate(orderDetails.expectedDeliveryDate) : '—'}
                    </div>
                    <div style={{ marginTop: '0.35rem', fontWeight: 600, color: orderDetails.actualDeliveryDate ? '#047857' : '#64748b' }}>
                      Delivered: {orderDetails.actualDeliveryDate ? formatDate(orderDetails.actualDeliveryDate) : '—'}
                    </div>
                  </div>
                </div>

                {orderDetails.deliveryAddress && (
                  <div className="yo-section">
                    <h3>Delivery address</h3>
                    <p style={{ margin: 0, fontSize: '0.9375rem', color: '#475569', lineHeight: 1.55 }}>
                      {formatAddress(orderDetails.deliveryAddress)}
                    </p>
                    {(orderDetails.deliveryAddress.shippingAddress ||
                      orderDetails.deliveryAddress.billingAddress ||
                      orderDetails.deliveryAddress.deliveryDestination ||
                      orderDetails.deliveryAddress.gstin) && (
                      <div style={{ marginTop: '0.65rem', fontSize: '0.84rem', color: '#475569' }}>
                        <p style={{ margin: 0 }}>
                          <strong>Delivery destination:</strong>{' '}
                          {orderDetails.deliveryAddress.deliveryDestination === 'billing'
                            ? 'Billing address'
                            : 'Shipping address'}
                        </p>
                        {orderDetails.deliveryAddress.gstin && (
                          <p style={{ margin: '0.25rem 0 0' }}>
                            <strong>GSTIN:</strong> {orderDetails.deliveryAddress.gstin}
                          </p>
                        )}
                        {orderDetails.deliveryAddress.shippingAddress && (
                          <p style={{ margin: '0.25rem 0 0' }}>
                            <strong>Shipping:</strong> {formatAddress(orderDetails.deliveryAddress.shippingAddress)}
                          </p>
                        )}
                        {orderDetails.deliveryAddress.billingAddress && (
                          <p style={{ margin: '0.25rem 0 0' }}>
                            <strong>Billing (GST):</strong> {formatAddress(orderDetails.deliveryAddress.billingAddress)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="yo-section">
                  <h3>Status history</h3>
                  {Array.isArray(orderDetails.status_history) && orderDetails.status_history.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {[...orderDetails.status_history]
                        .sort((a, b) => {
                          const ta = a?.timestamp ? (parseServerDate(a.timestamp)?.getTime() || 0) : 0;
                          const tb = b?.timestamp ? (parseServerDate(b.timestamp)?.getTime() || 0) : 0;
                          return ta - tb;
                        })
                        .map((h, idx) => (
                          <div
                            key={`${h.status || 'status'}-${idx}`}
                            style={{
                              padding: '0.85rem 1rem',
                              border: '1px solid #f1f5f9',
                              borderRadius: 10,
                              background: '#fafbfc'
                            }}
                          >
                            <div style={{ fontWeight: 600, textTransform: 'capitalize', color: '#0f172a' }}>
                              {h.status || '—'}
                            </div>
                            <div style={{ fontSize: '0.8125rem', color: '#64748b', marginTop: '0.2rem' }}>
                              {h.timestamp ? formatDate(h.timestamp) : '—'}
                            </div>
                            {h.notes && (
                              <div style={{ fontSize: '0.8125rem', color: '#475569', marginTop: '0.45rem' }}>
                                {h.notes}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p style={{ color: '#64748b', margin: 0 }}>No status history.</p>
                  )}
                </div>
                {editMode && editingOrder && (
                  <div className="yo-section">
                    <h3>Self-serve edits</h3>
                    <div style={{ display: 'grid', gap: '0.55rem' }}>
                      <input
                        type="datetime-local"
                        value={editingOrder.expectedDeliveryDate ? new Date(editingOrder.expectedDeliveryDate).toISOString().slice(0, 16) : ''}
                        onChange={(e) => setEditingOrder((prev) => ({ ...prev, expectedDeliveryDate: e.target.value ? new Date(e.target.value).toISOString() : null }))}
                      />
                      <select
                        value={editingOrder.paymentMethod || ''}
                        onChange={(e) => setEditingOrder((prev) => ({ ...prev, paymentMethod: e.target.value }))}
                      >
                        <option value="">Select payment method</option>
                        <option value="online">Online</option>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="cash">Cash</option>
                        <option value="credit">Credit</option>
                      </select>
                      <textarea
                        rows={2}
                        placeholder="Order notes"
                        value={editingOrder.notes || ''}
                        onChange={(e) => setEditingOrder((prev) => ({ ...prev, notes: e.target.value }))}
                      />
                      <input
                        placeholder="Address line 1"
                        value={editingOrder.deliveryAddress?.line1 || ''}
                        onChange={(e) => setEditingOrder((prev) => ({ ...prev, deliveryAddress: { ...prev.deliveryAddress, line1: e.target.value } }))}
                      />
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.5rem' }}>
                        <input
                          placeholder="City"
                          value={editingOrder.deliveryAddress?.city || ''}
                          onChange={(e) => setEditingOrder((prev) => ({ ...prev, deliveryAddress: { ...prev.deliveryAddress, city: e.target.value } }))}
                        />
                        <input
                          placeholder="State"
                          value={editingOrder.deliveryAddress?.state || ''}
                          onChange={(e) => setEditingOrder((prev) => ({ ...prev, deliveryAddress: { ...prev.deliveryAddress, state: e.target.value } }))}
                        />
                        <input
                          placeholder="Pincode"
                          value={editingOrder.deliveryAddress?.pincode || ''}
                          onChange={(e) => setEditingOrder((prev) => ({ ...prev, deliveryAddress: { ...prev.deliveryAddress, pincode: e.target.value } }))}
                        />
                        <input
                          placeholder="Country"
                          value={editingOrder.deliveryAddress?.country || ''}
                          onChange={(e) => setEditingOrder((prev) => ({ ...prev, deliveryAddress: { ...prev.deliveryAddress, country: e.target.value } }))}
                        />
                      </div>
                      <input
                        placeholder="Cancellation reason (optional)"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                      />
                      <div>
                        <button type="button" className="btn-primary" onClick={handleUpdateOrder} disabled={savingOrderEdit}>
                          {savingOrderEdit ? 'Saving...' : 'Save changes'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {canRateOrder && (
                  <div className="yo-section">
                    <h3>Reviews & ratings</h3>
                    {ratingLoading ? (
                      <p style={{ margin: 0, color: '#64748b' }}>Loading rating...</p>
                    ) : (
                      <>
                        <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.5rem' }}>
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setRating(star)}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                fontSize: '1.35rem',
                                cursor: 'pointer',
                                color: star <= rating ? '#f59e0b' : '#cbd5e1',
                                padding: 0
                              }}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                        <textarea
                          rows={3}
                          placeholder="Share your review"
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                        />
                        <div style={{ marginTop: '0.5rem' }}>
                          <button type="button" className="btn-primary" onClick={handleSubmitRating} disabled={submittingRating}>
                            {submittingRating ? 'Submitting...' : 'Submit review'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="modal-body yo-section" style={{ textAlign: 'center', color: '#64748b' }}>
                Unable to load tracking details.
              </div>
            )}

            <div className="yo-modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setSelectedOrderId(null);
                  setOrderDetails(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default YourOrders;
