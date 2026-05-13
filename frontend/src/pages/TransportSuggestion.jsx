import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const formatCurrency = (value) =>
  `₹${(Number(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
const normalizeSpecifications = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const seen = new Set();
  return Object.entries(value).reduce((acc, [key, rawValue]) => {
    const cleanKey = String(key || '').trim();
    const cleanValue = rawValue === null || rawValue === undefined ? '' : String(rawValue).trim();
    if (!cleanKey || !cleanValue) return acc;
    const dedupeKey = cleanKey.toLowerCase();
    if (seen.has(dedupeKey)) return acc;
    seen.add(dedupeKey);
    acc.push([cleanKey, cleanValue]);
    return acc;
  }, []);
};

const TransportSuggestion = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const poGroups = Array.isArray(location.state?.poGroups) ? location.state.poGroups : [];
  const grandTotalAllPos = Number(location.state?.grandTotalAllPos) || 0;
  const requiredDate = location.state?.requiredDate || '';
  const hasGstin = Boolean(location.state?.hasGstin);
  const deliveryDestination = location.state?.deliveryDestination || 'shipping';
  const createdOrders = Array.isArray(location.state?.createdOrders) ? location.state.createdOrders : [];
  const transportOrderCards =
    createdOrders.length > 0
      ? createdOrders.map((order) => ({
          key: order.id || order.orderNumber,
          vendorName: order.supplier || 'Supplier',
          total: order.totalAmount || 0,
          items: Array.isArray(order.items) ? order.items : []
        }))
      : poGroups.map((group) => ({
          key: group.vendorId,
          vendorName: group.vendorName,
          total: group.total,
          items: Array.isArray(group.items) ? group.items : []
        }));

  const [shippingProvider, setShippingProvider] = React.useState('');
  const [trackingNumber, setTrackingNumber] = React.useState('');
  const [trackingUrl, setTrackingUrl] = React.useState('');
  const [transportNotes, setTransportNotes] = React.useState('');

  const handleUseTransport = () => {
    if (!shippingProvider.trim()) {
      window.alert('Please enter a transport provider before continuing.');
      return;
    }
    navigate('/create-po', {
      state: {
        transportSelection: {
          shippingProvider: shippingProvider.trim(),
          trackingNumber: trackingNumber.trim(),
          trackingUrl: trackingUrl.trim(),
          transportNotes: transportNotes.trim()
        },
        createdOrders
      }
    });
  };

  return (
    <div className="page">
      <div className="page-header">
        <h1>Transport suggestion</h1>
        <p>Review your order before creating purchase orders.</p>
      </div>

      {poGroups.length === 0 ? (
        <div
          style={{
            background: '#fef3c7',
            border: '1px solid #fcd34d',
            borderRadius: '8px',
            padding: '1rem',
            color: '#92400e',
            marginBottom: '1rem'
          }}
        >
          No order data found. Please return to Create PO and click Transport suggestion again.
        </div>
      ) : (
        <>
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '1rem',
              background: '#f8fafc',
              marginBottom: '1rem'
            }}
          >
            <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: '0.25rem' }}>
              Total vendors: {poGroups.length}
            </div>
            <div style={{ fontWeight: 700, color: '#4f46e5', marginBottom: '0.25rem' }}>
              Grand total: {formatCurrency(grandTotalAllPos)}
            </div>
            <div style={{ fontSize: '0.9rem', color: '#334155' }}>
              Required by: {requiredDate || 'Not specified'}
            </div>
            <div style={{ fontSize: '0.9rem', color: '#334155', marginTop: '0.2rem' }}>
              Delivery destination: {deliveryDestination === 'billing' && hasGstin ? 'Billing address' : 'Shipping address'}
            </div>
            <div style={{ fontSize: '0.9rem', color: '#334155', marginTop: '0.2rem' }}>
              Created orders: {createdOrders.length}
            </div>
          </div>

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {transportOrderCards.map((group) => (
              <div
                key={`transport-${group.key}`}
                style={{
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '0.85rem 0.9rem',
                  background: '#fff'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
                  <strong style={{ color: '#0f172a' }}>{group.vendorName}</strong>
                  <span style={{ color: '#4f46e5', fontWeight: 700 }}>{formatCurrency(group.total)}</span>
                </div>
                <div style={{ marginTop: '0.25rem', fontSize: '0.84rem', color: '#475569' }}>
                  Line items: {group.items.length}
                </div>
                {group.items.length > 0 && (
                  <div style={{ marginTop: '0.55rem', display: 'grid', gap: '0.45rem' }}>
                    {group.items.map((item, idx) => (
                      <div key={`${group.key}-${item.supplierProductId || item.productId || idx}`} style={{ fontSize: '0.82rem', color: '#334155' }}>
                        <div>
                          <strong>{item.name}</strong> · {item.quantity} {item.unit || 'nos'} · {formatCurrency(item.price)}
                        </div>
                        {normalizeSpecifications(item.specifications).length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', marginTop: '0.2rem' }}>
                            {normalizeSpecifications(item.specifications).slice(0, 6).map(([key, value]) => (
                              <span
                                key={`${group.key}-${idx}-${key}`}
                                style={{
                                  fontSize: '0.72rem',
                                  color: '#334155',
                                  background: '#f1f5f9',
                                  border: '1px solid #e2e8f0',
                                  borderRadius: '9999px',
                                  padding: '0.12rem 0.45rem'
                                }}
                              >
                                <strong>{key}:</strong> {value}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: '1rem',
              border: '1px solid #dbe3ef',
              borderRadius: '12px',
              padding: '1rem',
              background: '#ffffff'
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: '0.75rem', color: '#0f172a' }}>Transport details</h3>
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              <input
                value={shippingProvider}
                onChange={(e) => setShippingProvider(e.target.value)}
                placeholder="Transport provider (required)"
                style={{ padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #cbd5e1' }}
              />
              <input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="Tracking number (optional)"
                style={{ padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #cbd5e1' }}
              />
              <input
                value={trackingUrl}
                onChange={(e) => setTrackingUrl(e.target.value)}
                placeholder="Tracking URL (optional, https://...)"
                style={{ padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #cbd5e1' }}
              />
              <textarea
                value={transportNotes}
                onChange={(e) => setTransportNotes(e.target.value)}
                placeholder="Transport notes (optional)"
                rows={3}
                style={{ padding: '0.55rem 0.7rem', borderRadius: 8, border: '1px solid #cbd5e1', resize: 'vertical' }}
              />
            </div>
          </div>
        </>
      )}

      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn-secondary" onClick={() => navigate('/create-po')}>
          Back to Create PO
        </button>
        <button type="button" className="btn-primary" onClick={handleUseTransport} disabled={createdOrders.length === 0}>
          Use selected transport
        </button>
      </div>
    </div>
  );
};

export default TransportSuggestion;
