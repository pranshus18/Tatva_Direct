import React, { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { getApiUrl } from '../config/api';
import './Profile.css';

export default function SupplierDiscountInsights() {
  const [loading, setLoading] = useState(true);
  const [insights, setInsights] = useState(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  useEffect(() => {
    const fetchDiscountInsights = async () => {
      try {
        const token = localStorage.getItem('token');
        const params = new URLSearchParams();
        if (fromDate) params.set('from', `${fromDate}T00:00:00.000Z`);
        if (toDate) params.set('to', `${toDate}T23:59:59.999Z`);
        const endpoint = `/api/supplier/analytics/discount-insights${
          params.toString() ? `?${params.toString()}` : ''
        }`;

        const response = await fetch(getApiUrl(endpoint), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.status === 'success') {
          setInsights(data);
        }
      } catch (error) {
        console.error('Failed to fetch supplier discount insights:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDiscountInsights();
  }, [fromDate, toDate]);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading Brand_level_cov…</p>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div className="profile-header">
        <div className="profile-title">
          <BarChart3 size={24} />
          <h1>Brand_level_cov</h1>
        </div>
      </div>

      <div className="profile-content">
        <div className="profile-section">
          <p style={{ color: '#64748b', fontSize: '0.92rem', marginTop: 0, marginBottom: '1rem' }}>
            This shows what you purchase from upstream partners, brand-wise and total.
          </p>

          <div className="supplier-summary-grid">
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total upstream suppliers</p>
              <p className="supplier-summary-value">{insights?.summary?.totalUpstreamSuppliers ?? 0}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total purchase orders</p>
              <p className="supplier-summary-value">{insights?.summary?.totalOrders ?? 0}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total purchase value</p>
              <p className="supplier-summary-value">
                ₹{Number(insights?.summary?.totalPurchaseValue || 0).toLocaleString()}
              </p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total_brand_COV</p>
              <p className="supplier-summary-value">
                ₹{Number(insights?.summary?.paidPurchaseValue || 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="profile-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <h2 style={{ margin: 0 }}>Brand_cov</h2>
            <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                style={inputStyle}
                aria-label="From date"
              />
              <span style={{ alignSelf: 'center', color: '#475569', fontSize: '0.9rem' }}>to</span>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                style={inputStyle}
                aria-label="To date"
              />
            </div>
          </div>
          {Array.isArray(insights?.brands) && insights.brands.length > 0 ? (
            <div style={{ display: 'grid', gap: '0.6rem' }}>
              {insights.brands.map((brand) => (
                <div
                  key={brand.brand}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 10,
                    padding: '0.75rem 0.9rem',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{brand.brand}</div>
                    <div style={{ color: '#64748b', fontSize: '0.86rem' }}>
                      Qty: {Number(brand.itemQty || 0).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ fontWeight: 700 }}>
                    ₹{Number(brand.orderValue || 0).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p style={{ color: '#64748b', margin: 0 }}>No upstream purchase values available yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: '0.55rem 0.7rem',
  border: '1px solid #e2e8f0',
  borderRadius: 8
};
