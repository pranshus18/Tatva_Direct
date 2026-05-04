import React, { useState, useEffect, useMemo } from 'react';
import { Check, X } from 'lucide-react';
import QRCode from 'qrcode';
import { getApiUrl } from '../config/api';
import ProductImageCarousel from '../components/ProductImageCarousel';
import './CreatePO.css';

/** UPI intent for platform collection QR. Set `VITE_PLATFORM_UPI_VPA` in `.env` for testing; swap to live platform ID when ready. */
function buildTestPlatformPaymentPayload(grandTotal) {
  const vpa = String(import.meta.env.VITE_PLATFORM_UPI_VPA || 'pranshu.platform@upi').trim().toLowerCase();
  const payeeName = String(
    import.meta.env.VITE_PLATFORM_UPI_PAYEE_NAME || 'Tatva Direct'
  ).trim();
  const amt = Math.max(0, Number(grandTotal) || 0).toFixed(2);
  return `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payeeName || 'Merchant')}&am=${amt}&cu=INR&tn=${encodeURIComponent('B2B PO platform payment (TEST)')}`;
}

const blankAddress = {
  line1: '',
  city: '',
  state: '',
  pincode: '',
  country: ''
};

const normalizeAddress = (address = {}) => ({
  line1: String(address?.line1 || address?.street || '').trim(),
  city: String(address?.city || '').trim(),
  state: String(address?.state || '').trim(),
  pincode: String(address?.pincode || address?.zipCode || '').trim(),
  country: String(address?.country || '').trim()
});

const addressPreview = (address = {}) =>
  [address.line1, address.city, address.state, address.pincode, address.country]
    .filter(Boolean)
    .join(', ');

const CreatePO = ({ selectedVendors, substitutions, boqId, items }) => {
  const [poGroups, setPoGroups] = useState([]);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [requiredDate, setRequiredDate] = useState('');
  const [creatingOrders, setCreatingOrders] = useState(false);
  /** How the buyer will pay for these POs (stored on each order; drives post-checkout flow). */
  const [poPaymentMethod, setPoPaymentMethod] = useState('online');
  /** Online flow: show platform test QR before calling create API. */
  const [showOnlineQrModal, setShowOnlineQrModal] = useState(false);
  const [platformQrDataUrl, setPlatformQrDataUrl] = useState('');
  const [serviceProviderGstin, setServiceProviderGstin] = useState('');
  const [shippingAddress, setShippingAddress] = useState(blankAddress);
  const [billingAddress, setBillingAddress] = useState(blankAddress);
  const [billingAddressBook, setBillingAddressBook] = useState([]);
  const [selectedBillingAddressId, setSelectedBillingAddressId] = useState('');
  const [deliveryDestination, setDeliveryDestination] = useState('shipping');

  const grandTotalAllPos = useMemo(
    () => poGroups.reduce((sum, g) => sum + (Number(g.total) || 0), 0),
    [poGroups]
  );

  useEffect(() => {
    // Validate that we have the required data
    if (!items || items.length === 0) {
      setError('No items found. Please go back and upload a BOQ file.');
      setLoading(false);
      return;
    }

    if (!selectedVendors || Object.keys(selectedVendors).length === 0) {
      setError('No suppliers selected. Please go back and select suppliers for your items.');
      setLoading(false);
      return;
    }

    // Group by vendor
    groupByVendor();
  }, [selectedVendors, substitutions, items]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    let cancelled = false;
    const loadProfile = async () => {
      try {
        const response = await fetch(getApiUrl('/api/profile'), {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        if (!response.ok) return;
        const data = await response.json();
        if (!data?.profile || cancelled) return;
        const profileAddress = normalizeAddress(data.profile.address || {});
        const billingAddresses = Array.isArray(data.profile.billingAddresses)
          ? data.profile.billingAddresses
              .map((entry) => ({
                id: String(entry?.id || ''),
                label: String(entry?.label || '').trim(),
                address: normalizeAddress(entry || {})
              }))
              .filter((entry) => entry.id)
          : [];
        const gstin = String(data.profile.gstin || data.profile.mainGstin || '').trim();
        setServiceProviderGstin(gstin);
        setShippingAddress(profileAddress);
        if (billingAddresses.length > 0) {
          setBillingAddressBook(billingAddresses);
          setSelectedBillingAddressId(billingAddresses[0].id);
          setBillingAddress(billingAddresses[0].address);
        } else {
          setBillingAddress(profileAddress);
        }
        setDeliveryDestination(gstin ? 'shipping' : 'shipping');
      } catch (profileError) {
        console.warn('Failed to preload service provider profile for PO addresses:', profileError);
      }
    };
    loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasGstin = Boolean(serviceProviderGstin);

  useEffect(() => {
    if (!hasGstin) {
      setDeliveryDestination('shipping');
      setBillingAddress(shippingAddress);
    }
  }, [hasGstin, shippingAddress]);

  const handleSelectBillingAddress = (id) => {
    setSelectedBillingAddressId(id);
    if (!id) return;
    const selected = billingAddressBook.find((entry) => entry.id === id);
    if (selected) {
      setBillingAddress(selected.address);
    }
  };

  const groupByVendor = async () => {
    setLoading(true);
    setError(null);
    
    // Get auth token
    const token = localStorage.getItem('token');
    
    try {
      console.log('Grouping POs with data:', {
        selectedVendors,
        itemsCount: items?.length,
        substitutionsCount: substitutions?.length
      });

      const res = await fetch(getApiUrl('/api/po/group'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ selectedVendors, substitutions, items })
      });
      
      // Check if response is ok
      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = 'Failed to group purchase orders';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (e) {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      // Check if response has content
      const text = await res.text();
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from server');
      }
      
      const data = JSON.parse(text);
      console.log('PO groups response:', data);
      
      if (data.groups && Array.isArray(data.groups) && data.groups.length > 0) {
        setPoGroups(data.groups);
        setError(null);
      } else {
        const errorMsg = data.message || 'No purchase order groups were created. Please ensure all items have selected suppliers and matching products.';
        console.error('No groups returned:', data);
        setError(errorMsg);
        setPoGroups([]);
      }
    } catch (error) {
      console.error('Failed to group POs:', error);
      setError(error.message || 'Failed to group purchase orders. Please try again.');
      setPoGroups([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!showOnlineQrModal) {
      setPlatformQrDataUrl('');
      return;
    }
    const payload = buildTestPlatformPaymentPayload(grandTotalAllPos);
    let cancelled = false;
    QRCode.toDataURL(payload, {
      width: 260,
      margin: 2,
      color: { dark: '#0f172a', light: '#ffffff' }
    })
      .then((url) => {
        if (!cancelled) setPlatformQrDataUrl(url);
      })
      .catch((e) => {
        console.error('QR generation failed:', e);
      });
    return () => {
      cancelled = true;
    };
  }, [showOnlineQrModal, grandTotalAllPos]);

  const submitPurchaseOrders = async () => {
    const token = localStorage.getItem('token');

    try {
      setCreatingOrders(true);
      console.log('Creating POs with groups:', poGroups, 'Required date:', requiredDate);

      const res = await fetch(getApiUrl('/api/po/create'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          poGroups,
          boqId,
          requiredDate,
          paymentMethod: poPaymentMethod,
          deliveryDestination,
          shippingAddress,
          billingAddress: hasGstin ? billingAddress : shippingAddress,
          gstin: serviceProviderGstin || null
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = 'Failed to create purchase orders';
        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (e) {
          errorMessage = errorText || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const text = await res.text();
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from server');
      }

      const data = JSON.parse(text);

      if (data.success) {
        setConfirmed(true);
        setTimeout(() => {
          window.location.href = '/your-orders';
        }, 2000);
      } else {
        alert(data.message || 'Failed to create purchase orders');
      }
    } catch (err) {
      console.error('Failed to create POs:', err);
      alert(err.message || 'Failed to create purchase orders. Please try again.');
    } finally {
      setCreatingOrders(false);
    }
  };

  const handleConfirm = async () => {
    if (creatingOrders) return;

    if (!poGroups || poGroups.length === 0) {
      alert('No purchase order groups available. Please ensure all items have selected suppliers.');
      await groupByVendor();
      return;
    }

    if (!requiredDate) {
      const proceed = window.confirm(
        'You have not specified a "Required by" date.\n\nDo you want to continue without a required date?'
      );
      if (!proceed) {
        return;
      }
    }

    const missingShipping = ['line1', 'city', 'state', 'pincode', 'country'].find(
      (key) => !String(shippingAddress?.[key] || '').trim()
    );
    if (missingShipping) {
      alert('Please complete the shipping address before creating purchase orders.');
      return;
    }

    if (hasGstin) {
      const missingBilling = ['line1', 'city', 'state', 'pincode', 'country'].find(
        (key) => !String(billingAddress?.[key] || '').trim()
      );
      if (missingBilling) {
        alert('GSTIN detected. Please complete the billing (GST) address.');
        return;
      }
    }

    if (poPaymentMethod === 'online') {
      setShowOnlineQrModal(true);
      return;
    }

    await submitPurchaseOrders();
  };

  const handlePlaceOrderAfterPlatformQr = async () => {
    setShowOnlineQrModal(false);
    await submitPurchaseOrders();
  };

  if (confirmed) {
    return (
      <div className="page">
        <div className="success-state">
          <Check size={64} className="success-icon" />
          <h2>Purchase Orders Created!</h2>
          <p>All POs have been successfully generated and sent to vendors.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Create Purchase Orders</h1>
          <p>Grouping items by vendor...</p>
        </div>
        <div style={{ textAlign: 'center', padding: '3rem' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
          <p>Please wait while we group your purchase orders...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        <div className="page-header">
          <h1>Create Purchase Orders</h1>
          <p>Error grouping purchase orders</p>
        </div>
        <div style={{ 
          background: '#fee2e2', 
          border: '1px solid #fca5a5', 
          borderRadius: '8px', 
          padding: '1.5rem', 
          margin: '2rem 0',
          color: '#991b1b'
        }}>
          <h3 style={{ marginTop: 0, color: '#991b1b' }}>Error</h3>
          <p>{error}</p>
          <button 
            className="btn-primary" 
            onClick={groupByVendor}
            style={{ marginTop: '1rem' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Create Purchase Orders</h1>
        <p>Review and confirm POs grouped by vendor</p>
      </div>

      <div style={{ 
        marginBottom: '1.5rem', 
        padding: '1rem', 
        borderRadius: '8px', 
        border: '1px solid #e5e7eb',
        background: '#f9fafb',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        alignItems: 'center'
      }}>
        <div style={{ minWidth: '220px' }}>
          <label style={{ 
            display: 'block', 
            fontSize: '0.875rem', 
            fontWeight: 600, 
            color: '#374151',
            marginBottom: '0.25rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Required By Date
          </label>
          <input
            type="date"
            value={requiredDate}
            onChange={(e) => setRequiredDate(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '0.9rem'
            }}
          />
        </div>
        <p style={{ 
          margin: 0, 
          fontSize: '0.8rem', 
          color: '#6b7280',
          maxWidth: '420px'
        }}>
          This is the date by which you need all materials delivered. It will be stored on the purchase orders and shown to suppliers as the expected delivery date.
        </p>
        <div style={{ width: '100%', flexBasis: '100%', marginTop: '0.5rem' }}>
          <label style={{ 
            display: 'block', 
            fontSize: '0.875rem', 
            fontWeight: 600, 
            color: '#374151',
            marginBottom: '0.35rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em'
          }}>
            Payment method
          </label>
          <select
            value={poPaymentMethod}
            onChange={(e) => setPoPaymentMethod(e.target.value)}
            style={{
              maxWidth: '320px',
              width: '100%',
              padding: '0.5rem 0.75rem',
              borderRadius: '6px',
              border: '1px solid #d1d5db',
              fontSize: '0.9rem',
              background: '#fff'
            }}
          >
            <option value="online">Pay online (UPI / card via Razorpay)</option>
            <option value="cod">Cash on delivery</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="credit">Credit / pay later (on account)</option>
          </select>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.78rem', color: '#6b7280', maxWidth: '520px' }}>
            This applies to every purchase order created in this step. Pay online: you will see a platform test QR before orders are placed. COD and credit stay pending until the supplier confirms payment or delivery.
          </p>
        </div>
        <div className="checkout-address-card">
          <div className="checkout-address-card__head">
            <h3>Shipping Address</h3>
            <p>Where your suppliers should deliver the material.</p>
          </div>
          <div className="checkout-address-grid">
            <div className="checkout-address-field checkout-address-field--wide">
              <label>Street Address</label>
              <input
                className="checkout-address-input"
                value={shippingAddress.line1}
                onChange={(e) => setShippingAddress((prev) => ({ ...prev, line1: e.target.value }))}
                placeholder="Flat / Building / Street"
              />
            </div>
            <div className="checkout-address-field">
              <label>City</label>
              <input
                className="checkout-address-input"
                value={shippingAddress.city}
                onChange={(e) => setShippingAddress((prev) => ({ ...prev, city: e.target.value }))}
                placeholder="City"
              />
            </div>
            <div className="checkout-address-field">
              <label>State</label>
              <input
                className="checkout-address-input"
                value={shippingAddress.state}
                onChange={(e) => setShippingAddress((prev) => ({ ...prev, state: e.target.value }))}
                placeholder="State"
              />
            </div>
            <div className="checkout-address-field">
              <label>PIN Code</label>
              <input
                className="checkout-address-input"
                value={shippingAddress.pincode}
                onChange={(e) => setShippingAddress((prev) => ({ ...prev, pincode: e.target.value }))}
                placeholder="PIN code"
              />
            </div>
            <div className="checkout-address-field">
              <label>Country</label>
              <input
                className="checkout-address-input"
                value={shippingAddress.country}
                onChange={(e) => setShippingAddress((prev) => ({ ...prev, country: e.target.value }))}
                placeholder="Country"
              />
            </div>
          </div>
        </div>
        <div className="checkout-address-card checkout-address-card--billing">
          <div className="checkout-address-card__head">
            <h3>Billing & Delivery Preference</h3>
          </div>
          {!hasGstin ? (
            <p className="checkout-address-note">
              No GSTIN found in your profile. Billing address will default to shipping address and delivery will go to shipping address.
            </p>
          ) : (
            <>
              <p className="checkout-address-note">
                GSTIN: <strong>{serviceProviderGstin}</strong>. Billing address is treated as the GST registered address (used for GST tax). You can choose where material should be delivered.
              </p>
              {billingAddressBook.length > 0 ? (
                <div className="checkout-address-field checkout-address-field--wide" style={{ marginBottom: '0.75rem' }}>
                  <label>Choose saved billing address</label>
                  <select
                    className="checkout-address-input"
                    value={selectedBillingAddressId}
                    onChange={(e) => handleSelectBillingAddress(e.target.value)}
                  >
                    {billingAddressBook.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label || addressPreview(entry.address) || 'Saved billing address'}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="checkout-address-grid checkout-address-grid--billing">
                <div className="checkout-address-field checkout-address-field--wide">
                  <label>Billing Street Address</label>
                  <input
                    className="checkout-address-input"
                    value={billingAddress.line1}
                    onChange={(e) => setBillingAddress((prev) => ({ ...prev, line1: e.target.value }))}
                    placeholder="GST billing address line"
                  />
                </div>
                <div className="checkout-address-field">
                  <label>Billing City</label>
                  <input
                    className="checkout-address-input"
                    value={billingAddress.city}
                    onChange={(e) => setBillingAddress((prev) => ({ ...prev, city: e.target.value }))}
                    placeholder="Billing city"
                  />
                </div>
                <div className="checkout-address-field">
                  <label>Billing State</label>
                  <input
                    className="checkout-address-input"
                    value={billingAddress.state}
                    onChange={(e) => setBillingAddress((prev) => ({ ...prev, state: e.target.value }))}
                    placeholder="Billing state"
                  />
                </div>
                <div className="checkout-address-field">
                  <label>Billing PIN Code</label>
                  <input
                    className="checkout-address-input"
                    value={billingAddress.pincode}
                    onChange={(e) => setBillingAddress((prev) => ({ ...prev, pincode: e.target.value }))}
                    placeholder="Billing PIN code"
                  />
                </div>
                <div className="checkout-address-field">
                  <label>Billing Country</label>
                  <input
                    className="checkout-address-input"
                    value={billingAddress.country}
                    onChange={(e) => setBillingAddress((prev) => ({ ...prev, country: e.target.value }))}
                    placeholder="Billing country"
                  />
                </div>
              </div>
              <div className="checkout-delivery-choice">
                <label>
                  <input
                    type="radio"
                    name="deliveryDestination"
                    value="shipping"
                    checked={deliveryDestination === 'shipping'}
                    onChange={(e) => setDeliveryDestination(e.target.value)}
                  />
                  Deliver to shipping address
                </label>
                <label>
                  <input
                    type="radio"
                    name="deliveryDestination"
                    value="billing"
                    checked={deliveryDestination === 'billing'}
                    onChange={(e) => setDeliveryDestination(e.target.value)}
                  />
                  Deliver to billing address
                </label>
              </div>
            </>
          )}
          <p className="checkout-address-preview">
            Delivery selected: {deliveryDestination === 'billing' && hasGstin ? addressPreview(billingAddress) || 'Billing address not complete' : addressPreview(shippingAddress) || 'Shipping address not complete'}
          </p>
        </div>
      </div>

      {poGroups.length === 0 ? (
        <div style={{ 
          background: '#fef3c7', 
          border: '1px solid #fcd34d', 
          borderRadius: '8px', 
          padding: '1.5rem', 
          margin: '2rem 0',
          color: '#92400e'
        }}>
          <h3 style={{ marginTop: 0, color: '#92400e' }}>No Purchase Orders to Create</h3>
          <p>No purchase order groups were created. This might happen if:</p>
          <ul style={{ marginLeft: '1.5rem' }}>
            <li>No suppliers were selected for the items</li>
            <li>The selected suppliers don't have matching products in the database</li>
            <li>There was an error processing the items</li>
          </ul>
          <button 
            className="btn-primary" 
            onClick={groupByVendor}
            style={{ marginTop: '1rem' }}
          >
            Retry Grouping
          </button>
        </div>
      ) : (
        <>
          <div className="po-list">
            {poGroups.map((group) => (
              <div key={group.vendorId} className="po-card">
                <div className="po-header">
                  <h3>{group.vendorName}</h3>
                  <div className="po-total">₹{group.total?.toLocaleString() || '0'}</div>
                </div>
                <table className="po-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Quantity</th>
                      <th>Unit Price</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.items?.map((item, idx) => (
                      <tr key={idx}>
                        <td>
                          {(item.productImage || (Array.isArray(item.images) && item.images[0])) && (
                            <div style={{ marginBottom: '0.35rem' }}>
                              <ProductImageCarousel
                                images={[item.productImage, ...(Array.isArray(item.images) ? item.images : [])]}
                                alt={item.name || 'Product'}
                                height={80}
                                rounded={6}
                              />
                            </div>
                          )}
                          <div>{item.name}</div>
                          {item.productIdentification && (
                            <div style={{ fontSize: '0.78rem', color: '#475569', marginTop: '0.2rem' }}>
                              ID: {item.productIdentification}
                            </div>
                          )}
                        </td>
                        <td>{item.quantity} {item.unit || ''}</td>
                        <td>₹{item.price?.toLocaleString() || '0'}</td>
                        <td>₹{((item.quantity || 0) * (item.price || 0)).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>

          <button
            className="btn-primary btn-large"
            onClick={handleConfirm}
            disabled={poGroups.length === 0 || creatingOrders}
          >
            {creatingOrders ? 'Creating Orders...' : 'Confirm & Create All POs'}
          </button>
        </>
      )}

      {showOnlineQrModal && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}
          onClick={() => !creatingOrders && setShowOnlineQrModal(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="platform-qr-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#fff',
              borderRadius: '16px',
              maxWidth: '420px',
              width: '100%',
              padding: '1.5rem',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <h2 id="platform-qr-title" style={{ margin: 0, fontSize: '1.25rem', color: '#0f172a' }}>
                Platform payment (test QR)
              </h2>
              <button
                type="button"
                className="btn-icon"
                onClick={() => !creatingOrders && setShowOnlineQrModal(false)}
                aria-label="Close"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
              >
                <X size={22} color="#64748b" />
              </button>
            </div>
            <div
              style={{
                textAlign: 'center',
                padding: '1rem',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                marginBottom: '1rem'
              }}
            >
              <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>
                Order total (all POs)
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 700, color: '#4f46e5', marginBottom: '1rem' }}>
                ₹{grandTotalAllPos.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              {platformQrDataUrl ? (
                <img src={platformQrDataUrl} alt="Platform payment QR" style={{ width: 260, height: 260, maxWidth: '100%', borderRadius: 8 }} />
              ) : (
                <div style={{ padding: '3rem', color: '#94a3b8' }}>Generating QR…</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button type="button" className="btn-secondary" onClick={() => setShowOnlineQrModal(false)} disabled={creatingOrders}>
                Back
              </button>
              <button type="button" className="btn-primary" onClick={handlePlaceOrderAfterPlatformQr} disabled={creatingOrders} style={{ flex: 1, minWidth: '200px' }}>
                {creatingOrders ? 'Placing order…' : 'Place order'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreatePO;
