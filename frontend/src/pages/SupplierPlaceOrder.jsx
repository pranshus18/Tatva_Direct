import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getApiUrl } from '../config/api';
import './Dashboard.css';
import './CreatePO.css';
import './SupplierPlaceOrder.css';

const SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY = 'supplierUpstreamOrderDraft';

const isBranchComplete = (branch) =>
  ['address', 'city', 'state', 'country'].every((key) => String(branch?.[key] || '').trim()) &&
  String(branch?.zipCode || branch?.pincode || '').trim();

const branchToShippingAddress = (branch) => ({
  line1: String(branch?.address || branch?.line1 || '').trim(),
  city: String(branch?.city || '').trim(),
  state: String(branch?.state || '').trim(),
  pincode: String(branch?.zipCode || branch?.pincode || '').trim(),
  country: String(branch?.country || 'India').trim() || 'India'
});

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

function AddressFields({ prefix, address, onChange, disabled = false }) {
  const set = (field, value) => onChange({ ...address, [field]: value });
  return (
    <div className="checkout-address-grid">
      <div className="checkout-address-field checkout-address-field--wide">
        <label htmlFor={`${prefix}-line1`}>Street address</label>
        <input
          id={`${prefix}-line1`}
          className="checkout-address-input"
          value={address.line1 || ''}
          onChange={(e) => set('line1', e.target.value)}
          placeholder="Building / street / area"
          disabled={disabled}
        />
      </div>
      <div className="checkout-address-field">
        <label htmlFor={`${prefix}-city`}>City</label>
        <input
          id={`${prefix}-city`}
          className="checkout-address-input"
          value={address.city || ''}
          onChange={(e) => set('city', e.target.value)}
          placeholder="City"
          disabled={disabled}
        />
      </div>
      <div className="checkout-address-field">
        <label htmlFor={`${prefix}-state`}>State</label>
        <input
          id={`${prefix}-state`}
          className="checkout-address-input"
          value={address.state || ''}
          onChange={(e) => set('state', e.target.value)}
          placeholder="State"
          disabled={disabled}
        />
      </div>
      <div className="checkout-address-field">
        <label htmlFor={`${prefix}-pincode`}>PIN code</label>
        <input
          id={`${prefix}-pincode`}
          className="checkout-address-input"
          value={address.pincode || ''}
          onChange={(e) => set('pincode', e.target.value)}
          placeholder="6-digit PIN"
          disabled={disabled}
        />
      </div>
      <div className="checkout-address-field">
        <label htmlFor={`${prefix}-country`}>Country</label>
        <input
          id={`${prefix}-country`}
          className="checkout-address-input"
          value={address.country || ''}
          onChange={(e) => set('country', e.target.value)}
          placeholder="Country"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

const SupplierPlaceOrder = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const [draft, setDraft] = useState(null);
  const [requiredDate, setRequiredDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('online');
  const [placing, setPlacing] = useState(false);
  const [loadingDraft, setLoadingDraft] = useState(true);

  const [shippingAddress, setShippingAddress] = useState({
    line1: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India'
  });
  const [billingAddress, setBillingAddress] = useState({
    line1: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India'
  });
  const [deliveryDestination, setDeliveryDestination] = useState('shipping'); // shipping | billing
  const [hasGstin, setHasGstin] = useState(false);
  const [shippingBranches, setShippingBranches] = useState([]);
  const [selectedShippingBranchId, setSelectedShippingBranchId] = useState('');

  const [selectedTransport, setSelectedTransport] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;

      if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) return;

      setDraft(parsed);
      setRequiredDate(typeof parsed.requiredDate === 'string' ? parsed.requiredDate : '');
      setPaymentMethod(typeof parsed.paymentMethod === 'string' ? parsed.paymentMethod : 'online');
      if (parsed.transportSelection && typeof parsed.transportSelection === 'object') {
        setSelectedTransport(parsed.transportSelection);
      }
    } catch (e) {
      console.error('Failed to load supplier upstream order draft:', e);
    } finally {
      setLoadingDraft(false);
    }
  }, []);

  // Persist user's latest choices so navigating back doesn't lose their inputs.
  useEffect(() => {
    if (!draft) return;
    try {
      localStorage.setItem(
        SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY,
        JSON.stringify({
          ...draft,
          requiredDate: requiredDate || '',
          paymentMethod,
          transportSelection: selectedTransport || null
        })
      );
    } catch (_) {
      // Non-fatal.
    }
  }, [draft, requiredDate, paymentMethod, selectedTransport]);

  // Prefill shipping/billing addresses from profile + GSTIN detection.
  useEffect(() => {
    let cancelled = false;
    const loadProfile = async () => {
      setProfileLoading(true);
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(getApiUrl('/api/profile'), {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        const profile = data?.profile || {};
        const gstinRaw = profile?.gstin || profile?.mainGstin || '';
        setHasGstin(Boolean(String(gstinRaw || '').trim()));

        const branches = (Array.isArray(profile?.branches) ? profile.branches : []).filter(isBranchComplete);
        setShippingBranches(branches);
        const primaryBranch = branches[0] || null;
        if (primaryBranch) {
          setSelectedShippingBranchId(String(primaryBranch.id || ''));
          setShippingAddress(branchToShippingAddress(primaryBranch));
        }

        const billingCandidate =
          Array.isArray(profile?.billingAddresses) && profile.billingAddresses.length > 0
            ? profile.billingAddresses[0]
            : null;
        setBillingAddress((prev) => {
          const b = billingCandidate || (primaryBranch ? branchToShippingAddress(primaryBranch) : {});
          return {
            ...prev,
            line1: b?.line1 || b?.street || prev.line1,
            city: b?.city || prev.city,
            state: b?.state || prev.state,
            pincode: b?.pincode || b?.zipCode || prev.pincode,
            country: b?.country || prev.country
          };
        });
      } catch (e) {
        // Non-fatal; user can still fill manually.
        console.error('Supplier profile load error:', e);
      } finally {
        if (!cancelled) setProfileLoading(false);
      }
    };

    void loadProfile();
    return () => {
      cancelled = true;
    };
  }, []);

  // When returning from Transport suggestion, reuse the shipping/billing values we passed.
  useEffect(() => {
    const st = location.state || {};
    if (!st) return;

    if (st.transportSelection && typeof st.transportSelection === 'object') {
      setSelectedTransport(st.transportSelection);
      if (draft) {
        try {
          localStorage.setItem(
            SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY,
            JSON.stringify({
              ...draft,
              requiredDate: st.requiredDate || requiredDate || '',
              paymentMethod: st.paymentMethod || paymentMethod,
              transportSelection: st.transportSelection
            })
          );
        } catch (_) {
          // Non-fatal.
        }
      }
    }

    if (typeof st.deliveryDestination === 'string' && (st.deliveryDestination === 'shipping' || st.deliveryDestination === 'billing')) {
      setDeliveryDestination(st.deliveryDestination);
    }

    if (st.hasGstin != null) setHasGstin(Boolean(st.hasGstin));

    if (st.shippingAddress && typeof st.shippingAddress === 'object') {
      setShippingAddress((prev) => ({ ...prev, ...st.shippingAddress }));
    }
    if (st.billingAddress && typeof st.billingAddress === 'object') {
      setBillingAddress((prev) => ({ ...prev, ...st.billingAddress }));
    }

    if (typeof st.requiredDate === 'string') setRequiredDate(st.requiredDate || '');
    if (typeof st.paymentMethod === 'string') setPaymentMethod(st.paymentMethod || 'online');
  }, [location.state, draft, requiredDate, paymentMethod]);

  useEffect(() => {
    // Backend also forces delivery to shipping when GSTIN is not available.
    if (!hasGstin && deliveryDestination === 'billing') setDeliveryDestination('shipping');
  }, [hasGstin, deliveryDestination]);

  useEffect(() => {
    if (!selectedShippingBranchId) return;
    const branch = shippingBranches.find((b) => String(b.id) === String(selectedShippingBranchId));
    if (branch) setShippingAddress(branchToShippingAddress(branch));
  }, [selectedShippingBranchId, shippingBranches]);

  const itemCount = useMemo(() => {
    if (!draft?.lines || !Array.isArray(draft.lines)) return 0;
    return draft.lines.length;
  }, [draft]);

  const estimatedTotal = useMemo(() => {
    const v = draft?.totalAmountEstimate;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }, [draft]);

  const todayDateInput = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }, []);

  const reviewLines = useMemo(
    () => (Array.isArray(draft?.reviewLines) ? draft.reviewLines : []),
    [draft]
  );

  const poGroups = useMemo(() => {
    const groupsByVendorId = new Map();
    for (const line of reviewLines || []) {
      const vendorId = line?.supplierId != null ? String(line.supplierId) : '';
      const vendorName = line?.supplierName ? String(line.supplierName) : 'Supplier';
      if (!vendorId) continue;

      if (!groupsByVendorId.has(vendorId)) {
        groupsByVendorId.set(vendorId, {
          vendorId,
          vendorName,
          total: 0,
          items: []
        });
      }

      const g = groupsByVendorId.get(vendorId);
      const qty = Number(line?.quantity || 0) || 0;
      const unitPrice = Number(line?.unitPrice || 0) || 0;
      const lineTotal = Number(line?.lineTotal || 0) || 0;

      g.total += lineTotal;
      g.items.push({
        name: line?.productName || 'Product',
        quantity: qty,
        unit: 'nos',
        price: unitPrice,
        specifications: {}
      });
    }

    return Array.from(groupsByVendorId.values());
  }, [reviewLines]);

  const grandTotalAllPos = useMemo(() => {
    if (!poGroups.length) return 0;
    return poGroups.reduce((s, g) => s + (Number(g.total) || 0), 0);
  }, [poGroups]);

  const handleTransportSuggestion = () => {
    if (!requiredDate) {
      window.alert('Please select a "Required By Date" before getting transport suggestions.');
      return;
    }

    if (!poGroups.length) {
      window.alert('No vendor groups found for transport suggestion.');
      return;
    }

    const missingSupplierIds = (reviewLines || []).some((l) => !l?.supplierId);
    if (missingSupplierIds) {
      window.alert(
        'Some selected lines are missing supplier information. Please go back to Upstream Orders and re-select items.'
      );
      return;
    }

    navigate('/supplier-transport-suggestion', {
      state: {
        returnPath: '/supplier-place-order',
        poGroups,
        grandTotalAllPos,
        requiredDate,
        hasGstin,
        deliveryDestination,
        shippingAddress,
        billingAddress,
        createdOrders: [],
        transportSelection: selectedTransport || null
      }
    });
  };

  const handlePlaceOrder = async () => {
    if (!draft?.lines || !Array.isArray(draft.lines) || draft.lines.length === 0) {
      alert('No draft order found. Please select products again.');
      return;
    }

    if (!requiredDate) {
      const proceed = window.confirm(
        'You have not specified a "Required By" date.\n\nDo you want to continue without a required date?'
      );
      if (!proceed) return;
    }

    setPlacing(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/upstream/orders'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          lines: draft.lines,
          requiredDate: requiredDate || null,
          paymentMethod,
          shippingAddress,
          billingAddress,
          deliveryDestination
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.status !== 'success') {
        alert(data?.message || 'Failed to place upstream orders.');
        return;
      }

      const createdOrders = Array.isArray(data.orders) ? data.orders : [];

      // If the user picked transport quotes, book the chosen transport against created orders.
      if (selectedTransport && createdOrders.length > 0 && selectedTransport.byVendorId) {
        const perOrderTransport = createdOrders.map((o) => {
          const sid = String(o.supplierId || '');
          const shippingProvider = selectedTransport?.byVendorId?.[sid];
          const det = selectedTransport?.byVendorCourierDetail?.[sid] || {};

          const transportMode = det?.transport_mode ?? det?.transportMode ?? null;
          const source = det?.source ?? null;
          const isTrucking = String(transportMode || '').toLowerCase() === 'trucking';

          return {
            orderId: o.id,
            shippingProvider: String(shippingProvider || '').trim(),
            courierCompanyId: isTrucking ? null : det?.courier_company_id ?? null,
            vehicleTypeId: isTrucking ? det?.vehicle_type_id ?? det?.vehicleTypeId ?? null : null,
            transportMode: isTrucking ? 'trucking' : 'courier',
            source: source ? String(source) : null,
            weightKg: det?.weightKg ?? null,
            pickupLat: det?.pickup_lat ?? det?.pickupLat ?? null,
            pickupLng: det?.pickup_lng ?? det?.pickupLng ?? null,
            deliveryLat: det?.delivery_lat ?? det?.deliveryLat ?? null,
            deliveryLng: det?.delivery_lng ?? det?.deliveryLng ?? null,
            carrier: det?.carrier ?? null,
            matter: null,
            trackingNumber: null,
            trackingUrl: null,
            transportNotes: null,
            quotedTransportAmount: det?.fareValue ?? det?.rate ?? null
          };
        });

        const confirmRes = await fetch(getApiUrl('/api/po/transport/confirm'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            orderIds: createdOrders.map((o) => o.id).filter(Boolean),
            perOrderTransport
          })
        });

        const confirmData = await confirmRes.json().catch(() => ({}));
        if (!confirmRes.ok || confirmData?.status !== 'success') {
          alert(confirmData?.message || 'Upstream order(s) created, but transport booking failed.');
          // Still clear draft and go to upstream list.
          localStorage.removeItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
          navigate('/supplier-upstream');
          return;
        }
      }

      alert(data.message || 'Upstream order(s) placed successfully.');
      localStorage.removeItem(SUPPLIER_UPSTREAM_ORDER_DRAFT_KEY);
      navigate('/supplier-upstream');
    } catch (e) {
      console.error('Place upstream orders error:', e);
      alert(e?.message || 'Failed to place upstream orders. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  if (loadingDraft) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading your order draft…</p>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="dashboard-container">
        <div className="dashboard-header">
          <div>
            <h1>Place Order</h1>
            <p>No order draft found. Start from Upstream Orders.</p>
          </div>
          <button type="button" className="btn-secondary" onClick={() => navigate('/supplier-upstream')}>
            Back to Upstream Orders
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container spo-page">
      <div className="dashboard-header">
        <div>
          <h1>Place Upstream Order</h1>
          <p style={{ color: '#64748b', margin: '0.35rem 0 0', maxWidth: '36rem' }}>
            Review delivery, payment, and transport — then confirm your upstream purchase.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={() => navigate('/supplier-upstream')}>
          Back
        </button>
      </div>

      <div className="spo-layout">
        <div className="spo-summary-bar">
          <h2 className="spo-summary-bar__title">Order summary</h2>
          <div className="spo-summary-stats">
            <div className="spo-stat">
              <span className="spo-stat__label">Items</span>
              <span className="spo-stat__value">{itemCount}</span>
            </div>
            {estimatedTotal != null ? (
              <div className="spo-stat">
                <span className="spo-stat__label">Est. total</span>
                <span className="spo-stat__value spo-stat__value--accent">
                  ₹{estimatedTotal.toLocaleString('en-IN')}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="spo-card">
          <section className="spo-section">
            <h2 className="spo-section-title">Delivery &amp; payment</h2>
            <div className="spo-two-col">
              <div className="spo-field">
                <label htmlFor="spo-required-date">Required by date</label>
                <input
                  id="spo-required-date"
                  type="date"
                  value={requiredDate}
                  onChange={(e) => setRequiredDate(e.target.value)}
                  min={todayDateInput}
                />
                <p className="spo-hint">Stored on each upstream order as the expected delivery date.</p>
              </div>
              <div className="spo-field">
                <label htmlFor="spo-payment-method">Payment method</label>
                <select
                  id="spo-payment-method"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                >
                  <option value="online">Pay online (UPI / card)</option>
                  <option value="cod">Cash on delivery</option>
                  <option value="bank_transfer">Bank transfer</option>
                  <option value="card">Credit / Debit Card</option>
                  <option value="credit">Credit / pay later (on account)</option>
                </select>
                {paymentMethod === 'credit' ? (
                  <div className="spo-alert spo-alert--credit">
                    <strong>Credit selected.</strong> Works only if upstream suppliers have you within their credit
                    limits.
                  </div>
                ) : (
                  <p className="spo-hint">Credit depends on each supplier&apos;s configured credit account.</p>
                )}
              </div>
            </div>
          </section>

          <section className="spo-section">
            <h2 className="spo-section-title">Delivery address</h2>
            <p className="spo-section-desc">
              Choose where material should be delivered. Only the selected address is shown and used for courier
              quotes.
            </p>

            <div className="checkout-delivery-choice" style={{ marginBottom: '1rem' }}>
              <label>
                <input
                  type="radio"
                  name="spo-delivery-dest"
                  checked={deliveryDestination === 'shipping'}
                  onChange={() => setDeliveryDestination('shipping')}
                />
                Shipping branch address
              </label>
              <label style={!hasGstin ? { opacity: 0.55 } : undefined}>
                <input
                  type="radio"
                  name="spo-delivery-dest"
                  checked={deliveryDestination === 'billing'}
                  disabled={!hasGstin}
                  onChange={() => hasGstin && setDeliveryDestination('billing')}
                />
                Billing address {hasGstin ? '' : '(add GSTIN in profile)'}
              </label>
            </div>

            {deliveryDestination === 'shipping' ? (
              <div className="spo-address-single checkout-address-card">
                <div className="checkout-address-card__head">
                  <h3>Shipping (branch)</h3>
                  <p>Material will be delivered to this branch location.</p>
                </div>
                {shippingBranches.length > 1 ? (
                  <div className="spo-field" style={{ marginBottom: '0.75rem' }}>
                    <label htmlFor="spo-shipping-branch">Branch</label>
                    <select
                      id="spo-shipping-branch"
                      value={selectedShippingBranchId}
                      onChange={(e) => setSelectedShippingBranchId(e.target.value)}
                    >
                      {shippingBranches.map((branch) => (
                        <option key={branch.id} value={String(branch.id)}>
                          {branch.name || 'Branch'} — {branch.city || 'City'}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <p className="checkout-address-note">
                  From Company Profile → shipping branches.{' '}
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem', marginLeft: '0.25rem' }}
                    onClick={() => navigate('/profile')}
                  >
                    Edit profile
                  </button>
                </p>
                <AddressFields
                  prefix="ship"
                  address={shippingAddress}
                  onChange={setShippingAddress}
                />
              </div>
            ) : (
              <div className="spo-address-single checkout-address-card checkout-address-card--billing">
                <div className="checkout-address-card__head">
                  <h3>Billing address</h3>
                  <p>Material will be delivered to this billing address (GSTIN on file).</p>
                </div>
                <p className="checkout-address-note">
                  From Company Profile → billing addresses.{' '}
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: '0.2rem 0.5rem', fontSize: '0.78rem', marginLeft: '0.25rem' }}
                    onClick={() => navigate('/profile')}
                  >
                    Edit profile
                  </button>
                </p>
                <AddressFields
                  prefix="bill"
                  address={billingAddress}
                  onChange={setBillingAddress}
                />
              </div>
            )}
          </section>

          {isTransportSelectionReady(selectedTransport, poGroups) ? (
            <section className="spo-section">
              <h2 className="spo-section-title">Selected transport</h2>
              <div className="spo-transport-panel">
                <div className="spo-transport-grid">
                  {Object.entries(selectedTransport.byVendorId || {})
                    .filter(([, name]) => String(name || '').trim())
                    .map(([vid, name]) => {
                      const g = poGroups.find((x) => String(x.vendorId) === String(vid));
                      const label = g?.vendorName || vid;
                      const d =
                        selectedTransport.byVendorCourierDetail &&
                        typeof selectedTransport.byVendorCourierDetail === 'object'
                          ? selectedTransport.byVendorCourierDetail[vid]
                          : null;
                      const priceLabel = formatQuoteMoney(d?.rate ?? d?.fareValue);
                      const mode =
                        d?.transport_mode === 'trucking' || d?.transportMode === 'trucking'
                          ? 'Trucking'
                          : 'Courier';
                      return (
                        <div key={vid} className="spo-transport-item">
                          <div>
                            <strong>{label}</strong> — {mode}: {name}
                          </div>
                          {priceLabel ? <div style={{ marginTop: '0.2rem', color: '#4f46e5' }}>{priceLabel}</div> : null}
                        </div>
                      );
                    })}
                </div>
              </div>
            </section>
          ) : null}

          {reviewLines.length > 0 ? (
            <section className="spo-section">
              <h2 className="spo-section-title">Order lines</h2>
              <div className="spo-table-wrap">
                <table className="po-table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Supplier</th>
                      <th style={{ textAlign: 'right' }}>Qty</th>
                      <th style={{ textAlign: 'right' }}>Unit price</th>
                      <th style={{ textAlign: 'right' }}>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reviewLines.map((line, idx) => (
                      <tr key={`${line.mineSupplierProductId}-${line.upstreamSupplierProductId}-${idx}`}>
                        <td>{line.productName || 'Product'}</td>
                        <td>{line.supplierName || 'Supplier'}</td>
                        <td style={{ textAlign: 'right' }}>{Number(line.quantity || 0)}</td>
                        <td style={{ textAlign: 'right' }}>
                          ₹{Number(line.unitPrice || 0).toLocaleString('en-IN')}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          ₹{Number(line.lineTotal || 0).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          <footer className="spo-actions">
            <button type="button" className="btn-secondary" onClick={() => navigate('/supplier-upstream')} disabled={placing}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleTransportSuggestion}
              disabled={placing || profileLoading}
            >
              {isTransportSelectionReady(selectedTransport, poGroups) ? 'Change transport' : 'Get transport quotes'}
            </button>
            <button type="button" className="btn-primary btn-large" onClick={handlePlaceOrder} disabled={placing}>
              {placing ? 'Placing…' : 'Place order'}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
};

export default SupplierPlaceOrder;

