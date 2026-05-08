import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const formatCurrency = (value) =>
  `₹${(Number(value) || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const TransportSuggestion = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const poGroups = Array.isArray(location.state?.poGroups) ? location.state.poGroups : [];
  const grandTotalAllPos = Number(location.state?.grandTotalAllPos) || 0;
  const requiredDate = location.state?.requiredDate || '';
  const hasGstin = Boolean(location.state?.hasGstin);
  const deliveryDestination = location.state?.deliveryDestination || 'shipping';

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
          </div>

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {poGroups.map((group) => (
              <div
                key={`transport-${group.vendorId}`}
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
                  Line items: {Array.isArray(group.items) ? group.items.length : 0}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button type="button" className="btn-primary" onClick={() => navigate('/create-po')}>
          Back to Create PO
        </button>
      </div>
    </div>
  );
};

export default TransportSuggestion;
