import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { formatDateTimeIST } from '../utils/dateTime';
import './Profile.css';

export default function SupplierBuyerPurchases() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ summary: null, buyers: [] });
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [topBuyers, setTopBuyers] = useState('20');
  const [showBuyerName, setShowBuyerName] = useState(true);
  const [thresholdDrafts, setThresholdDrafts] = useState({});
  const [savingThresholdId, setSavingThresholdId] = useState(null);

  const fetchBuyerPurchases = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      if (fromDate) params.set('from', `${fromDate}T00:00:00.000Z`);
      if (toDate) params.set('to', `${toDate}T23:59:59.999Z`);
      if (topBuyers && topBuyers !== 'all') params.set('top', topBuyers);

      const endpoint = `/api/supplier/analytics/buyer-purchases${
        params.toString() ? `?${params.toString()}` : ''
      }`;
      const response = await fetch(getApiUrl(endpoint), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const payload = await response.json();
      if (payload.status === 'success') {
        const buyers = payload.buyers || [];
        setData({
          summary: payload.summary || null,
          buyers
        });
        const drafts = {};
        buyers.forEach((buyer) => {
          if (buyer.buyerId === 'walk_in') return;
          drafts[buyer.buyerId] = String(buyer.paylaterThreshold ?? 0);
        });
        setThresholdDrafts(drafts);
      } else {
        alert(payload.message || 'Failed to load sales');
      }
    } catch (error) {
      console.error('Failed to fetch buyer purchases:', error);
      alert('Failed to load sales');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBuyerPurchases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate, topBuyers]);

  const savePaylaterThreshold = async (buyer) => {
    if (buyer.buyerId === 'walk_in' || buyer.buyerType === 'walk_in') return;
    const raw = thresholdDrafts[buyer.buyerId];
    const threshold = Number(raw);
    if (!Number.isFinite(threshold) || threshold < 0) {
      alert('Enter a valid pay-later minimum (₹0 or more).');
      return;
    }
    const buyerUserId = buyer.linkedBuyerUserId || null;
    const customerId = buyer.linkedCustomerId || null;
    const customerPhone = buyer.phone || null;
    if (!buyerUserId && !customerId && !customerPhone) {
      alert('Cannot set pay-later threshold for this buyer — link a user profile or phone first.');
      return;
    }
    const creditLimit = Number(buyer.creditLimit || 0);
    if (threshold > 0 && creditLimit <= 0) {
      alert(
        'Set a credit limit (₹) for this buyer on Credit on account first, then set the pay-later minimum.'
      );
      return;
    }
    try {
      setSavingThresholdId(buyer.buyerId);
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/credit-accounts'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          buyerUserId,
          customerId,
          customerPhone,
          creditLimit,
          paylaterThreshold: threshold,
          creditPeriodDays: buyer.creditPeriodDays || 30,
          isEnabled: true
        })
      });
      const payload = await res.json();
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Failed to save pay-later threshold');
      }
      await fetchBuyerPurchases();
    } catch (e) {
      alert(e.message || 'Failed to save pay-later threshold');
    } finally {
      setSavingThresholdId(null);
    }
  };

  const filteredBuyers = useMemo(() => {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return data.buyers || [];
    return (data.buyers || []).filter((buyer) =>
      [buyer.name, buyer.company, buyer.phone]
        .map((v) => String(v || '').toLowerCase())
        .some((v) => v.includes(q))
    );
  }, [query, data.buyers]);

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading sales...</p>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div className="profile-header">
        <div className="profile-title">
          <BarChart3 size={24} />
          <h1>Sales</h1>
        </div>
      </div>

      <div className="profile-content">
        <div className="profile-section">
          <p style={{ color: '#64748b', fontSize: '0.92rem', marginTop: 0, marginBottom: '0.75rem' }}>
            Gross sales are order totals (online + offline) excluding cancelled/returned orders. Period
            columns follow your date filter; all-time columns include every matching order. Net revenue
            is paid sales after returns. Set{' '}
            <strong>Pay-later minimum</strong> per customer: pay later unlocks once{' '}
            <strong>all-time net revenue</strong> (paid sales after returns) reaches that amount and a credit
            limit is configured. Manage limits on{' '}
            <Link to="/supplier-credit-accounts">Credit on account</Link>.
          </p>
          <div className="supplier-summary-grid">
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total buyers</p>
              <p className="supplier-summary-value">{data.summary?.totalBuyers ?? 0}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total orders</p>
              <p className="supplier-summary-value">{data.summary?.totalOrders ?? 0}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">
                Gross sales {data.summary?.hasDateFilter ? '(period)' : '(all time)'}
              </p>
              <p className="supplier-summary-value">
                ₹{Number(data.summary?.totalOrderValue || 0).toLocaleString()}
              </p>
            </div>
            {data.summary?.hasDateFilter ? (
              <div className="supplier-summary-card">
                <p className="supplier-summary-label">Gross sales (all time)</p>
                <p className="supplier-summary-value">
                  ₹{Number(data.summary?.totalAllTimeGrossSales || 0).toLocaleString()}
                </p>
              </div>
            ) : null}
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">
                Net revenue {data.summary?.hasDateFilter ? '(period)' : '(all time)'}
              </p>
              <p className="supplier-summary-value">
                ₹{Number(data.summary?.totalNetRevenue || 0).toLocaleString()}
              </p>
            </div>
            {data.summary?.hasDateFilter ? (
              <div className="supplier-summary-card">
                <p className="supplier-summary-label">Net revenue (all time)</p>
                <p className="supplier-summary-value">
                  ₹{Number(data.summary?.totalAllTimeNetRevenue || 0).toLocaleString()}
                </p>
              </div>
            ) : null}
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Online net revenue (period)</p>
              <p className="supplier-summary-value">
                ₹{Number(data.summary?.totalOnlineNetRevenue || 0).toLocaleString()}
              </p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Offline net revenue (period)</p>
              <p className="supplier-summary-value">
                ₹{Number(data.summary?.totalOfflineNetRevenue || 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        <div className="profile-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.8rem', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Buyer-wise details</h2>
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
              <select value={topBuyers} onChange={(e) => setTopBuyers(e.target.value)} style={inputStyle}>
                <option value="10">Top 10 buyers</option>
                <option value="20">Top 20 buyers</option>
                <option value="50">Top 50 buyers</option>
                <option value="100">Top 100 buyers</option>
                <option value="all">All buyers</option>
              </select>
              <input
                type="text"
                placeholder="Search buyer name, company, phone"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ ...inputStyle, minWidth: '280px' }}
              />
              <label
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  padding: '0.45rem 0.65rem',
                  border: '1px solid #e2e8f0',
                  borderRadius: 8,
                  color: '#334155',
                  fontSize: '0.85rem',
                  background: '#fff'
                }}
              >
                <input
                  type="checkbox"
                  checked={showBuyerName}
                  onChange={(e) => setShowBuyerName(e.target.checked)}
                />
                Show buyer name
              </label>
            </div>
          </div>

          {filteredBuyers.length === 0 ? (
            <p style={{ color: '#64748b', marginTop: '1rem' }}>No sales data found.</p>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1400px' }}>
                <thead>
                  <tr>
                    {showBuyerName ? <th style={th}>Buyer</th> : null}
                    <th style={th}>Company</th>
                    <th style={th}>Phone</th>
                    <th style={th}>Total Orders</th>
                    <th style={th}>Paid Orders</th>
                    <th style={th}>Gross sales (period)</th>
                    <th style={th}>Gross sales (all time)</th>
                    <th style={th}>Pay later eligible</th>
                    <th style={th}>Online sales</th>
                    <th style={th}>Online net (period)</th>
                    <th style={th}>Offline sales</th>
                    <th style={th}>Offline net (period)</th>
                    <th style={th}>Net revenue (period)</th>
                    <th style={th}>All-time net revenue</th>
                    <th style={th}>Pay-later minimum (₹)</th>
                    <th style={th}>Last Order</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBuyers.map((buyer) => (
                    <tr key={buyer.buyerId}>
                      {showBuyerName ? (
                        <td style={td}>
                          {buyer.name
                            ? buyer.name
                            : buyer.buyerId === 'walk_in' || buyer.buyerType === 'walk_in'
                              ? 'Walk-in (no customer)'
                              : '—'}
                        </td>
                      ) : null}
                      <td style={td}>{buyer.company || buyer.name || '—'}</td>
                      <td style={td}>{buyer.phone || '—'}</td>
                      <td style={td}>{Number(buyer.totalOrders || 0).toLocaleString()}</td>
                      <td style={td}>{Number(buyer.paidOrders || 0).toLocaleString()}</td>
                      <td style={td}>
                        ₹{Number(buyer.totalOrderValue || 0).toLocaleString()}
                        <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>
                          {fromDate || toDate
                            ? `${fromDate || '…'} to ${toDate || '…'} · online+offline`
                            : 'all time · online+offline'}
                        </span>
                      </td>
                      <td style={td}>
                        ₹{Number(buyer.allTimeGrossSales ?? buyer.combinedSalesTotal ?? buyer.totalOrderValue ?? 0).toLocaleString()}
                        <span style={{ display: 'block', fontSize: '0.75rem', color: '#64748b' }}>
                          all time · online+offline · excl. cancelled/returned
                        </span>
                      </td>
                      <td style={td}>
                        {buyer.payLaterEligible ? (
                          <span style={{ color: '#15803d', fontWeight: 600 }}>Yes</span>
                        ) : buyer.paylaterThreshold > 0 ? (
                          <span style={{ color: '#b45309' }}>
                            No (need net revenue ₹{Number(buyer.paylaterThreshold).toLocaleString()} ·
                            current ₹
                            {Number(buyer.allTimeNetRevenue ?? 0).toLocaleString()}
                            )
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={td}>
                        {Number(buyer.onlineOrders || 0).toLocaleString()} orders
                        {Number(buyer.onlineOrderValue || 0) > 0 ? (
                          <>
                            {' '}
                            · ₹{Number(buyer.onlineOrderValue || 0).toLocaleString()}
                          </>
                        ) : null}
                      </td>
                      <td style={td}>₹{Number(buyer.onlineNetRevenue || 0).toLocaleString()}</td>
                      <td style={td}>
                        {Number(buyer.offlineOrders || 0).toLocaleString()} orders
                        {Number(buyer.offlineOrderValue || 0) > 0 ? (
                          <>
                            {' '}
                            · ₹{Number(buyer.offlineOrderValue || 0).toLocaleString()}
                          </>
                        ) : null}
                      </td>
                      <td style={td}>₹{Number(buyer.offlineNetRevenue || 0).toLocaleString()}</td>
                      <td style={tdStrong}>₹{Number(buyer.netRevenue || 0).toLocaleString()}</td>
                      <td style={tdStrong}>₹{Number(buyer.allTimeNetRevenue || 0).toLocaleString()}</td>
                      <td style={td}>
                        {buyer.buyerId === 'walk_in' || buyer.buyerType === 'walk_in' ? (
                          '—'
                        ) : (
                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={thresholdDrafts[buyer.buyerId] ?? '0'}
                              onChange={(e) =>
                                setThresholdDrafts((prev) => ({
                                  ...prev,
                                  [buyer.buyerId]: e.target.value
                                }))
                              }
                              style={{ ...inputStyle, width: '100px', padding: '0.35rem 0.5rem' }}
                              aria-label={`Pay-later minimum for ${buyer.name}`}
                            />
                            <button
                              type="button"
                              style={saveBtnStyle}
                              disabled={savingThresholdId === buyer.buyerId}
                              onClick={() => savePaylaterThreshold(buyer)}
                            >
                              {savingThresholdId === buyer.buyerId ? '…' : 'Save'}
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={td}>
                        {buyer.lastOrderAt ? formatDateTimeIST(buyer.lastOrderAt, '—') : '—'}
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

const tdStrong = {
  ...td,
  fontWeight: 700
};

const inputStyle = {
  padding: '0.55rem 0.7rem',
  border: '1px solid #e2e8f0',
  borderRadius: 8
};

const saveBtnStyle = {
  padding: '0.35rem 0.65rem',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  background: '#f8fafc',
  fontSize: '0.8rem',
  fontWeight: 600,
  cursor: 'pointer'
};
