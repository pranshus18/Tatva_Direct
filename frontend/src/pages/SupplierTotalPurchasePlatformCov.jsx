import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { formatDateTimeIST } from '../utils/dateTime';
import { formatPaymentStatusLabel, isOrderPaid } from '../utils/orderStatusUi';
import './Profile.css';

export default function SupplierTotalPurchasePlatformCov() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchOrders = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl('/api/supplier/upstream/orders?all=true'), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-cache'
      });
      const payload = await response.json();
      if (payload.status === 'success') {
        setOrders(Array.isArray(payload.orders) ? payload.orders : []);
      } else {
        alert(payload.message || 'Failed to load upstream purchases');
      }
    } catch (error) {
      console.error('Failed to fetch upstream purchases:', error);
      alert('Failed to load upstream purchases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const filteredOrders = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    return (orders || []).filter((order) => {
      const status = String(order.status || '').toLowerCase();
      if (statusFilter !== 'all' && status !== statusFilter) return false;
      if (!q) return true;
      return [
        order.orderNumber,
        order.supplierName,
        order.status,
        order.paymentStatus
      ]
        .map((v) => String(v || '').toLowerCase())
        .some((v) => v.includes(q));
    });
  }, [orders, query, statusFilter]);

  const totals = useMemo(() => {
    let totalOrderValue = 0;
    let paidOrderValue = 0;
    let deliveredCount = 0;
    for (const order of filteredOrders) {
      const amount = Number(order.totalAmount || 0);
      totalOrderValue += amount;
      if (isOrderPaid(order)) {
        paidOrderValue += amount;
      }
      if (String(order.status || '').toLowerCase() === 'delivered') {
        deliveredCount += 1;
      }
    }
    return {
      totalOrders: filteredOrders.length,
      totalOrderValue,
      paidOrderValue,
      deliveredCount
    };
  }, [filteredOrders]);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading total purchases…</p>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div className="profile-header">
        <div className="profile-title">
          <BarChart3 size={24} />
          <h1>total_purchase_PlatformCOV</h1>
        </div>
      </div>

      <div className="profile-content">
        <div className="profile-section">
          <p style={{ color: '#64748b', fontSize: '0.92rem', marginTop: 0, marginBottom: '1rem' }}>
            All upstream purchase orders with total purchase value.
          </p>
          <div className="supplier-summary-grid">
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total orders</p>
              <p className="supplier-summary-value">{totals.totalOrders}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total purchase value</p>
              <p className="supplier-summary-value">₹{Number(totals.totalOrderValue).toLocaleString()}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Platform_COV</p>
              <p className="supplier-summary-value">₹{Number(totals.paidOrderValue).toLocaleString()}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Delivered orders</p>
              <p className="supplier-summary-value">{totals.deliveredCount}</p>
            </div>
          </div>
        </div>

        <div className="profile-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Upstream purchase orders</h2>
            <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
                <option value="all">All statuses</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="shipped">Shipped</option>
                <option value="delivered">Delivered</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <input
                type="text"
                placeholder="Search order number, supplier, status"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ ...inputStyle, minWidth: '280px' }}
              />
              <button className="btn-secondary" onClick={fetchOrders}>
                Refresh
              </button>
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <p style={{ color: '#64748b', marginTop: '1rem' }}>No upstream purchase orders found.</p>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1050px' }}>
                <thead>
                  <tr>
                    <th style={th}>Order #</th>
                    <th style={th}>Supplier</th>
                    <th style={th}>Items</th>
                    <th style={th}>Total Amount</th>
                    <th style={th}>Status</th>
                    <th style={th}>Payment</th>
                    <th style={th}>Created At</th>
                    <th style={th}>Updated At</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => (
                    <tr key={order.id}>
                      <td style={td}>{order.orderNumber || '—'}</td>
                      <td style={td}>{order.supplierName || '—'}</td>
                      <td style={td}>{Number(order.itemCount || 0).toLocaleString()}</td>
                      <td style={td}>₹{Number(order.totalAmount || 0).toLocaleString()}</td>
                      <td style={td}>{order.status || '—'}</td>
                      <td style={td}>{formatPaymentStatusLabel(order)}</td>
                      <td style={td}>{order.createdAt ? formatDateTimeIST(order.createdAt, '—') : '—'}</td>
                      <td style={td}>{order.updatedAt ? formatDateTimeIST(order.updatedAt, '—') : '—'}</td>
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
