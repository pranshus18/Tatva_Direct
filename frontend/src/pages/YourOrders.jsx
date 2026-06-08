import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiUrl, resolveApiPath, authFetch } from '../config/api';
import {
  Eye,
  ShoppingCart,
  CheckCircle,
  Clock,
  AlertCircle,
  FileText,
  Search,
  ShoppingBag,
  RefreshCw,
  Loader2
} from 'lucide-react';
import { formatDateIST, formatDateTimeIST, parseServerDate } from '../utils/dateTime';
import {
  formatOrderStatusLabel,
  formatPaymentStatusLabel,
  spStatusBadgeClass,
  spPaymentBadgeClass
} from '../utils/orderStatusUi';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import SpEmptyState from '../components/sp/SpEmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import OrderDialogSection from '../components/sp/OrderDialogSection';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
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
  if (pm === 'upi') return 'UPI';
  if (pm === 'bank_transfer') return 'Bank transfer';
  if (pm === 'card') return 'Credit / Debit Card';
  if (pm === 'credit') return 'Credit / pay later';
  if (!pm) return 'Not set (pay online)';
  return pm.replace(/_/g, ' ');
};

const statusBadgeVariant = (status) => {
  const s = String(status || '').toLowerCase();
  if (s === 'delivered') return 'yo-badge--delivered';
  if (s === 'pending') return 'yo-badge--pending';
  if (s === 'cancelled') return 'yo-badge--cancelled';
  return 'yo-badge--confirmed';
};

const paymentBadgeVariant = (paymentStatus) => {
  const s = String(paymentStatus || '').toLowerCase();
  return s === 'paid' ? 'yo-badge--paid' : 'yo-badge--payment-pending';
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
  const [orderSearch, setOrderSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

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
      const response = await authFetch(fullUrl, {
        headers: {
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
      const response = await authFetch(fullUrl, {
        headers: {
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

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return yourOrders.filter((po) => {
      const status = String(po.status || '').toLowerCase();
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!q) return true;
      const ref = String(po.orderNumber || po.id || '').toLowerCase();
      const vendor = String(po.vendor || '').toLowerCase();
      return ref.includes(q) || status.includes(q) || vendor.includes(q);
    });
  }, [yourOrders, orderSearch, statusFilter]);

  const closeOrderDialog = () => {
    setSelectedOrderId(null);
    setOrderDetails(null);
    setEditMode(false);
    setPaymentNotice('');
  };

  return (
    <SpPageLayout showStepper={false}>
      <SpPageHeader
        title="Your orders"
        description="Track purchase orders, delivery milestones, and payment documents in one place."
        icon={ShoppingBag}
        actions={
          <Button onClick={() => navigate('/boq-normalize')}>New BOQ / PO</Button>
        }
      />
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-[200px] flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search order ID, supplier, or status…"
            value={orderSearch}
            onChange={(e) => setOrderSearch(e.target.value)}
          />
        </div>
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="processing">Processing</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Button variant="outline" size="sm" onClick={fetchDashboard} disabled={loading}>
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Refresh
        </Button>
        {!loading && yourOrders.length > 0 ? (
          <span className="text-sm text-muted-foreground sm:ml-auto">
            {filteredOrders.length} of {yourOrders.length} orders
          </span>
        ) : null}
        </div>

      {loadError ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="mb-3 h-5 w-40" />
                <Skeleton className="mb-2 h-4 w-full max-w-md" />
                <Skeleton className="h-3 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : yourOrders.length === 0 ? (
        <SpEmptyState
          icon={ShoppingCart}
          title="No orders yet"
          description="When you confirm purchase orders from a BOQ, they will appear here with tracking and documents."
          action={<Button onClick={() => navigate('/boq-normalize')}>Create BOQ / PO</Button>}
        />
      ) : filteredOrders.length === 0 ? (
        <SpEmptyState
          icon={Search}
          title="No matching orders"
          description="Try a different search or clear the status filter."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setOrderSearch('');
                setStatusFilter('all');
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredOrders.map((po) => {
            const { currentRank, steps } = stepsFor(po);
            const orderRef = po.orderNumber || po.id;
            return (
              <Card
                key={po.id}
                className="yo-card"
                onClick={() => openOrder(po)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openOrder(po);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <CardContent className="p-4">
                  <div className="yo-card__main">
                    <div className="yo-card__top">
                      <span className="yo-card__ref">
                          {orderRef}
                      </span>
                      <span className={cn('yo-badge', statusBadgeVariant(po.status))}>
                          {statusIcon(po.status)}
                          {formatOrderStatusLabel(po.status)}
                      </span>
                      <span className={cn('yo-badge', paymentBadgeVariant(po.paymentStatus))}>
                          {formatPaymentStatusLabel(po.paymentStatus)}
                      </span>
                    </div>

                    <div>
                      <p className="font-semibold text-foreground">{po.vendor}</p>
                        {po.vendorCompany && po.vendorCompany !== po.vendor ? (
                          <p className="text-sm text-muted-foreground">{po.vendorCompany}</p>
                        ) : null}
                    </div>

                    <div className="yo-card__row">
                    <div>
                        <span className="yo-card__amount-label">Order total</span>
                        <p className="yo-card__amount">
                            ₹{Number(po.amount || 0).toLocaleString('en-IN')}
                          </p>
                    </div>
                    </div>
                        {(po.expectedDeliveryDate || po.actualDeliveryDate) && (
                      <div className="yo-card__dates">
                            {po.expectedDeliveryDate && (
                          <span>
                            Expected <strong>{formatDateShort(po.expectedDeliveryDate)}</strong>
                              </span>
                            )}
                            {po.actualDeliveryDate && (
                          <span className="yo-arrived">
                            Delivered {formatDateShort(po.actualDeliveryDate)}
                              </span>
                            )}
                          </div>
                        )}

                  {String(po.paymentStatus || '').toLowerCase() === 'paid' && (
                      <div className="mt-1 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                      {po.invoicePdfUrl && (
                            <a
                              href={po.invoicePdfUrl}
                              className="yo-doc-link"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <FileText size={16} />
                              Invoice
                            </a>
                          )}
                          {po.receiptPdfUrl ? (
                            <a
                              href={po.receiptPdfUrl}
                              className="yo-doc-link yo-doc-link--receipt"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <FileText size={16} />
                              Receipt
                            </a>
                          ) : (
                            <button
                              type="button"
                              className="yo-doc-link yo-doc-link--receipt"
                              onClick={(e) => downloadReceiptFallback(po.orderNumber || po.id, e)}
                            >
                              <FileText size={16} />
                              Receipt
                            </button>
                      )}
                    </div>
                  )}

                    <div className="yo-track">
                      <div className="yo-track__bar-wrap">
                          <div
                            className="yo-track__bar"
                            style={{ width: `${progressPercent(currentRank)}%` }}
                          />
                      </div>
                      <div className="yo-track__labels">
                      {steps.map((step) => {
                        const done = step.rank === 0 ? true : step.rank <= currentRank;
                        const active = step.rank !== 0 && step.rank === currentRank;
                        return (
                          <span
                            key={step.key}
                            className={cn(
                              'yo-track__step',
                              done && 'yo-track__step--done',
                              active && 'yo-track__step--active'
                            )}
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
                      className="yo-btn-detail"
                      onClick={(e) => {
                        e.stopPropagation();
                        openOrder(po);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                      View details
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!selectedOrderId} onOpenChange={(open) => !open && closeOrderDialog()}>
        <DialogContent className="yo-order-dialog max-h-[90vh] max-w-2xl overflow-y-auto p-0 sm:max-w-3xl">
          <div className="yo-dialog-head">
            <DialogHeader className="space-y-3 text-left">
              <DialogTitle className="text-xl font-bold tracking-tight text-[#0f172a]">
                Order {orderDetails?.orderNumber || selectedOrderId}
              </DialogTitle>
              {orderDetails ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className={spStatusBadgeClass(orderDetails.status)}>
                    {formatOrderStatusLabel(orderDetails.status)}
                  </span>
                  <span className={spPaymentBadgeClass(orderDetails.paymentStatus)}>
                    {formatPaymentStatusLabel(orderDetails.paymentStatus)}
                  </span>
                  {orderDetails.totalAmount != null ? (
                    <span className="ml-auto text-lg font-bold text-[#0f172a]">
                      ₹{Number(orderDetails.totalAmount).toLocaleString('en-IN')}
                    </span>
                  ) : null}
                </div>
              ) : (
                <DialogDescription className="text-[#64748b]">
                  Loading order information…
                </DialogDescription>
              )}
            </DialogHeader>
          </div>

          <div className="space-y-4 px-6 py-4">
            {loadingOrderDetails ? (
              <div className="flex flex-col items-center justify-center py-16 text-[#64748b]">
                <Loader2 className="h-8 w-8 animate-spin text-[#4f46e5]" />
                <p className="mt-3 text-sm">Loading order details…</p>
              </div>
            ) : !orderDetails ? (
              <p className="py-8 text-center text-sm text-[#64748b]">
                Unable to load tracking details for this order.
              </p>
            ) : (
              <>
                {selfServeEditable ? (
                  <div className="yo-dialog-actions">
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
                      {cancellingOrder ? 'Cancelling…' : 'Cancel order'}
                    </button>
                  </div>
                ) : null}
                {!selfServeEditable && selfServeLockReason ? (
                  <p className="yo-lock-reason">{selfServeLockReason}</p>
                ) : null}

                {paymentNotice ? <p className="yo-payment-notice">{paymentNotice}</p> : null}

                {orderPaymentPending ? (
                  <OrderDialogSection title="Payment">
                    <p className="mb-3 text-sm text-[#475569]">
                      <strong className="text-[#0f172a]">Payment method:</strong>{' '}
                      {paymentMethodLabel(orderDetails)}
                    </p>
                    <div className="space-y-3">
                      {codChosen ? (
                        <p className="yo-payment-hint yo-payment-hint--cod">
                          You chose cash on delivery. Pay the supplier in cash when the order is
                          delivered; they will mark payment as received.
                        </p>
                      ) : null}
                      {creditChosen ? (
                        <p className="yo-payment-hint yo-payment-hint--credit">
                          This order is on credit terms. Complete payment per your agreement with
                          the supplier.
                        </p>
                      ) : null}
                      {(showRazorpayForOrder || showBankTransferForOrder) && (
                        <div className="yo-dialog-actions">
                          {showRazorpayForOrder ? (
                            <button
                              type="button"
                              className="btn-primary"
                              onClick={handlePayWithRazorpay}
                              disabled={processingPayment}
                            >
                              {processingPayment ? 'Processing…' : 'Pay now (Razorpay)'}
                            </button>
                          ) : null}
                          {showBankTransferForOrder ? (
                            <button
                              type="button"
                              className={bankOnlyChosen ? 'btn-primary' : 'btn-secondary'}
                              onClick={handleBankTransferFallback}
                              disabled={processingPayment}
                            >
                              Request bank transfer
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </OrderDialogSection>
                ) : null}

                {(orderDetails.invoicePdfUrl || orderDetails.receiptPdfUrl || !orderDetails.receiptPdfUrl) && (
                  <OrderDialogSection title="Documents">
                    <div className="yo-modal__docs flex flex-wrap gap-2">
                      {orderDetails.invoicePdfUrl ? (
                        <a
                          href={orderDetails.invoicePdfUrl}
                          className="yo-doc-link"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <FileText size={16} />
                          Invoice PDF
                        </a>
                      ) : null}
                      {orderDetails.receiptPdfUrl ? (
                        <a
                          href={orderDetails.receiptPdfUrl}
                          className="yo-doc-link yo-doc-link--receipt"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <FileText size={16} />
                          Payment receipt
                        </a>
                      ) : (
                        <button
                          type="button"
                          className="yo-doc-link yo-doc-link--receipt"
                          onClick={(e) =>
                            downloadReceiptFallback(orderDetails.orderNumber || orderDetails.id, e)
                          }
                        >
                          <FileText size={16} />
                          Payment receipt
                        </button>
                      )}
                    </div>
                  </OrderDialogSection>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <OrderDialogSection title="Supplier">
                    {orderDetails.supplier ? (
                      <div>
                        <p className="font-semibold text-foreground">
                          {orderDetails.supplier.name || '—'}
                        </p>
                        {orderDetails.supplier.company ? (
                          <p className="text-sm text-muted-foreground">{orderDetails.supplier.company}</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">Supplier information not available.</p>
                    )}
                  </OrderDialogSection>

                  <OrderDialogSection title="Fulfillment timeline">
                    {selectedOrderSteps ? (
                      <div className="arrival-timeline">
                        {selectedOrderSteps.steps.map((step) => {
                          const done =
                            step.rank === 0 ? true : step.rank <= selectedOrderSteps.currentRank;
                          const active =
                            step.rank !== 0 && step.rank === selectedOrderSteps.currentRank;
                          return (
                            <div
                              key={step.key}
                              className={`arrival-step ${done ? 'done' : ''} ${active ? 'active' : ''}`}
                            >
                              <div className="arrival-dot" />
                              <div className="arrival-step-body">
                                <div className="arrival-step-label">{step.label}</div>
                                <div className="arrival-step-date">
                                  {step.ts ? formatDate(step.ts) : '—'}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="m-0 text-sm text-[#64748b]">No timeline data.</p>
                    )}
                    <div className="mt-4 text-[0.8125rem] text-[#64748b]">
                      <div>
                        Expected delivery:{' '}
                        {orderDetails.expectedDeliveryDate
                          ? formatDate(orderDetails.expectedDeliveryDate)
                          : '—'}
                      </div>
                      <div
                        className="mt-1 font-semibold"
                        style={{
                          color: orderDetails.actualDeliveryDate ? '#047857' : '#64748b'
                        }}
                      >
                        Delivered:{' '}
                        {orderDetails.actualDeliveryDate
                          ? formatDate(orderDetails.actualDeliveryDate)
                          : '—'}
                      </div>
                    </div>
                  </OrderDialogSection>
                </div>

                {orderDetails.deliveryAddress ? (
                  <OrderDialogSection title="Delivery address">
                    <p className="text-sm leading-relaxed text-foreground">
                      {formatAddress(orderDetails.deliveryAddress)}
                    </p>
                    {(orderDetails.deliveryAddress.shippingAddress ||
                      orderDetails.deliveryAddress.billingAddress ||
                      orderDetails.deliveryAddress.deliveryDestination ||
                      orderDetails.deliveryAddress.gstin) && (
                      <dl className="mt-3 space-y-2 border-t pt-3 text-sm">
                        {orderDetails.deliveryAddress.deliveryDestination ? (
                          <div>
                            <dt className="text-muted-foreground">Destination</dt>
                            <dd className="font-medium">
                          {orderDetails.deliveryAddress.deliveryDestination === 'billing'
                            ? 'Billing address'
                            : 'Shipping address'}
                            </dd>
                      </div>
                        ) : null}
                        {orderDetails.deliveryAddress.gstin ? (
                          <div>
                            <dt className="text-muted-foreground">GSTIN</dt>
                            <dd className="font-medium">{orderDetails.deliveryAddress.gstin}</dd>
                  </div>
                        ) : null}
                        {orderDetails.deliveryAddress.shippingAddress ? (
                          <div>
                            <dt className="text-muted-foreground">Shipping</dt>
                            <dd>{formatAddress(orderDetails.deliveryAddress.shippingAddress)}</dd>
                          </div>
                        ) : null}
                        {orderDetails.deliveryAddress.billingAddress ? (
                          <div>
                            <dt className="text-muted-foreground">Billing (GST)</dt>
                            <dd>{formatAddress(orderDetails.deliveryAddress.billingAddress)}</dd>
                          </div>
                        ) : null}
                      </dl>
                    )}
                  </OrderDialogSection>
                ) : null}

                <OrderDialogSection title="Status history">
                  {Array.isArray(orderDetails.status_history) &&
                  orderDetails.status_history.length > 0 ? (
                    <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
                      {[...orderDetails.status_history]
                        .sort((a, b) => {
                          const ta = a?.timestamp
                            ? parseServerDate(a.timestamp)?.getTime() || 0
                            : 0;
                          const tb = b?.timestamp
                            ? parseServerDate(b.timestamp)?.getTime() || 0
                            : 0;
                          return ta - tb;
                        })
                        .map((h, idx) => (
                          <li key={`${h.status || 'status'}-${idx}`} className="yo-status-history-item">
                            <div className="font-semibold capitalize text-[#0f172a]">
                              {h.status || '—'}
                            </div>
                            <div className="mt-0.5 text-[0.8125rem] text-[#64748b]">
                              {h.timestamp ? formatDate(h.timestamp) : '—'}
                            </div>
                            {h.notes ? (
                              <div className="mt-2 text-[0.8125rem] text-[#475569]">{h.notes}</div>
                            ) : null}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted-foreground">No status history.</p>
                  )}
                </OrderDialogSection>

                {editMode && editingOrder ? (
                  <OrderDialogSection title="Edit order">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="edit-expected-delivery">Expected delivery</Label>
                        <Input
                          id="edit-expected-delivery"
                        type="datetime-local"
                          value={
                            editingOrder.expectedDeliveryDate
                              ? new Date(editingOrder.expectedDeliveryDate).toISOString().slice(0, 16)
                              : ''
                          }
                          onChange={(e) =>
                            setEditingOrder((prev) => ({
                              ...prev,
                              expectedDeliveryDate: e.target.value
                                ? new Date(e.target.value).toISOString()
                                : null
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-payment-method">Payment method</Label>
                      <select
                          id="edit-payment-method"
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        value={editingOrder.paymentMethod || ''}
                          onChange={(e) =>
                            setEditingOrder((prev) => ({ ...prev, paymentMethod: e.target.value }))
                          }
                      >
                        <option value="">Select payment method</option>
                        <option value="online">Online</option>
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="cash">Cash</option>
                        <option value="credit">Credit</option>
                      </select>
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="edit-notes">Order notes</Label>
                        <Textarea
                          id="edit-notes"
                        rows={2}
                          placeholder="Notes for the supplier"
                        value={editingOrder.notes || ''}
                          onChange={(e) =>
                            setEditingOrder((prev) => ({ ...prev, notes: e.target.value }))
                          }
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="edit-line1">Address line 1</Label>
                        <Input
                          id="edit-line1"
                        value={editingOrder.deliveryAddress?.line1 || ''}
                          onChange={(e) =>
                            setEditingOrder((prev) => ({
                              ...prev,
                              deliveryAddress: { ...prev.deliveryAddress, line1: e.target.value }
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-city">City</Label>
                        <Input
                          id="edit-city"
                          value={editingOrder.deliveryAddress?.city || ''}
                          onChange={(e) =>
                            setEditingOrder((prev) => ({
                              ...prev,
                              deliveryAddress: { ...prev.deliveryAddress, city: e.target.value }
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-state">State</Label>
                        <Input
                          id="edit-state"
                          value={editingOrder.deliveryAddress?.state || ''}
                          onChange={(e) =>
                            setEditingOrder((prev) => ({
                              ...prev,
                              deliveryAddress: { ...prev.deliveryAddress, state: e.target.value }
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-pincode">Pincode</Label>
                        <Input
                          id="edit-pincode"
                          value={editingOrder.deliveryAddress?.pincode || ''}
                          onChange={(e) =>
                            setEditingOrder((prev) => ({
                              ...prev,
                              deliveryAddress: { ...prev.deliveryAddress, pincode: e.target.value }
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-country">Country</Label>
                        <Input
                          id="edit-country"
                          value={editingOrder.deliveryAddress?.country || ''}
                          onChange={(e) =>
                            setEditingOrder((prev) => ({
                              ...prev,
                              deliveryAddress: { ...prev.deliveryAddress, country: e.target.value }
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="cancel-reason">Cancellation reason (optional)</Label>
                        <Input
                          id="cancel-reason"
                        value={cancelReason}
                        onChange={(e) => setCancelReason(e.target.value)}
                      />
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn-primary mt-4"
                      onClick={handleUpdateOrder}
                      disabled={savingOrderEdit}
                    >
                      {savingOrderEdit ? 'Saving…' : 'Save changes'}
                    </button>
                  </OrderDialogSection>
                ) : null}

                {canRateOrder ? (
                  <OrderDialogSection title="Rate this order">
                    {ratingLoading ? (
                      <p className="text-sm text-muted-foreground">Loading your previous rating…</p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setRating(star)}
                              className="rounded border-none bg-transparent p-0 text-[1.35rem] leading-none"
                              style={{
                                cursor: 'pointer',
                                color: star <= rating ? '#f59e0b' : '#cbd5e1'
                              }}
                              aria-label={`Rate ${star} stars`}
                            >
                              ★
                            </button>
                          ))}
                        </div>
                        <Textarea
                          rows={3}
                          placeholder="Share your experience with this order"
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                        />
                        <button
                          type="button"
                          className="btn-primary"
                          onClick={handleSubmitRating}
                          disabled={submittingRating}
                        >
                          {submittingRating ? 'Submitting…' : 'Submit review'}
                        </button>
                        </div>
                    )}
                  </OrderDialogSection>
                ) : null}
              </>
            )}
          </div>

          <DialogFooter className="yo-modal-footer p-0">
            <button type="button" className="btn-secondary" onClick={closeOrderDialog}>
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SpPageLayout>
  );
};

export default YourOrders;
