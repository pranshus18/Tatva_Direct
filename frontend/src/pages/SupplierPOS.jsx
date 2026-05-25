import React, { useState, useEffect, useRef } from 'react';
import { getApiUrl } from '../config/api';
import { Barcode, ShoppingCart, MapPin, Trash2, CheckCircle, AlertCircle, Clock, Plus, X, FileText } from 'lucide-react';
import './Dashboard.css';
import {
  cacheBarcodeLookup,
  clearSyncedPosOrders,
  enqueuePosOrder,
  getCachedBarcodeLookup,
  getPendingPosOrders,
  loadPosQueue,
  markPosOrderSynced
} from '../utils/offlinePosStorage';

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

  const barcodeInputRef = useRef(null);

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

  const handleCheckout = async ({ paymentOverride } = {}) => {
    setError('');
    setSuccessMessage('');

    if (!selectedLocationId) {
      setError('Please select an outlet/location before checkout');
      return;
    }
    if (cartItems.length === 0) {
      setError('No items scanned yet');
      return;
    }

    try {
      setCheckingOut(true);
      const token = localStorage.getItem('token');
      const clientOrderId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
      const paymentPayload = paymentOverride || { method: 'cash', status: 'paid' };
      const payload = {
        outletId: selectedLocationId,
        clientOrderId,
        customerName: customerName || null,
        customerPhone: customerPhone || null,
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
        customerName: customerName || '',
        customerPhone: customerPhone || '',
        payment: paymentPayload,
        amountReceived: amountReceived ? Number(amountReceived) : null,
        gstSummary: data.gstSummary || null
      });
      setShowReceiptModal(true);
      setShowPaymentModal(false);
      setSuccessMessage(`Payment done. Receipt ready for Order ${data.orderNumber}.`);
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
        const paymentPayload = paymentOverride || { method: 'cash', status: 'paid' };
        const queued = enqueuePosOrder({
          outletId: selectedLocationId,
          clientOrderId,
          customerName: customerName || null,
          customerPhone: customerPhone || null,
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
          customerName: customerName || '',
          customerPhone: customerPhone || '',
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
    setError('');
    if (!selectedLocationId) {
      setError('Please select an outlet/location before payment');
      return;
    }
    if (cartItems.length === 0) {
      setError('Scan at least one item before payment');
      return;
    }
    setPaymentReference('');
    setPaymentMethod('cash');
    // Auto-fill amount received with total for cash payments
    setAmountReceived(totalAmount.toFixed(2));
    setShowPaymentModal(true);
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
          Date: ${new Date(receiptData.createdAt || Date.now()).toLocaleString()}<br/>
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

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          <h1>Offline Product Sell</h1>
          <p>Scan barcodes and record sales with live inventory updates</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', gap: '2rem' }}>
        {/* Main Content */}
        <div>
          {/* Outlet Selection */}
          <div className="dashboard-section" style={{ marginBottom: '2rem' }}>
            <div className="section-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0 }}>
                <MapPin size={24} color="#4f46e5" />
                Select Outlet / Location
            </h2>
            </div>
            <div className="form-group">
              <label>Outlet / Location</label>
              <div className="input-wrapper">
                <select
                  value={selectedLocationId}
                  onChange={(e) => setSelectedLocationId(e.target.value)}
                  className="select-input"
                  style={{ width: '100%', padding: '0.75rem 1rem' }}
                >
                  {locations.length === 0 && (
                    <option value="">No locations found – add outlets/branches in your profile</option>
                  )}
                  {locations.map(loc => (
                    <option key={loc.id} value={loc.id}>
                      {loc.fullText || loc.displayText || loc.name}
                      {loc.type === 'branch' ? ' (Branch)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              {locations.length === 0 && (
                <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fbbf24' }}>
                  <p style={{ margin: '0 0 0.5rem 0', color: '#92400e', fontSize: '0.875rem', fontWeight: 600 }}>
                    No locations configured
                  </p>
                  <p style={{ margin: 0, color: '#92400e', fontSize: '0.875rem' }}>
                    Add outlets or branch locations in your <a href="/profile" target="_blank" style={{ color: '#0369a1', textDecoration: 'underline', fontWeight: 600 }}>profile</a> to start selling.
                  </p>
                </div>
              )}
              {locations.length > 0 && (
                <div style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: '#64748b' }}>
                  <span>
                    {locations.filter(loc => loc.type === 'outlet').length} outlet(s), {locations.filter(loc => loc.type === 'branch').length} branch(es)
                  </span>
                  <a href="/profile" target="_blank" style={{ color: '#4f46e5', textDecoration: 'underline', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <Plus size={14} />
                    Manage Locations
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Barcode Scanner */}
          <div className="dashboard-section">
            <div className="section-header">
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0 }}>
                <Barcode size={24} color="#4f46e5" />
                Locate the product
              </h2>
            </div>

            {/* Customer Information */}
            <div style={{ 
              background: '#f8fafc', 
              padding: '1.5rem', 
              borderRadius: '12px', 
              marginBottom: '1.5rem',
              border: '1px solid #e2e8f0'
            }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#475569', marginBottom: '1rem', marginTop: 0 }}>
                Customer Information (Optional)
              </h3>
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Customer Name</label>
                  <div className="input-wrapper">
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Walk-in customer"
                    />
                  </div>
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>Phone Number</label>
                  <div className="input-wrapper">
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="For receipt / contact"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '1.25rem' }}>
              <label>Lookup by</label>
              <div className="input-wrapper">
                <select
                  value={scanMode}
                  onChange={(e) => {
                    setScanMode(e.target.value);
                    setTimeout(() => barcodeInputRef.current?.focus(), 0);
                  }}
                  className="select-input"
                  style={{ width: '100%', maxWidth: '360px', padding: '0.75rem 1rem', fontSize: '1rem' }}
                >
                  <option value="gsku">GSKU</option>
                </select>
              </div>
            </div>

            {/* Barcode Input */}
            <form onSubmit={handleScan}>
              <div className="form-row" style={{ alignItems: 'flex-end' }}>
              <div className="form-group" style={{ flex: 2 }}>
                <label>Barcode / GSKU</label>
                <div className="input-wrapper">
                  <input
                    type="text"
                    ref={barcodeInputRef}
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onKeyPress={(e) => {
                      // Auto-submit on Enter key (barcode scanners often send Enter)
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleScan(e);
                      }
                    }}
                    placeholder="Scan or type barcode / GSKU, then press Enter"
                    autoFocus
                    style={{ fontSize: '1rem', padding: '0.875rem 1rem' }}
                  />
                </div>
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Quantity</label>
                <div className="input-wrapper">
                  <input
                    type="number"
                    min="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                      style={{ fontSize: '1rem', padding: '0.875rem 1rem' }}
                  />
                </div>
              </div>
                <div className="form-group">
                <button
                  type="submit"
                  className="btn-primary"
                    disabled={loadingProduct || !barcode.trim()}
                    style={{ padding: '0.875rem 2rem', whiteSpace: 'nowrap' }}
                >
                    {loadingProduct ? 'Searching...' : 'Scan'}
                </button>
                </div>
              </div>
            </form>

            <p style={{ marginTop: '1rem', marginBottom: 0, color: '#64748b', fontSize: '0.875rem' }}>
              Tip: GSKU mode matches your catalog GTIN/barcode or internal GSKU from product setup. Scanning the same code again increases quantity on the bill.
            </p>

            {/* Error Display */}
            {error && (
              <div style={{ 
                marginTop: '1.5rem', 
                padding: '1rem', 
                background: '#fef2f2', 
                border: '1px solid #fecaca',
                borderRadius: '8px',
                color: '#991b1b',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                <AlertCircle size={20} />
                <span><strong>Error:</strong> {error}</span>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Offline Queue */}
          <div className="dashboard-section">
            <div className="section-header" style={{ marginBottom: '1rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0, fontSize: '1.25rem' }}>
                <Clock size={20} color="#4f46e5" />
                Offline Queue
              </h2>
            </div>
            <div style={{ 
              padding: '0.875rem', 
              background: pendingQueueCount > 0 ? '#fef3c7' : '#f0fdf4',
              borderRadius: '8px',
              marginBottom: '1rem',
              border: `1px solid ${pendingQueueCount > 0 ? '#fde68a' : '#bbf7d0'}`
            }}>
              <p style={{ margin: 0, fontSize: '0.875rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>Pending sync:</span>
                <strong style={{ fontSize: '1.125rem', color: '#1e293b' }}>{pendingQueueCount}</strong>
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                className="btn-secondary"
                onClick={() => syncPendingOrders().catch((err) => setError(err.message || 'Sync failed'))}
                disabled={syncingQueue || pendingQueueCount === 0 || !navigator.onLine}
                style={{ flex: 1 }}
              >
                {syncingQueue ? 'Syncing...' : 'Sync Now'}
              </button>
              <button
                className="btn-secondary"
                onClick={() => { clearSyncedPosOrders(); setPendingQueueCount(getPendingPosOrders().length); }}
                disabled={syncingQueue}
              >
                Clear
              </button>
            </div>
            {!navigator.onLine && (
              <p style={{ marginTop: '0.75rem', color: '#d97706', fontSize: '0.875rem', marginBottom: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertCircle size={16} />
                You are offline. New sales will be queued.
              </p>
            )}
          </div>

          {/* Shopping Cart */}
          <div className="dashboard-section" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: '400px' }}>
            <div className="section-header" style={{ marginBottom: '1rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0, fontSize: '1.25rem' }}>
                <ShoppingCart size={20} color="#4f46e5" />
                Current Bill
            </h2>
            </div>
            {cartItems.length === 0 ? (
              <div className="empty-state" style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <ShoppingCart size={64} color="#cbd5e1" style={{ marginBottom: '1rem', opacity: 0.5 }} />
                <h3>No items in cart</h3>
                <p>Scan a barcode to add items</p>
              </div>
            ) : (
              <>
                <div style={{ flex: 1, overflowY: 'auto', marginBottom: '1rem' }}>
                  <div className="items-list">
                  {cartItems.map((item, idx) => (
                      <div key={idx} className="item-card">
                        <div className="item-info" style={{ flex: 1 }}>
                          <h4 style={{ marginBottom: '0.25rem' }}>{item.name}</h4>
                          <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>
                          {item.quantity} × ₹{Number(item.unit_price || 0).toFixed(2)}
                          </p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <strong style={{ fontSize: '1.125rem', color: '#1e293b', minWidth: '80px', textAlign: 'right' }}>
                            ₹{Number(item.total_price || 0).toFixed(2)}
                          </strong>
                        <button
                          className="btn-icon"
                          onClick={() => handleRemoveItem(idx)}
                          title="Remove item"
                        >
                            <Trash2 size={18} />
                        </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ 
                  paddingTop: '1rem', 
                  borderTop: '2px solid #e5e7eb'
                }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center',
                    marginBottom: '1rem'
                  }}>
                    <span style={{ fontSize: '1.125rem', fontWeight: 600, color: '#1e293b' }}>Total</span>
                    <span style={{ fontSize: '1.75rem', fontWeight: 700, color: '#4f46e5' }}>
                      ₹{Number(totalAmount || 0).toFixed(2)}
                    </span>
                  </div>
                  <button
                    className="btn-primary"
                    onClick={openPaymentModal}
                    disabled={checkingOut || cartItems.length === 0 || !selectedLocationId}
                    style={{ width: '100%', padding: '1rem', fontSize: '1rem' }}
                  >
                    {checkingOut ? 'Processing...' : 'Pay & Complete'}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Success Message */}
          {successMessage && (
            <div style={{ 
              padding: '1rem', 
              background: '#f0fdf4', 
              border: '1px solid #86efac',
              borderRadius: '8px',
              color: '#166534',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <CheckCircle size={20} />
              <span><strong>Success:</strong> {successMessage}</span>
            </div>
          )}

          {/* Payment Modal */}
          {showPaymentModal && (
            <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                <div className="modal-header">
                  <h2>Complete Payment</h2>
                  <button className="btn-icon" onClick={() => setShowPaymentModal(false)} title="Close">
                    <X size={18} />
                  </button>
                </div>
                <div className="modal-body">
                  {/* Total Amount Display */}
                  <div style={{ 
                    marginBottom: '2rem', 
                    padding: '1.5rem', 
                    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                    borderRadius: '16px',
                    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'rgba(255, 255, 255, 0.9)', fontWeight: 600, fontSize: '0.95rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Total Amount
                      </span>
                      <span style={{ fontSize: '2rem', fontWeight: 800, color: '#ffffff' }}>
                        ₹{Number(totalAmount || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Payment Method */}
                  <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                    <label style={{ 
                      fontSize: '0.875rem', 
                      fontWeight: 600, 
                      color: '#475569', 
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.75rem',
                      display: 'block'
                    }}>
                      Payment Method
                    </label>
                    <div className="input-wrapper">
                      <select 
                        value={paymentMethod} 
                        onChange={(e) => {
                          setPaymentMethod(e.target.value);
                          // Auto-fill amount received for cash payments
                          if (e.target.value === 'cash' && !amountReceived) {
                            setAmountReceived(totalAmount.toFixed(2));
                          }
                        }}
                        style={{
                          width: '100%',
                          padding: '0.875rem 1rem',
                          fontSize: '1rem',
                          border: '2px solid #e2e8f0',
                          borderRadius: '8px',
                          backgroundColor: '#ffffff',
                          color: '#1e293b',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onFocus={(e) => e.target.style.borderColor = '#4f46e5'}
                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card (Debit/Credit)</option>
                        <option value="upi">UPI</option>
                        <option value="bank_transfer">Bank Transfer (NEFT/RTGS/IMPS)</option>
                        <option value="cheque">Cheque</option>
                        <option value="credit">Credit (Pay Later)</option>
                        <option value="credit_note">Credit Note</option>
                      </select>
                    </div>
                  </div>

                  {/* Payment Reference */}
                  <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                    <label style={{ 
                      fontSize: '0.875rem', 
                      fontWeight: 600, 
                      color: '#475569', 
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.75rem',
                      display: 'block'
                    }}>
                      Payment Reference <span style={{ color: '#94a3b8', fontWeight: 400, textTransform: 'none' }}>(Optional)</span>
                    </label>
                    <div className="input-wrapper">
                      <input
                        type="text"
                        value={paymentReference}
                        onChange={(e) => setPaymentReference(e.target.value)}
                        placeholder="UPI ID / Transaction ID / Note"
                        style={{
                          width: '100%',
                          padding: '0.875rem 1rem',
                          fontSize: '1rem',
                          border: '2px solid #e2e8f0',
                          borderRadius: '8px',
                          transition: 'all 0.2s'
                        }}
                        onFocus={(e) => e.target.style.borderColor = '#4f46e5'}
                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                      />
                    </div>
                  </div>

                  {/* Amount Received */}
                  <div className="form-group" style={{ marginBottom: '2rem' }}>
                    <label style={{ 
                      fontSize: '0.875rem', 
                      fontWeight: 600, 
                      color: '#475569', 
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.75rem',
                      display: 'block'
                    }}>
                      Amount Received <span style={{ color: '#94a3b8', fontWeight: 400, textTransform: 'none' }}>(Optional)</span>
                    </label>
                    <div className="input-wrapper">
                      <input
                        type="number"
                        value={amountReceived}
                        onChange={(e) => setAmountReceived(e.target.value)}
                        placeholder="Enter amount received"
                        min="0"
                        step="0.01"
                        style={{
                          width: '100%',
                          padding: '0.875rem 1rem',
                          fontSize: '1rem',
                          border: '2px solid #e2e8f0',
                          borderRadius: '8px',
                          transition: 'all 0.2s'
                        }}
                        onFocus={(e) => e.target.style.borderColor = '#4f46e5'}
                        onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
                      />
                    </div>
                    {amountReceived && parseFloat(amountReceived) > 0 && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: '#64748b' }}>
                        {parseFloat(amountReceived) >= totalAmount ? (
                          <span style={{ color: '#10b981', fontWeight: 600 }}>
                            ✓ Change: ₹{(parseFloat(amountReceived) - totalAmount).toFixed(2)}
                          </span>
                        ) : (
                          <span style={{ color: '#ef4444', fontWeight: 600 }}>
                            ⚠ Short by: ₹{(totalAmount - parseFloat(amountReceived)).toFixed(2)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  <div className="modal-actions" style={{ display: 'flex', gap: '1rem', marginTop: '2rem' }}>
                    <button 
                      className="btn-secondary" 
                      onClick={() => setShowPaymentModal(false)}
                      style={{ flex: 1, padding: '0.875rem 1.5rem' }}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn-primary"
                      onClick={() => handleCheckout({
                        paymentOverride: {
                          method: paymentMethod,
                          status: 'paid',
                          reference: paymentReference || null,
                          amount_received: amountReceived ? parseFloat(amountReceived) : null
                        }
                      })}
                      disabled={checkingOut}
                      style={{ flex: 2, padding: '0.875rem 1.5rem', fontSize: '1rem', fontWeight: 600 }}
                    >
                      {checkingOut ? 'Processing...' : 'Pay & Complete'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Receipt Modal */}
          {showReceiptModal && receiptData && (
            <div className="modal-overlay" onClick={() => setShowReceiptModal(false)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                  <h2>Receipt</h2>
                  <button className="btn-icon" onClick={() => setShowReceiptModal(false)} title="Close">
                    <X size={18} />
                  </button>
                </div>
                <div className="modal-body">
                  <div style={{ marginBottom: '1rem' }}>
                    {receiptData.mode === 'offline_queued' ? (
                      <div style={{ padding: '0.75rem', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: '12px', color: '#92400e' }}>
                        You were offline. This receipt is temporary. When you sync, the system will generate official Order/Invoice/Receipt numbers.
                      </div>
                    ) : (
                      <div style={{ padding: '0.75rem', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: '12px', color: '#166534' }}>
                        Payment successful. You can print the receipt now.
                      </div>
                    )}
                  </div>

                  <div style={{ padding: '1rem', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e5e7eb' }}>
                    <p style={{ margin: 0, color: '#475569', fontWeight: 700 }}>Total: ₹{Number(receiptData.totalAmount || 0).toFixed(2)}</p>
                    {receiptData.gstSummary && (
                      <p style={{ margin: '0.5rem 0 0', color: '#64748b' }}>
                        Taxable: ₹{Number(receiptData.gstSummary.subtotalAmount || 0).toFixed(2)} ·
                        {receiptData.gstSummary.taxType === 'IGST'
                          ? ` IGST: ₹${Number(receiptData.gstSummary.taxAmount || 0).toFixed(2)}`
                          : ` CGST+SGST: ₹${Number(receiptData.gstSummary.taxAmount || 0).toFixed(2)}`}
                      </p>
                    )}
                    {receiptData.mode !== 'offline_queued' && (
                      <p style={{ margin: '0.5rem 0 0', color: '#64748b' }}>
                        Order: <strong>{receiptData.orderNumber}</strong>
                        {receiptData.invoiceNumber ? <> · Invoice: <strong>{receiptData.invoiceNumber}</strong></> : null}
                        {receiptData.receiptNumber ? <> · Receipt: <strong>{receiptData.receiptNumber}</strong></> : null}
                      </p>
                    )}
                    {receiptData.mode === 'offline_queued' && (
                      <p style={{ margin: '0.5rem 0 0', color: '#64748b' }}>
                        Queued ID: <strong>{receiptData.queuedId}</strong>
                      </p>
                    )}
                  </div>

                  {receiptData.mode !== 'offline_queued' && receiptData.invoicePdfUrl && (
                    <div style={{ marginTop: '1rem' }}>
                      <a
                        href={receiptData.invoicePdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-primary"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', textDecoration: 'none' }}
                      >
                        <FileText size={18} />
                        Download invoice (PDF) for customer
                      </a>
                      <p style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem', color: '#64748b' }}>
                        Full line items, variants, and IDs — give this to the person who placed the order.
                      </p>
                    </div>
                  )}

                  <div className="modal-actions" style={{ marginTop: '1rem' }}>
                    <button className="btn-secondary" onClick={() => { setShowReceiptModal(false); setReceiptData(null); }}>
                      Close
                    </button>
                    <button className="btn-primary" onClick={printReceipt}>
                      Print
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Recent Sales */}
          <div className="dashboard-section">
            <div className="section-header" style={{ marginBottom: '1rem' }}>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', margin: 0, fontSize: '1.25rem' }}>
                <ShoppingCart size={20} color="#4f46e5" />
                Recent Sales
            </h2>
            </div>
            {lastOrders.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                <p style={{ margin: 0, color: '#94a3b8' }}>No recent orders</p>
              </div>
            ) : (
              <div className="items-list">
                {lastOrders.map(o => (
                  <div key={o.id} className="item-card">
                    <div className="item-info">
                      <h4 style={{ marginBottom: '0.25rem' }}>{o.order_number || o.id}</h4>
                      <p style={{ fontSize: '0.875rem', color: '#64748b', margin: 0 }}>
                        {o.created_at && new Date(o.created_at).toLocaleString()}
                      </p>
                      {o.invoicePdfUrl && (
                        <a
                          href={o.invoicePdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: '0.8125rem', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.35rem', color: '#4f46e5' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <FileText size={14} /> Invoice PDF
                        </a>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, color: '#059669', fontSize: '1.125rem' }}>
                      ₹{Number(o.total_amount || 0).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SupplierPOS;
