import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { getApiUrl } from '../config/api';
import {
  ShoppingCart,
  MapPin,
  Trash2,
  CheckCircle,
  AlertCircle,
  Clock,
  FileText,
  RefreshCw,
  User,
  Phone,
  History,
  Store,
  ScanLine,
  Banknote,
  Smartphone,
  CreditCard,
  Wallet
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { formatDateIST, formatDateTimeIST } from '../utils/dateTime';
import {
  cacheBarcodeLookup,
  clearSyncedPosOrders,
  enqueuePosOrder,
  getCachedBarcodeLookup,
  getPendingPosOrders,
  loadPosQueue,
  markPosOrderSynced
} from '../utils/offlinePosStorage';
import { formatRupee } from '../utils/formatRupee';
import './SupplierPOS.css';

const selectClassName =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50';

const SupplierPOS = () => {
  const [locations, setLocations] = useState([]);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [cartItems, setCartItems] = useState([]);
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [syncingQueue, setSyncingQueue] = useState(false);
  const [pendingQueueCount, setPendingQueueCount] = useState(0);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [lastOrders, setLastOrders] = useState([]);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [amountReceived, setAmountReceived] = useState('');
  const [receiptData, setReceiptData] = useState(null);
  const [scanMode, setScanMode] = useState('gsku');
  const [creditInfo, setCreditInfo] = useState(null);
  const [creditLoading, setCreditLoading] = useState(false);
  const [posCreditLimit, setPosCreditLimit] = useState('');
  const [savingPosCredit, setSavingPosCredit] = useState(false);

  const barcodeInputRef = useRef(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [registerClock, setRegisterClock] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setRegisterClock(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const onOnlineStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', onOnlineStatus);
    window.addEventListener('offline', onOnlineStatus);
    return () => {
      window.removeEventListener('online', onOnlineStatus);
      window.removeEventListener('offline', onOnlineStatus);
    };
  }, []);

  useEffect(() => {
    const fetchLocations = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(getApiUrl('/api/supplier/locations'), {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        const data = await res.json();
        if (data.status === 'success') {
          // Show both outlets and branches (legacy profile branches)
          const allLocations = data.locations || [];
          setLocations(allLocations);
          if (allLocations.length > 0) {
            // Prefer outlets over branches, but allow both
            const preferred = allLocations.find(loc => loc.type === 'outlet') || allLocations[0];
            setSelectedLocationId(String(preferred.id));
          }
        }
      } catch (e) {
        console.error('Failed to fetch POS locations:', e);
      }
    };
    fetchLocations();
    fetchLastOfflineOrders();

    setPendingQueueCount(getPendingPosOrders().length);
    const onOnline = () => {
      syncPendingOrders().catch(() => {});
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, []);

  const fetchLastOfflineOrders = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/orders'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (data.status === 'success') {
        const offlineOrders = (data.orders || []).filter(o => o.channel === 'offline_sale').slice(0, 5);
        setLastOrders(offlineOrders);
      }
    } catch (e) {
      console.error('Failed to fetch last offline orders:', e);
    }
  };

  async function syncPendingOrders() {
    const pending = getPendingPosOrders();
    if (pending.length === 0) {
      setPendingQueueCount(0);
      return;
    }
    if (!navigator.onLine) return;

    setSyncingQueue(true);
    try {
      const token = localStorage.getItem('token');
      const queue = loadPosQueue();

      for (const entry of queue) {
        if (entry.status !== 'pending') continue;
        const payload = entry.payload || {};

        const res = await fetch(getApiUrl('/api/pos/offline-order'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.status !== 'success') {
          throw new Error(data.message || 'Failed to sync offline POS order');
        }

        markPosOrderSynced(entry.id, data.orderNumber || null);
      }

      clearSyncedPosOrders();
      setPendingQueueCount(getPendingPosOrders().length);
      fetchLastOfflineOrders();
    } finally {
      setSyncingQueue(false);
    }
  }

  const handleScan = async (e) => {
    e.preventDefault();
    setError('');
    setSuccessMessage('');

    const code = (barcode || '').trim();
    if (!code) {
      setError('Please enter a barcode');
      return;
    }

    // Clear barcode input immediately for continuous scanning (Walmart-style)
    const scannedBarcode = code;
    const scannedQuantity = parseFloat(quantity) || 1;
    setBarcode('');
    setQuantity(1);
    
    // Refocus input immediately for next scan
    setTimeout(() => {
      barcodeInputRef.current?.focus();
    }, 50);

    try {
      setLoadingProduct(true);
      const token = localStorage.getItem('token');
      const scanQs = `scanType=${encodeURIComponent(scanMode)}${selectedLocationId ? `&outletId=${encodeURIComponent(selectedLocationId)}` : ''}`;
      const url = getApiUrl(
        `/api/pos/product/barcode/${encodeURIComponent(scannedBarcode)}?${scanQs}`
      );
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        const cached = getCachedBarcodeLookup({
          barcode: scannedBarcode,
          outletId: selectedLocationId || null,
          scanType: scanMode
        });
        if (!navigator.onLine && cached?.product) {
          addProductToBill({ product: cached.product, qty: scannedQuantity });
          return;
        }
        // Show error but don't block next scan - clear after 2 seconds
        setError(data.message || 'Product not found for this barcode');
        setTimeout(() => setError(''), 2000);
        return;
      }
      if (data.product) {
        cacheBarcodeLookup({
          barcode: scannedBarcode,
          outletId: selectedLocationId || null,
          scanType: scanMode,
          product: data.product
        });
      }
      addProductToBill({ product: data.product, qty: scannedQuantity });
    } catch (e) {
      console.error('Barcode lookup error:', e);
      const cached = getCachedBarcodeLookup({
        barcode: scannedBarcode,
        outletId: selectedLocationId || null,
        scanType: scanMode
      });
      if (cached?.product) {
        addProductToBill({ product: cached.product, qty: scannedQuantity });
      } else {
        // Show error but don't block next scan - clear after 2 seconds
        setError('Failed to lookup product. Please try again.');
        setTimeout(() => setError(''), 2000);
      }
    } finally {
      setLoadingProduct(false);
    }
  };

  const addProductToBill = ({ product, qty }) => {
    const safeQty = parseFloat(qty) || 0;
    if (!product || safeQty <= 0) return;

    const unitPrice = parseFloat(product.price) || 0;
    const supplierProductId = product.supplier_product_id || null;

    setCartItems(prev => {
      const idx = prev.findIndex(i =>
        i.product_id === product.id &&
        (i.supplier_product_id || null) === supplierProductId &&
        Number(i.unit_price) === Number(unitPrice)
      );
      if (idx >= 0) {
        // Product already in cart - increment quantity (Walmart-style)
        const next = [...prev];
        const existing = next[idx];
        const newQty = (parseFloat(existing.quantity) || 0) + safeQty;
        next[idx] = {
          ...existing,
          quantity: newQty,
          total_price: newQty * unitPrice
        };
        setSuccessMessage(`${product.name} - Quantity updated to ${newQty}`);
        return next;
      }
      // New product - add to cart
      const newItem = {
        product_id: product.id,
        supplier_product_id: supplierProductId,
        name: product.name,
        quantity: safeQty,
        unit_price: unitPrice,
        total_price: safeQty * unitPrice
      };
      setSuccessMessage(`${product.name} added to bill`);
      return [...prev, newItem];
    });

    setError('');
    // Clear success message after 1.5 seconds for faster scanning
    setTimeout(() => setSuccessMessage(''), 1500);
  };

  const handleRemoveItem = (index) => {
    setCartItems(prev => prev.filter((_, i) => i !== index));
  };

  const totalAmount = cartItems.reduce((sum, item) => sum + (parseFloat(item.total_price) || 0), 0);
  const payLaterAvailable = Boolean(creditInfo?.allowed && creditInfo?.payLaterOffered);

  useEffect(() => {
    if (paymentMethod === 'credit' && !payLaterAvailable) {
      setPaymentMethod('cash');
    }
  }, [paymentMethod, payLaterAvailable]);

  useEffect(() => {
    const phone = (customerPhone || '').trim();
    const name = (customerName || '').trim();
    if (!phone || !name) {
      setCreditInfo(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        setCreditLoading(true);
        const token = localStorage.getItem('token');
        const params = new URLSearchParams({
          customerName: (customerName || '').trim(),
          customerPhone: phone,
          orderAmount: String(totalAmount || 0)
        });
        const res = await fetch(getApiUrl(`/api/supplier/credit-accounts/check?${params}`), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        setCreditInfo(data.status === 'success' ? data.credit : null);
      } catch {
        setCreditInfo(null);
      } finally {
        setCreditLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [customerName, customerPhone, totalAmount]);

  const savePosCreditLimit = async () => {
    const phone = (customerPhone || '').trim();
    const limit = Number(posCreditLimit);
    if (!phone) {
      setError('Enter customer phone before setting a pay-later limit.');
      return;
    }
    if (!Number.isFinite(limit) || limit <= 0) {
      setError('Enter a valid pay-later limit greater than ₹0.');
      return;
    }
    try {
      setSavingPosCredit(true);
      setError('');
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/credit-accounts'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          customerPhone: phone,
          creditLimit: limit,
          paylaterThreshold: 0,
          creditPeriodDays: 30,
          isEnabled: true
        })
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to save pay-later limit');
      }
      setPosCreditLimit('');
      setSuccessMessage(`Pay-later limit set for ${phone}.`);
      const params = new URLSearchParams({
        customerName: (customerName || '').trim(),
        customerPhone: phone,
        orderAmount: String(totalAmount || 0)
      });
      const checkRes = await fetch(getApiUrl(`/api/supplier/credit-accounts/check?${params}`), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const checkData = await checkRes.json();
      setCreditInfo(checkData.status === 'success' ? checkData.credit : null);
    } catch (err) {
      setError(err.message || 'Failed to save pay-later limit');
    } finally {
      setSavingPosCredit(false);
    }
  };

  const handleCheckout = async ({ paymentOverride } = {}) => {
    setError('');
    setSuccessMessage('');

    const trimmedName = (customerName || '').trim();

    if (!selectedLocationId) {
      setError('Please select an outlet/location before checkout');
      return;
    }
    if (cartItems.length === 0) {
      setError('No items scanned yet');
      return;
    }
    if (!trimmedName) {
      setError('Customer name is required before payment.');
      return;
    }

    try {
      setCheckingOut(true);
      const token = localStorage.getItem('token');
      const clientOrderId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
      const method = paymentOverride?.method || 'cash';
      const paymentPayload =
        paymentOverride ||
        (method === 'credit'
          ? { method: 'credit', status: 'pending', reference: null }
          : { method: 'cash', status: 'paid' });
      if (!(customerPhone || '').trim()) {
        setError('Customer phone is required for offline POS sales.');
        return;
      }
      if (method === 'credit' && !(customerName || '').trim()) {
        setError('Customer name is required for credit (pay later) sales.');
        return;
      }
      if (method === 'credit' && creditInfo && !creditInfo.allowed) {
        setError(
          `${creditInfo.message || 'Pay later is not available.'} Use cash, UPI, card, or bank transfer instead.`
        );
        return;
      }
      const payload = {
        outletId: selectedLocationId,
        clientOrderId,
        customerName: trimmedName,
        customerPhone: (customerPhone || '').trim() || null,
        items: cartItems.map(item => ({
          product_id: item.product_id,
          quantity: item.quantity,
          unit_price: item.unit_price,
          supplier_product_id: item.supplier_product_id || null
        })),
        payment: paymentPayload
      };
      const res = await fetch(getApiUrl('/api/pos/offline-order'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        setError(data.message || 'Failed to create offline order');
        return;
      }
      const now = new Date();
      setReceiptData({
        mode: 'online',
        orderNumber: data.orderNumber,
        invoiceNumber: data.invoiceNumber || null,
        invoicePdfUrl: data.invoicePdfUrl || null,
        receiptNumber: data.receiptNumber || null,
        createdAt: now.toISOString(),
        items: cartItems,
        totalAmount,
        customerName: trimmedName,
        customerPhone: (customerPhone || '').trim(),
        payment: paymentPayload,
        amountReceived: amountReceived ? Number(amountReceived) : null,
        gstSummary: data.gstSummary || null
      });
      setShowReceiptModal(true);
      setShowPaymentModal(false);
      setSuccessMessage(
        paymentPayload.method === 'credit'
          ? `Sale on credit recorded. Order ${data.orderNumber} — payment pending.`
          : `Payment done. Receipt ready for Order ${data.orderNumber}.`
      );
      setCartItems([]);
      fetchLastOfflineOrders();
      setCustomerName('');
      setCustomerPhone('');
      setTimeout(() => setSuccessMessage(''), 5000);
    } catch (e) {
      console.error('Offline checkout error:', e);
      const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (isOffline) {
        const clientOrderId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
        const method = paymentOverride?.method || 'cash';
        const paymentPayload =
          paymentOverride ||
          (method === 'credit'
            ? { method: 'credit', status: 'pending', reference: null }
            : { method: 'cash', status: 'paid' });
        if (!(customerPhone || '').trim()) {
          setError('Customer phone is required for offline POS sales.');
          return;
        }
        if (!trimmedName) {
          setError('Customer name is required before payment.');
          return;
        }
        if (method === 'credit' && creditInfo && !creditInfo.allowed) {
          setError(creditInfo.message || 'Credit limit exceeded for this customer.');
          return;
        }
        const queued = enqueuePosOrder({
          outletId: selectedLocationId,
          clientOrderId,
          customerName: trimmedName,
          customerPhone: (customerPhone || '').trim() || null,
          items: cartItems.map(item => ({
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            supplier_product_id: item.supplier_product_id || null
          })),
          payment: paymentPayload
        });
        setPendingQueueCount(getPendingPosOrders().length);
        const now = new Date();
        setReceiptData({
          mode: 'offline_queued',
          queuedId: queued.id,
          createdAt: now.toISOString(),
          items: cartItems,
          totalAmount,
          customerName: trimmedName,
          customerPhone: (customerPhone || '').trim(),
          payment: paymentPayload,
          amountReceived: amountReceived ? Number(amountReceived) : null,
          gstSummary: null
        });
        setShowReceiptModal(true);
        setShowPaymentModal(false);
        setSuccessMessage(`No internet. Sale saved locally and receipt generated (queued).`);
        setCartItems([]);
        setCustomerName('');
        setCustomerPhone('');
        return;
      }
      setError('Failed to complete checkout. Please try again.');
    } finally {
      setCheckingOut(false);
    }
  };

  const openPaymentModal = () => {
    openPaymentWithMethod('cash');
  };

  const openPaymentWithMethod = (method) => {
    setError('');
    if (!selectedLocationId) {
      setError('Select store location before payment');
      return;
    }
    if (cartItems.length === 0) {
      setError('Scan at least one item before payment');
      return;
    }
    if (!(customerName || '').trim()) {
      setError('Enter customer name before payment.');
      return;
    }
    if (!(customerPhone || '').trim()) {
      setError('Enter customer phone before payment.');
      return;
    }
    if (method === 'credit' && !(customerName || '').trim()) {
      setError('Customer name is required for credit sales.');
      return;
    }
    if (method === 'credit' && creditInfo && !payLaterAvailable) {
      setError(creditInfo.message || 'Pay later is not available for this order.');
      return;
    }
    setPaymentReference('');
    setPaymentMethod(method);
    if (method === 'credit') {
      setAmountReceived('');
    } else if (method === 'cash') {
      setAmountReceived(totalAmount.toFixed(2));
    } else {
      setAmountReceived('');
    }
    setShowPaymentModal(true);
  };

  const handleClearBill = () => {
    if (cartItems.length === 0) return;
    if (window.confirm('Clear all items from this bill?')) {
      setCartItems([]);
      setError('');
      setSuccessMessage('');
      setTimeout(() => barcodeInputRef.current?.focus(), 0);
    }
  };

  const printReceipt = () => {
    if (!receiptData) return;

    const itemsHtml = (receiptData.items || []).map((it) => {
      const qty = Number(it.quantity || 0);
      const unit = Number(it.unit_price || 0);
      const total = Number(it.total_price || (qty * unit));
      return `
        <tr>
          <td style="padding:6px 0;">${String(it.name || '')}</td>
          <td style="padding:6px 0; text-align:right;">${qty}</td>
          <td style="padding:6px 0; text-align:right;">₹${unit.toFixed(2)}</td>
          <td style="padding:6px 0; text-align:right;">₹${total.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    const total = Number(receiptData.totalAmount || 0);
    const gstSummary = receiptData.gstSummary || null;
    const received = receiptData.amountReceived != null ? Number(receiptData.amountReceived) : null;
    const change = received != null ? (received - total) : null;

    const title = receiptData.mode === 'offline_queued' ? 'POS Receipt (Queued)' : 'POS Receipt';
    const numberLine = receiptData.mode === 'offline_queued'
      ? `Queued ID: ${receiptData.queuedId || '/'}`
      : `Order: ${receiptData.orderNumber || '/'}<br/>Invoice: ${receiptData.invoiceNumber || '/'}<br/>Receipt: ${receiptData.receiptNumber || '/'}${receiptData.invoicePdfUrl ? `<br/><a href="${receiptData.invoicePdfUrl}" target="_blank" rel="noopener">Download full invoice (PDF)</a>` : ''}`;

    const w = window.open('', '_blank', 'width=420,height=700');
    if (!w) return;
    w.document.write(`
      <html>
      <head>
        <title>${title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body{font-family: Arial, sans-serif; padding:16px; color:#111;}
          h2{margin:0 0 8px;}
          .muted{color:#555; font-size:12px;}
          table{width:100%; border-collapse:collapse; margin-top:12px;}
          th{border-bottom:1px solid #ddd; text-align:left; padding:6px 0; font-size:12px; color:#555;}
          tfoot td{border-top:1px solid #ddd; padding-top:8px; font-weight:700;}
        </style>
      </head>
      <body>
        <h2>${title}</h2>
        <div class="muted">
          ${numberLine}<br/>
          Date: ${formatDateTimeIST(receiptData.createdAt || Date.now())}<br/>
          Customer: ${(receiptData.customerName || 'Walk-in')} ${receiptData.customerPhone ? `(${receiptData.customerPhone})` : ''}<br/>
          Payment: ${(receiptData.payment?.method || 'cash')}
        </div>

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th style="text-align:right;">Qty</th>
              <th style="text-align:right;">Rate</th>
              <th style="text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
          <tfoot>
            ${gstSummary ? `
            <tr>
              <td colspan="3">Taxable Subtotal</td>
              <td style="text-align:right;">₹${Number(gstSummary.subtotalAmount || 0).toFixed(2)}</td>
            </tr>
            <tr>
              <td colspan="3">${gstSummary.taxType === 'IGST' ? 'IGST' : 'CGST + SGST'}</td>
              <td style="text-align:right;">₹${Number(gstSummary.taxAmount || 0).toFixed(2)}</td>
            </tr>
            ` : ''}
            <tr>
              <td colspan="3">Grand Total</td>
              <td style="text-align:right;">₹${total.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>

        ${received != null ? `<div style="margin-top:12px;" class="muted">Received: ₹${received.toFixed(2)}<br/>Change: ₹${(change || 0).toFixed(2)}</div>` : ''}

        <script>
          window.focus();
          window.print();
        </script>
      </body>
      </html>
    `);
    w.document.close();
  };

  const selectedLocation = locations.find((loc) => String(loc.id) === String(selectedLocationId));
  const storeLabel =
    selectedLocation?.fullText || selectedLocation?.displayText || selectedLocation?.name || 'Select location';
  const trimmedCustomerName = (customerName || '').trim();
  const customerLabel = trimmedCustomerName || '—';
  const canCheckout =
    cartItems.length > 0 && selectedLocationId && !checkingOut && trimmedCustomerName.length > 0;
  const receiptTime = formatDateTimeIST(registerClock);

  return (
    <div className="supplier-pos-page">
    <div className="pos-register">
      <header className="pos-register__topbar">
        <div className="pos-register__brand">
          <div className="pos-register__brand-icon">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <div className="pos-register__title">Offline sales</div>
            <div className="pos-register__subtitle">In-store register</div>
          </div>
        </div>
        {pendingQueueCount > 0 ? (
          <div className="pos-register__status">
            <span className="pos-register__status-pill pos-register__status-pill--queue">
              <Clock className="h-3 w-3" />
              {pendingQueueCount} to sync
            </span>
          </div>
        ) : null}
      </header>

      <div className="pos-register__body">
        <section className="pos-register__receipt" aria-label="Current bill">
          <div className="pos-receipt-paper">
            <div className="pos-receipt-paper__head">
              <div className="pos-receipt-paper__store">{storeLabel}</div>
              <div className="pos-receipt-paper__meta">
                {receiptTime}
                <br />
                Customer: {customerLabel}
                <br />
                {cartItems.length} item{cartItems.length !== 1 ? 's' : ''} · GSKU scan
              </div>
            </div>

            <div className="pos-receipt-paper__lines">
              {cartItems.length === 0 ? (
                <div className="pos-receipt-paper__empty">
                  <ShoppingCart className="pos-receipt-paper__empty-icon" strokeWidth={1.25} />
                  <p className="pos-receipt-paper__empty-title">Bill is empty</p>
                  <p className="pos-receipt-paper__empty-hint">Scan a product barcode to start the sale</p>
                </div>
              ) : (
                cartItems.map((item, idx) => (
                  <div key={idx} className="pos-receipt-line">
                    <div className="pos-receipt-line__main">
                      <span className="pos-receipt-line__name">{item.name}</span>
                      <span className="pos-receipt-line__qty">
                        {item.quantity} × {formatRupee(item.unit_price)}
                      </span>
                    </div>
                    <span className="pos-receipt-line__amt">{formatRupee(item.total_price)}</span>
                    <button
                      type="button"
                      className="pos-receipt-line__remove"
                      onClick={() => handleRemoveItem(idx)}
                      title="Remove line"
                      aria-label={`Remove ${item.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="pos-receipt-paper__foot">
              <div className="pos-receipt-paper__row">
                <span>Items</span>
                <span>{cartItems.length}</span>
              </div>
              <div className="pos-receipt-paper__total">
                <span className="pos-receipt-paper__total-label">Total</span>
                <span className="pos-receipt-paper__total-amt">{formatRupee(totalAmount)}</span>
              </div>
            </div>
          </div>

          <div className="pos-register__pay-bar">
            <button
              type="button"
              className="pos-register__pay-btn"
              onClick={openPaymentModal}
              disabled={!canCheckout}
            >
              {checkingOut ? 'Processing…' : `Collect payment · ${formatRupee(totalAmount)}`}
            </button>
            <button
              type="button"
              className="pos-register__clear-btn"
              onClick={handleClearBill}
              disabled={cartItems.length === 0}
            >
              Void / clear bill
            </button>
          </div>
        </section>

        <section className="pos-register__station" aria-label="Scan and pay">
          <div className="pos-station__inner">
            <div className="pos-station__location">
              <label htmlFor="pos-location">Store counter</label>
              <select
                id="pos-location"
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
              >
                {locations.length === 0 && <option value="">Add outlet in profile</option>}
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.fullText || loc.displayText || loc.name}
                    {loc.type === 'branch' ? ' (Branch)' : ''}
                  </option>
                ))}
              </select>
              {locations.length === 0 ? (
                <p className="pos-station__alert pos-station__alert--warn" style={{ marginTop: '0.5rem' }}>
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>
                    <Link to="/profile">Add outlet</Link> in profile to sell.
                  </span>
                </p>
              ) : null}
            </div>

            <div className="pos-station__customer">
              <p className="pos-station__section-label">
                <User className="inline h-3.5 w-3.5" style={{ verticalAlign: '-2px', marginRight: 4 }} />
                Customer
              </p>
              <div className="pos-station__customer-fields">
                <div>
                  <label htmlFor="pos-customer-name" className="pos-station__label-required">
                    Customer name
                  </label>
                  <input
                    id="pos-customer-name"
                    type="text"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Required for every sale"
                    required
                    aria-required="true"
                    autoComplete="name"
                  />
                </div>
                <div>
                  <label htmlFor="pos-customer-phone">Phone (required)</label>
                  <input
                    id="pos-customer-phone"
                    type="tel"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    placeholder="Required for checkout"
                    autoComplete="tel"
                  />
                </div>
              </div>
              {(customerPhone || '').trim() ? (
                <p
                  className={cn(
                    'pos-station__credit-note',
                    payLaterAvailable ? 'pos-station__credit-note--ok' : 'pos-station__credit-note--bad'
                  )}
                >
                  {creditLoading
                    ? 'Checking pay later…'
                    : payLaterAvailable
                      ? creditInfo?.message
                      : creditInfo?.message
                        ? `${creditInfo.message} Cash, UPI, and card checkout are still available.`
                        : 'Pay later is not set up for this phone yet. Set a limit below or use cash, UPI, or card.'}
                </p>
              ) : null}
              {(customerPhone || '').trim() && !creditLoading && !payLaterAvailable ? (
                <div className="pos-station__credit-setup">
                  <Label htmlFor="pos-credit-limit">Pay-later limit (₹)</Label>
                  <div className="pos-station__credit-setup-row">
                    <Input
                      id="pos-credit-limit"
                      type="number"
                      min="1"
                      step="100"
                      value={posCreditLimit}
                      onChange={(e) => setPosCreditLimit(e.target.value)}
                      placeholder="e.g. 50000"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={savePosCreditLimit}
                      disabled={savingPosCredit}
                    >
                      {savingPosCredit ? 'Saving…' : 'Set limit'}
                    </Button>
                  </div>
                </div>
              ) : null}
              {cartItems.length > 0 && !trimmedCustomerName ? (
                <p className="pos-station__alert pos-station__alert--warn" style={{ marginTop: '0.5rem' }}>
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>Enter customer name to collect payment.</span>
                </p>
              ) : null}
            </div>

            <form className="pos-scan-box" onSubmit={handleScan}>
              <div className="pos-scan-box__label">
                <ScanLine className="h-4 w-4" />
                Scan barcode / GSKU
              </div>
              <input
                id="pos-barcode"
                ref={barcodeInputRef}
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleScan(e);
                  }
                }}
                placeholder="Scan here…"
                autoFocus
                disabled={loadingProduct}
                autoComplete="off"
              />
              <div className="pos-scan-box__row">
                <div>
                  <label htmlFor="pos-qty">Qty</label>
                  <input
                    id="pos-qty"
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
                <div>
                  <button type="submit" className="pos-scan-box__add" disabled={loadingProduct || !barcode.trim()}>
                    {loadingProduct ? 'Looking up…' : 'Add to bill'}
                  </button>
                </div>
              </div>
            </form>

            {error ? (
              <div className="pos-station__alert pos-station__alert--error" role="alert">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            ) : null}
            {successMessage ? (
              <div className="pos-station__alert pos-station__alert--success" role="status">
                <CheckCircle className="h-4 w-4 shrink-0" />
                <span>{successMessage}</span>
              </div>
            ) : null}

            <div>
              <p className="pos-station__section-label">Quick payment</p>
              <div className="pos-quick-pay">
                <button
                  type="button"
                  className="pos-quick-pay__btn"
                  disabled={!canCheckout}
                  onClick={() => openPaymentWithMethod('cash')}
                >
                  <Banknote />
                  Cash
                </button>
                <button
                  type="button"
                  className="pos-quick-pay__btn"
                  disabled={!canCheckout}
                  onClick={() => openPaymentWithMethod('upi')}
                >
                  <Smartphone />
                  UPI
                </button>
                <button
                  type="button"
                  className="pos-quick-pay__btn"
                  disabled={!canCheckout}
                  onClick={() => openPaymentWithMethod('card')}
                >
                  <CreditCard />
                  Card
                </button>
                {(customerPhone || '').trim() &&
                (customerName || '').trim() &&
                payLaterAvailable ? (
                  <button
                    type="button"
                    className="pos-quick-pay__btn"
                    disabled={!canCheckout}
                    onClick={() => openPaymentWithMethod('credit')}
                  >
                    <Wallet />
                    Pay later
                  </button>
                ) : null}
              </div>
            </div>

            <details className="pos-station__panel">
              <summary>
                <History className="h-4 w-4" />
                Recent sales ({lastOrders.length})
              </summary>
              <div className="pos-station__panel__body">
                {lastOrders.length === 0 ? (
                  <p className="pos-recent-empty">No sales yet</p>
                ) : (
                  lastOrders.map((o) => (
                    <div key={o.id} className="pos-recent-sale">
                      <div>
                        <div className="pos-recent-sale__id">{o.order_number || o.id}</div>
                        <div className="pos-recent-sale__time">
                          {o.created_at && formatDateTimeIST(o.created_at, '—')}
                        </div>
                        {o.invoicePdfUrl ? (
                          <a
                            href={o.invoicePdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="pos-recent-sale__link"
                          >
                            Invoice PDF
                          </a>
                        ) : null}
                      </div>
                      <strong className="pos-recent-sale__amt">{formatRupee(o.total_amount)}</strong>
                    </div>
                  ))
                )}
              </div>
            </details>
          </div>

          <div className="pos-station__sync">
            <p className="pos-station__sync-title">Offline sync</p>
            <div className="pos-station__sync-row">
              <button
                type="button"
                onClick={() => syncPendingOrders().catch((err) => setError(err.message || 'Sync failed'))}
                disabled={syncingQueue || pendingQueueCount === 0 || !isOnline}
              >
                <RefreshCw className={cn('inline h-3.5 w-3.5 mr-1', syncingQueue && 'animate-spin')} />
                {syncingQueue ? 'Syncing…' : 'Sync sales'}
              </button>
              <button
                type="button"
                onClick={() => {
                  clearSyncedPosOrders();
                  setPendingQueueCount(getPendingPosOrders().length);
                }}
                disabled={syncingQueue}
              >
                Clear queue
              </button>
            </div>
          </div>
        </section>
      </div>


      <Dialog open={showPaymentModal} onOpenChange={setShowPaymentModal}>
        <DialogContent className="pos-pay-dialog max-w-md sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Collect payment</DialogTitle>
            <DialogDescription>Confirm tender type and complete this in-store sale.</DialogDescription>
          </DialogHeader>

          <div className="pos-pay-total">
            <span>Amount due</span>
            <strong>{formatRupee(totalAmount)}</strong>
          </div>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="pos-payment-method">Payment method</Label>
              <select
                id="pos-payment-method"
                value={paymentMethod}
                onChange={(e) => {
                  const next = e.target.value;
                  setPaymentMethod(next);
                  if (next === 'credit') {
                    setAmountReceived('');
                  } else if (next === 'cash' && !amountReceived) {
                    setAmountReceived(totalAmount.toFixed(2));
                  }
                }}
                className={selectClassName}
              >
                <option value="cash">Cash</option>
                <option value="card">Card (Debit/Credit)</option>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer (NEFT/RTGS/IMPS)</option>
                {payLaterAvailable ? <option value="credit">Credit (Pay Later)</option> : null}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pos-payment-ref">Payment reference (optional)</Label>
              <Input
                id="pos-payment-ref"
                type="text"
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                placeholder="UPI ID / transaction ID / note"
              />
            </div>

            {paymentMethod === 'credit' ? (
              <Alert className="border-blue-200 bg-blue-50 text-blue-950 [&>svg]:text-blue-600">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {creditLoading
                    ? 'Checking credit…'
                    : creditInfo?.message ||
                      'Set this customer’s credit limit before pay-later checkout.'}
                  {creditInfo?.account ? (
                    <span className="mt-1 block text-xs opacity-90">
                      Loan cycle: {creditInfo.creditPeriodDays} days · Limit:{' '}
                      {formatRupee(creditInfo.creditLimit)} · Outstanding:{' '}
                      {formatRupee(creditInfo.outstanding)} · Remaining for this order:{' '}
                      {formatRupee(creditInfo.available ?? creditInfo.remainingCredit)}
                      {creditInfo.cycleDueAt ? (
                        <>
                          {' '}
                          · Due {formatDateIST(creditInfo.cycleDueAt, '—')}
                          {creditInfo.cycleIsOverdue ? ' (overdue — settle full amount)' : ''}
                        </>
                      ) : null}
                    </span>
                  ) : null}
                </AlertDescription>
              </Alert>
            ) : null}

            {paymentMethod !== 'credit' ? (
              <div className="space-y-2">
                <Label htmlFor="pos-amount-received">Amount received (optional)</Label>
                <Input
                  id="pos-amount-received"
                  type="number"
                  value={amountReceived}
                  onChange={(e) => setAmountReceived(e.target.value)}
                  placeholder="Enter amount received"
                  min="0"
                  step="0.01"
                />
                {amountReceived && parseFloat(amountReceived) > 0 ? (
                  <p className="text-sm font-medium">
                    {parseFloat(amountReceived) >= totalAmount ? (
                      <span className="text-emerald-600">
                        Change: {formatRupee(parseFloat(amountReceived) - totalAmount)}
                      </span>
                    ) : (
                      <span className="text-destructive">
                        Short by: {formatRupee(totalAmount - parseFloat(amountReceived))}
                      </span>
                    )}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowPaymentModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                handleCheckout({
                  paymentOverride: {
                    method: paymentMethod,
                    status: paymentMethod === 'credit' ? 'pending' : 'paid',
                    reference: paymentReference || null,
                    amount_received:
                      paymentMethod === 'credit'
                        ? null
                        : amountReceived
                          ? parseFloat(amountReceived)
                          : null
                  }
                })
              }
              disabled={
                checkingOut ||
                !trimmedCustomerName ||
                (paymentMethod === 'credit' &&
                  (!((customerPhone || '').trim()) ||
                    (creditInfo && (!creditInfo.payLaterOffered || !creditInfo.allowed))))
              }
            >
              {checkingOut
                ? 'Processing…'
                : paymentMethod === 'credit'
                  ? 'Complete on credit'
                  : 'Pay & complete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showReceiptModal}
        onOpenChange={(open) => {
          setShowReceiptModal(open);
          if (!open) setReceiptData(null);
        }}
      >
        {receiptData ? (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Receipt</DialogTitle>
              <DialogDescription>
                {receiptData.mode === 'offline_queued'
                  ? 'Temporary receipt — sync for official numbers.'
                  : 'Sale completed successfully.'}
              </DialogDescription>
            </DialogHeader>

            <Alert
              className={cn(
                receiptData.mode === 'offline_queued'
                  ? 'border-amber-200 bg-amber-50 text-amber-950 [&>svg]:text-amber-600'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900 [&>svg]:text-emerald-600'
              )}
            >
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                {receiptData.mode === 'offline_queued'
                  ? 'You were offline. When you sync, official order, invoice, and receipt numbers will be generated.'
                  : 'Payment recorded. You can print or download the invoice for the customer.'}
              </AlertDescription>
            </Alert>

            <div className="rounded-xl border bg-muted/30 p-4 text-sm">
              <p className="text-lg font-bold tabular-nums">{formatRupee(receiptData.totalAmount)}</p>
              {receiptData.gstSummary ? (
                <p className="mt-2 text-muted-foreground">
                  Taxable: {formatRupee(receiptData.gstSummary.subtotalAmount)} ·
                  {receiptData.gstSummary.taxType === 'IGST'
                    ? ` IGST: ${formatRupee(receiptData.gstSummary.taxAmount)}`
                    : ` CGST+SGST: ${formatRupee(receiptData.gstSummary.taxAmount)}`}
                </p>
              ) : null}
              {receiptData.mode !== 'offline_queued' ? (
                <p className="mt-2 text-muted-foreground">
                  Order: <strong className="text-foreground">{receiptData.orderNumber}</strong>
                  {receiptData.invoiceNumber ? (
                    <>
                      {' '}
                      · Invoice: <strong className="text-foreground">{receiptData.invoiceNumber}</strong>
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="mt-2 text-muted-foreground">
                  Queued ID: <strong className="text-foreground">{receiptData.queuedId}</strong>
                </p>
              )}
            </div>

            {receiptData.mode !== 'offline_queued' && receiptData.invoicePdfUrl ? (
              <Button variant="outline" className="w-full gap-2" asChild>
                <a href={receiptData.invoicePdfUrl} target="_blank" rel="noopener noreferrer">
                  <FileText className="h-4 w-4" />
                  Download invoice (PDF)
                </a>
              </Button>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowReceiptModal(false); setReceiptData(null); }}>
                Close
              </Button>
              <Button onClick={printReceipt}>Print receipt</Button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
    </div>
  );
};

export default SupplierPOS;
