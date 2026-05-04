import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { getApiUrl } from '../config/api';
import './Profile.css';

export default function SupplierPurchaseTotal() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ summary: null, suppliers: [] });
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [topSuppliers, setTopSuppliers] = useState('20');

  const fetchSupplierPurchaseTotals = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (fromDate) params.set('from', `${fromDate}T00:00:00.000Z`);
      if (toDate) params.set('to', `${toDate}T23:59:59.999Z`);
      if (topSuppliers && topSuppliers !== 'all') params.set('top', topSuppliers);

      const endpoint = `/api/supplier/analytics/upstream-supplier-purchase-totals${
        params.toString() ? `?${params.toString()}` : ''
      }`;
      const response = await fetch(getApiUrl(endpoint), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const payload = await response.json();
      if (payload.status === 'success') {
        setData({
          summary: payload.summary || null,
          suppliers: payload.suppliers || []
        });
      } else {
        alert(payload.message || 'Failed to load supplier purchase totals');
      }
    } catch (error) {
      console.error('Failed to fetch supplier purchase totals:', error);
      alert('Failed to load supplier purchase totals');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSupplierPurchaseTotals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, topSuppliers]);

  const filteredSuppliers = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return data.suppliers || [];
    return (data.suppliers || []).filter((supplier) =>
      [supplier.name, supplier.company, supplier.email]
        .map((v) => String(v || '').toLowerCase())
        .some((v) => v.includes(q))
    );
  }, [query, data.suppliers]);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading Supplier_purchase_total...</p>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div className="profile-header">
        <div className="profile-title">
          <BarChart3 size={24} />
          <h1>Supplier_purchase_total</h1>
        </div>
      </div>

      <div className="profile-content">
        <div className="profile-section">
          <p style={{ color: '#64748b', fontSize: '0.92rem', marginTop: 0, marginBottom: '1rem' }}>
            See which upstream suppliers receive the highest purchase value so you can negotiate better discounts.
          </p>
          <div className="supplier-summary-grid">
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total suppliers</p>
              <p className="supplier-summary-value">{data.summary?.totalSuppliers ?? 0}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total purchase orders</p>
              <p className="supplier-summary-value">{data.summary?.totalOrders ?? 0}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total purchase value</p>
              <p className="supplier-summary-value">
                Rs {Number(data.summary?.totalPurchaseValue || 0).toLocaleString()}
              </p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total_supplier_COV</p>
              <p className="supplier-summary-value">
                Rs {Number(data.summary?.paidPurchaseValue || 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="profile-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Supplier-wise purchase totals</h2>
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
              <select value={topSuppliers} onChange={(e) => setTopSuppliers(e.target.value)} style={inputStyle}>
                <option value="10">Top 10 suppliers</option>
                <option value="20">Top 20 suppliers</option>
                <option value="50">Top 50 suppliers</option>
                <option value="100">Top 100 suppliers</option>
                <option value="all">All suppliers</option>
              </select>
              <input
                type="text"
                placeholder="Search supplier name, company, email"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ ...inputStyle, minWidth: '280px' }}
              />
            </div>
          </div>

          {filteredSuppliers.length === 0 ? (
            <p style={{ color: '#64748b', marginTop: '1rem' }}>No supplier purchase data found.</p>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
                <thead>
                  <tr>
                    <th style={th}>Supplier</th>
                    <th style={th}>Company</th>
                    <th style={th}>Email</th>
                    <th style={th}>Total Orders</th>
                    <th style={th}>Paid Orders</th>
                    <th style={th}>Total Purchase Value</th>
                    <th style={th}>Supplier_COV</th>
                    <th style={th}>Last Order</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((supplier) => (
                    <tr key={supplier.supplierId}>
                      <td style={td}>{supplier.name || '-'}</td>
                      <td style={td}>{supplier.company || '-'}</td>
                      <td style={td}>{supplier.email || '-'}</td>
                      <td style={td}>{Number(supplier.totalOrders || 0).toLocaleString()}</td>
                      <td style={td}>{Number(supplier.paidOrders || 0).toLocaleString()}</td>
                      <td style={td}>Rs {Number(supplier.totalPurchaseValue || 0).toLocaleString()}</td>
                      <td style={td}>Rs {Number(supplier.paidPurchaseValue || 0).toLocaleString()}</td>
                      <td style={td}>
                        {supplier.lastOrderAt ? new Date(supplier.lastOrderAt).toLocaleString() : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const th = {
  textAlign: 'left',
  borderBottom: '1px solid #e5e7eb',
  padding: '0.6rem',
  fontSize: '0.85rem',
  color: '#475569',
  fontWeight: 700
};

const td = {
  borderBottom: '1px solid #f1f5f9',
  padding: '0.6rem',
  fontSize: '0.9rem',
  color: '#0f172a'
};

const inputStyle = {
  padding: '0.55rem 0.7rem',
  border: '1px solid #e2e8f0',
  borderRadius: 8
};
