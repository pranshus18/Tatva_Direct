import React, { useState, useEffect, useMemo } from 'react';
import { Check, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { API_BASE_URL, getApiUrl, resolveApiPath } from '../config/api';
import ProductImageCarousel from '../components/ProductImageCarousel';
import VoiceGuidedBanner from '../components/VoiceGuidedBanner';
import { fetchVoiceCartDraft, isVoiceGuidedActive } from '../voice/voiceCartBridge';
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
  pincode: String(
    address?.pincode || address?.zipCode || address?.postalCode || address?.postal_code || ''
  ).trim(),
  country: String(address?.country || '').trim()
});

/** Legacy: single shippingProvider. New: byVendorId map (supplier UUID → courier name). */
function isTransportSelectionReady(transport, groups) {
  if (!transport || typeof transport !== 'object') return false;
  if (String(transport.shippingProvider || '').trim()) return true;
  const by = transport.byVendorId;
  if (!by || typeof by !== 'object') return false;
  const ids = (Array.isArray(groups) ? groups : []).map((g) => String(g.vendorId || '')).filter(Boolean);
  if (ids.length === 0) return Object.keys(by).some((k) => String(by[k] || '').trim());
  return ids.every((id) => String(by[id] || '').trim());
}

function formatQuoteMoney(rate) {
  if (rate == null || rate === '') return null;
  const n = Number(String(rate).replace(/,/g, ''));
  if (Number.isFinite(n)) {
    return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return String(rate);
}

const addressPreview = (address = {}) =>
  [address.line1, address.city, address.state, address.pincode, address.country]
    .filter(Boolean)
    .join(', ');
const normalizeSpecifications = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const seen = new Set();
  return Object.entries(value)
    .map(([key, rawValue]) => [String(key || '').trim(), rawValue])
    .filter(([key, rawValue]) => key && rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== '')
    .reduce((acc, [key, rawValue]) => {
      const dedupeKey = key.toLowerCase();
      if (seen.has(dedupeKey)) return acc;
      seen.add(dedupeKey);
      acc.push([key, String(rawValue).trim()]);
      return acc;
    }, []);
};

/** Align workflow line quantities with the persisted PO cart (source of truth after cart edits). */
async function mergeWorkflowItemsWithSavedCart(workflowItems) {
  if (!Array.isArray(workflowItems) || workflowItems.length === 0) return workflowItems;
  const token = localStorage.getItem('token');
  if (!token) return workflowItems;
  try {
    const res = await fetch(getApiUrl('/api/po/cart'), {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success' || !data.cart?.draft) {
      return workflowItems;
    }
    const cartItems = Array.isArray(data.cart.draft.items) ? data.cart.draft.items : [];
    if (cartItems.length === 0) return workflowItems;
    const qtyByLineId = new Map();
    for (const row of cartItems) {
      if (row?.id === undefined || row?.id === null) continue;
      const key = String(row.id).trim();
      if (!key) continue;
      const q = Number(row.quantity);
      if (Number.isFinite(q) && q >= 1) {
        qtyByLineId.set(key, Math.floor(q));
      }
    }
    if (qtyByLineId.size === 0) return workflowItems;
    return workflowItems.map((it) => {
      const id = it?.id !== undefined && it?.id !== null ? String(it.id).trim() : '';
      if (!id || !qtyByLineId.has(id)) return it;
      const q = qtyByLineId.get(id);
      return { ...it, quantity: q };
    });
  } catch {
    return workflowItems;
  }
}

const CreatePO = ({ selectedVendors, substitutions, boqId, items }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const voiceGuided = isVoiceGuidedActive();
  const [voiceCart, setVoiceCart] = useState(null);
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
  const [createdTransportOrders, setCreatedTransportOrders] = useState([]);
  const [selectedTransport, setSelectedTransport] = useState(null);
  const [expandedItemSpecs, setExpandedItemSpecs] = useState({});

  const grandTotalAllPos = useMemo(
    () => poGroups.reduce((sum, g) => sum + (Number(g.total) || 0), 0),
    [poGroups]
  );

  const workflowItems = voiceCart?.items?.length ? voiceCart.items : items;
  const workflowVendors =
    voiceCart?.selectedVendors && Object.keys(voiceCart.selectedVendors).length
      ? voiceCart.selectedVendors
      : selectedVendors;
  const workflowSubs = voiceCart?.substitutions ?? substitutions;

  useEffect(() => {
    if (!voiceGuided) return;
    let cancelled = false;
    fetchVoiceCartDraft().then((draft) => {
      if (!cancelled) setVoiceCart(draft);
    });
    return () => {
      cancelled = true;
    };
  }, [voiceGuided, location.state?.voiceNavSeq]);

  useEffect(() => {
    // Validate that we have the required data
    if (!workflowItems || workflowItems.length === 0) {
      setError('No items found. Please go back and upload a BOQ file.');
      setLoading(false);
      return;
    }

    if (!workflowVendors || Object.keys(workflowVendors).length === 0) {
      setError('No suppliers selected. Please go back and select suppliers for your items.');
      setLoading(false);
      return;
    }

    // Group by vendor
    groupByVendor();
  }, [workflowVendors, workflowSubs, workflowItems]);

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
  const toggleItemSpecs = (groupVendorId, item, idx) => {
    const key = `${groupVendorId || 'vendor'}::${item?.supplierProductId || item?.productId || item?.name || idx}`;
    setExpandedItemSpecs((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  useEffect(() => {
    if (!hasGstin) {
      setDeliveryDestination('shipping');
      setBillingAddress(shippingAddress);
    }
  }, [hasGstin, shippingAddress]);

  useEffect(() => {
    const routeState = location.state || {};
    const incomingOrders = Array.isArray(routeState.createdOrders) ? routeState.createdOrders : [];
    const incomingTransport = routeState.transportSelection && typeof routeState.transportSelection === 'object'
      ? routeState.transportSelection
      : null;
    if (incomingOrders.length > 0) {
      setCreatedTransportOrders(incomingOrders);
    }
    if (incomingTransport) {
      setSelectedTransport(incomingTransport);
    }
    if (incomingOrders.length > 0 || incomingTransport) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

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
      const vendors = workflowVendors;
      const subs = workflowSubs;
      const lineItems = workflowItems;

      const res = await fetch(getApiUrl('/api/po/group'), {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          selectedVendors: vendors,
          substitutions: subs,
          items: await mergeWorkflowItemsWithSavedCart(lineItems)
        })
      });
      
      // Check if response is ok
      if (!res.ok) {
        const errorText = await res.text();
        let errorMessage = 'Failed to group purchase orders';
        try {
          const errorData = JSON.parse(errorText);
          // Backend often puts the real failure on `error` while `message` stays generic for 500s.
          errorMessage = errorData.error || errorData.message || errorMessage;
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

  const createPurchaseOrders = async () => {
    const token = localStorage.getItem('token');

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
        errorMessage = errorData.error || errorData.message || errorMessage;
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
    if (!data.success) {
      throw new Error(data.error || data.message || 'Failed to create purchase orders');
    }
    return data;
  };

  const finalizeTransportDetails = async (ordersToConfirm = createdTransportOrders) => {
    const token = localStorage.getItem('token');
    const orderList = Array.isArray(ordersToConfirm) ? ordersToConfirm : [];
    const orderIds = orderList.map((order) => order?.id).filter(Boolean);
    if (orderIds.length === 0) {
      throw new Error('No transport-stage orders found. Please click Transport suggestion first.');
    }
    const st = selectedTransport;
    const hasPerVendor =
      st?.byVendorId && typeof st.byVendorId === 'object' && Object.keys(st.byVendorId).length > 0;

    const parseQuoteInr = (raw) => {
      if (raw === null || raw === undefined || raw === '') return null;
      const n = Number(String(raw).replace(/,/g, ''));
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
    };

    const isTruckingDetail = (det) => {
      if (!det || typeof det !== 'object') return false;
      const mode = String(det.transportMode || det.transport_mode || '').toLowerCase();
      if (mode === 'trucking') return true;
      if (String(det.source || '').toLowerCase() === 'borzo') return true;
      const vt = det.vehicle_type_id ?? det.vehicleTypeId;
      return vt != null && vt !== '' && Number(vt) > 0;
    };

    const applyTruckingFields = (target, det) => {
      const vtRaw = det?.vehicle_type_id ?? det?.vehicleTypeId;
      const vtn = vtRaw != null && vtRaw !== '' ? Number(vtRaw) : NaN;
      if (Number.isFinite(vtn) && vtn > 0) target.vehicleTypeId = vtn;
      target.transportMode = 'trucking';
      if (det?.source) target.source = String(det.source);
      if (det?.weightKg != null && Number(det.weightKg) > 0) target.weightKg = Number(det.weightKg);
      if (det?.pickup_lat != null) target.pickupLat = Number(det.pickup_lat);
      if (det?.pickup_lng != null) target.pickupLng = Number(det.pickup_lng);
      if (det?.delivery_lat != null) target.deliveryLat = Number(det.delivery_lat);
      if (det?.delivery_lng != null) target.deliveryLng = Number(det.delivery_lng);
      if (det?.carrier) target.carrier = String(det.carrier);
      if (det?.name) target.matter = String(det.name);
    };

    let confirmBody;
    if (hasPerVendor) {
      const perOrderTransport = orderList.map((o) => {
        const sid = String(o.supplierId || '');
        const sp = String(st.byVendorId[sid] || '').trim();
        if (!sp) {
          throw new Error(
            `Choose a courier for ${o.supplier || 'each supplier'} on Transport suggestion before confirming.`
          );
        }
        const det =
          st.byVendorCourierDetail && typeof st.byVendorCourierDetail === 'object'
            ? st.byVendorCourierDetail[sid]
            : null;
        const quotedTransportAmount =
          parseQuoteInr(det?.fareValue) ?? parseQuoteInr(det?.rate);
        const courierCompanyId =
          det?.courier_company_id != null && det?.courier_company_id !== ''
            ? Number(det.courier_company_id)
            : null;
        const row = {
          orderId: o.id,
          shippingProvider: sp,
          trackingNumber: st.trackingNumber || null,
          trackingUrl: st.trackingUrl || null,
          transportNotes: st.transportNotes || null,
          ...(quotedTransportAmount != null ? { quotedTransportAmount } : {})
        };
        if (Number.isFinite(courierCompanyId) && courierCompanyId > 0) {
          row.courierCompanyId = courierCompanyId;
        } else if (isTruckingDetail(det)) {
          applyTruckingFields(row, det);
        }
        return row;
      });
      confirmBody = { orderIds, perOrderTransport };
    } else {
      if (!String(st?.shippingProvider || '').trim()) {
        throw new Error('Please select transport details first.');
      }
      confirmBody = {
        orderIds,
        shippingProvider: st.shippingProvider,
        trackingNumber: st.trackingNumber || null,
        trackingUrl: st.trackingUrl || null,
        transportNotes: st.transportNotes || null
      };
      if (orderList.length === 1 && st.byVendorCourierDetail && typeof st.byVendorCourierDetail === 'object') {
        const sid = String(orderList[0].supplierId || '');
        const det = st.byVendorCourierDetail[sid];
        const q = parseQuoteInr(det?.fareValue) ?? parseQuoteInr(det?.rate);
        if (q != null) {
          confirmBody.quotedTransportAmount = q;
        }
        const cc = det?.courier_company_id;
        const n = cc != null && cc !== '' ? Number(cc) : NaN;
        if (Number.isFinite(n) && n > 0) {
          confirmBody.courierCompanyId = n;
        } else if (isTruckingDetail(det)) {
          applyTruckingFields(confirmBody, det);
        }
      }
    }

    const res = await fetch(getApiUrl('/api/po/transport/confirm'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(confirmBody)
    });

    if (!res.ok) {
      const errorText = await res.text();
      let errorMessage = 'Failed to update transport details';
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.message || errorData.error || errorMessage;
      } catch (e) {
        errorMessage = errorText || errorMessage;
      }
      throw new Error(errorMessage);
    }
    return res.json();
  };

  const completeOrderFlow = async () => {
    try {
      setCreatingOrders(true);
      let activeOrders = Array.isArray(createdTransportOrders) ? createdTransportOrders : [];
      if (activeOrders.length === 0) {
        const data = await createPurchaseOrders();
        activeOrders = Array.isArray(data.orders) ? data.orders : [];
        setCreatedTransportOrders(activeOrders);
      }
      await finalizeTransportDetails(activeOrders);
      setConfirmed(true);
    } catch (err) {
      console.error('Failed to finalize transport flow:', err);
      alert(err.message || 'Failed to finalize purchase orders. Please try again.');
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

    await completeOrderFlow();
  };

  const handlePlaceOrderAfterPlatformQr = async () => {
    setShowOnlineQrModal(false);
    await completeOrderFlow();
  };

  const handleTransportSuggestion = async () => {
    if (creatingOrders) return;
    if (!poGroups || poGroups.length === 0) {
      alert('No purchase order groups available. Please ensure all items have selected suppliers.');
      return;
    }

    const missingShipping = ['line1', 'city', 'state', 'pincode', 'country'].find(
      (key) => !String(shippingAddress?.[key] || '').trim()
    );
    if (missingShipping) {
      alert('Please complete the shipping address (including pincode) before transport suggestions.');
      return;
    }
    if (hasGstin) {
      const missingBilling = ['line1', 'city', 'state', 'pincode', 'country'].find(
        (key) => !String(billingAddress?.[key] || '').trim()
      );
      if (missingBilling) {
        alert('Please complete the billing address before transport suggestions.');
        return;
      }
    }

    const logisticsUi = String(import.meta.env.VITE_LOGISTICS_UI_BASE_URL || '').trim();
    if (logisticsUi) {
      const token = localStorage.getItem('token');
      try {
        const res = await fetch(resolveApiPath('/api/logistics/bridge-session'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            poGroups,
            shippingAddress,
            billingAddress,
            deliveryDestination,
            hasGstin
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          alert(data.message || data.error || 'Could not prepare logistics session.');
          return;
        }
        const sessionId = data.sessionId;
        if (!sessionId) {
          alert('Invalid response from logistics bridge.');
          return;
        }
        const base = logisticsUi.replace(/\/$/, '');
        const commerceApi = encodeURIComponent(API_BASE_URL.replace(/\/$/, ''));
        window.location.assign(
          `${base}/service-provider?session=${encodeURIComponent(sessionId)}&commerceApi=${commerceApi}`
        );
      } catch (e) {
        console.error(e);
        alert(e?.message || 'Network error while opening logistics.');
      }
      return;
    }

    navigate('/transport-suggestion', {
      state: {
        poGroups,
        grandTotalAllPos,
        requiredDate,
        hasGstin,
        deliveryDestination,
        shippingAddress,
        billingAddress,
        createdOrders: createdTransportOrders
      }
    });
  };

  if (confirmed) {
    return (
      <div className="page">
        <div className="success-state">
          <Check size={64} className="success-icon" />
          <h2>Purchase Orders Created!</h2>
          <p>All POs have been successfully generated and sent to vendors.</p>
          <div style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button type="button" className="btn-primary" onClick={() => navigate('/your-orders')}>
              View your orders
            </button>
            <button type="button" className="btn-secondary" onClick={() => navigate('/dashboard')}>
              Back to dashboard
            </button>
          </div>
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
      <VoiceGuidedBanner />
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
                          {normalizeSpecifications(item.specifications).length > 0 && (
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: '0.35rem',
                                marginTop: '0.4rem'
                              }}
                            >
                              {(expandedItemSpecs[`${group.vendorId || 'vendor'}::${item?.supplierProductId || item?.productId || item?.name || idx}`]
                                ? normalizeSpecifications(item.specifications)
                                : normalizeSpecifications(item.specifications).slice(0, 8)).map(([key, value]) => (
                                <span
                                  key={`${item.supplierProductId || item.productId || item.name}-${key}`}
                                  style={{
                                    fontSize: '0.74rem',
                                    color: '#334155',
                                    background: '#f1f5f9',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: '9999px',
                                    padding: '0.15rem 0.5rem',
                                    lineHeight: 1.35
                                  }}
                                >
                                  <strong>{key}:</strong> {value}
                                </span>
                              ))}
                              {normalizeSpecifications(item.specifications).length > 8 && (
                                <button
                                  type="button"
                                  onClick={() => toggleItemSpecs(group.vendorId, item, idx)}
                                  style={{
                                    border: 'none',
                                    background: 'transparent',
                                    color: '#2563eb',
                                    fontSize: '0.75rem',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    padding: '0.1rem 0.15rem'
                                  }}
                                >
                                  {expandedItemSpecs[`${group.vendorId || 'vendor'}::${item?.supplierProductId || item?.productId || item?.name || idx}`]
                                    ? 'Show less'
                                    : `View all specs (+${normalizeSpecifications(item.specifications).length - 8})`}
                                </button>
                              )}
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

          {isTransportSelectionReady(selectedTransport, poGroups) ? (
            <div
              style={{
                marginBottom: '1rem',
                border: '1px solid #c7d2fe',
                borderRadius: 12,
                padding: '1rem 1.1rem',
                background: 'linear-gradient(180deg, #eef2ff 0%, #e0e7ff 100%)'
              }}
            >
              <div style={{ fontWeight: 700, color: '#1e1b4b', marginBottom: '0.65rem', fontSize: '1rem' }}>
                Selected transport (review rates, then confirm below)
              </div>
              {selectedTransport?.byVendorId && Object.keys(selectedTransport.byVendorId).length > 0 ? (
                <>
                  <div style={{ display: 'grid', gap: '0.65rem' }}>
                    {Object.entries(selectedTransport.byVendorId)
                      .filter(([, name]) => String(name || '').trim())
                      .map(([vid, name]) => {
                        const g = poGroups.find((x) => String(x.vendorId) === String(vid));
                        const label = g?.vendorName || vid;
                        const d =
                          selectedTransport.byVendorCourierDetail &&
                          typeof selectedTransport.byVendorCourierDetail === 'object'
                            ? selectedTransport.byVendorCourierDetail[vid]
                            : null;
                        const priceLabel = formatQuoteMoney(d?.rate);
                        return (
                          <div
                            key={vid}
                            style={{
                              background: '#fff',
                              border: '1px solid #c7d2fe',
                              borderRadius: 10,
                              padding: '0.65rem 0.85rem',
                              fontSize: '0.88rem',
                              color: '#334155'
                            }}
                          >
                            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem' }}>{label}</div>
                            <div>
                              <strong>
                                {d?.transport_mode === 'trucking' ? 'Trucking' : 'Courier'}:
                              </strong>{' '}
                              {name}
                            </div>
                            {priceLabel ? (
                              <div style={{ marginTop: '0.2rem', fontWeight: 700, color: '#4f46e5' }}>
                                Quote rate: {priceLabel}
                              </div>
                            ) : null}
                            <div style={{ marginTop: '0.25rem', fontSize: '0.82rem', color: '#64748b' }}>
                              {d?.etd ? (
                                <span>
                                  ETD: {d.etd}
                                  {d?.source ? ' · ' : ''}
                                </span>
                              ) : null}
                              {d?.source ? <span>Source: {d.source}</span> : null}
                              {d?.rating != null && d?.rating !== '' ? (
                                <span>
                                  {' '}
                                  · Rating: {d.rating}
                                </span>
                              ) : null}
                              {d?.cod != null ? <span> · COD: {String(d.cod)}</span> : null}
                              {d?.weightKg != null ? <span> · Billable weight: {d.weightKg} kg</span> : null}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  {(() => {
                    const det = selectedTransport.byVendorCourierDetail;
                    if (!det || typeof det !== 'object') return null;
                    let sum = 0;
                    let any = false;
                    for (const vid of Object.keys(selectedTransport.byVendorId || {})) {
                      const r = det[vid]?.rate;
                      const n = Number(String(r ?? '').replace(/,/g, ''));
                      if (Number.isFinite(n)) {
                        sum += n;
                        any = true;
                      }
                    }
                    if (!any) return null;
                    return (
                      <div
                        style={{
                          marginTop: '0.75rem',
                          paddingTop: '0.65rem',
                          borderTop: '1px solid #a5b4fc',
                          fontWeight: 700,
                          color: '#312e81',
                          fontSize: '0.95rem'
                        }}
                      >
                        Combined quoted courier charges:{' '}
                        {formatQuoteMoney(sum)}
                        <span style={{ fontWeight: 500, color: '#64748b', fontSize: '0.8rem', marginLeft: '0.35rem' }}>
                          (sum of per-shipment quotes; final billing per carrier)
                        </span>
                      </div>
                    );
                  })()}
                </>
              ) : (
                <div style={{ fontSize: '0.9rem', color: '#334155' }}>
                  <strong>Courier:</strong> {selectedTransport.shippingProvider}
                  {selectedTransport.trackingNumber ? (
                    <span style={{ marginLeft: '0.5rem' }}>| Tracking: {selectedTransport.trackingNumber}</span>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-secondary btn-large"
              onClick={handleTransportSuggestion}
              disabled={poGroups.length === 0 || creatingOrders}
            >
              {creatingOrders ? 'Saving POs...' : 'Transport suggestion'}
            </button>
            <button
              className="btn-primary btn-large"
              onClick={handleConfirm}
              disabled={poGroups.length === 0 || creatingOrders || !isTransportSelectionReady(selectedTransport, poGroups)}
            >
              {creatingOrders ? 'Finalizing...' : 'Confirm & Create All POs'}
            </button>
          </div>
          <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
            Step 1: Click Transport suggestion and choose transport details. Step 2: Confirm & Create All POs will create orders and apply transport details in one flow.
          </p>
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
