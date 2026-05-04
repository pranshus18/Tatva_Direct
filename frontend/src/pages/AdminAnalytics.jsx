import { useEffect, useState } from 'react';
import { getApiUrl } from '../config/api';
import { RefreshCw, Package, TrendingUp } from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import './AdminDashboard.css';

const AdminAnalytics = ({ user }) => {
  const [loading, setLoading] = useState(true);
  const [inventorySummary, setInventorySummary] = useState(null);
  const [channelAnalytics, setChannelAnalytics] = useState(null);
  const [error, setError] = useState('');

  const formatChannelName = (channel) => {
    const channelMap = {
      'b2b_po': 'B2B PO',
      'online_sale': 'Online Sale',
      'offline_sale': 'Offline Sale',
      'unknown': 'Unknown'
    };
    return channelMap[channel] || channel.charAt(0).toUpperCase() + channel.slice(1).replace(/_/g, ' ');
  };

  const fetchAll = async () => {
    setError('');
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const [invRes, chRes] = await Promise.all([
        fetch(getApiUrl('/api/admin/inventory/summary'), {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(getApiUrl('/api/admin/analytics/sales-by-channel'), {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      const invJson = await invRes.json().catch(() => ({}));
      const chJson = await chRes.json().catch(() => ({}));

      if (!invRes.ok || invJson.status !== 'success') {
        throw new Error(invJson.message || 'Failed to load inventory summary');
      }
      if (!chRes.ok || chJson.status !== 'success') {
        throw new Error(chJson.message || 'Failed to load channel analytics');
      }

      setInventorySummary(invJson);
      setChannelAnalytics(chJson);
    } catch (e) {
      setError(e?.message || 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <h1>Admin Analytics</h1>
          <p>Inventory by Outlet and Sales by Channel • Real-time data</p>
        </div>
        <div className="admin-actions">
          <AdminNotifications />
          <button
            className="btn-refresh"
            onClick={fetchAll}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            Refresh
          </button>
          <div className="admin-user-info">
            <span>Welcome, {user?.name}</span>
            <div className="admin-badge">Admin</div>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ marginBottom: '1rem', padding: '1rem', borderRadius: '12px', border: '1px solid #fecaca', background: '#fef2f2', color: '#991b1b' }}>
          {error}
        </div>
      )}

      <div className="admin-analytics-grid">
        <div className="admin-analytics-card">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Package size={20} />
            Inventory by Outlet
          </h2>
          {loading && !inventorySummary ? (
            <p>Loading inventory summary...</p>
          ) : inventorySummary ? (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Outlet</th>
                  <th>Units</th>
                  <th>Value (₹)</th>
                </tr>
              </thead>
              <tbody>
                {(inventorySummary.outlets || []).map((o) => (
                  <tr key={o.outletId || 'unassigned'}>
                    <td>{o.outletName}</td>
                    <td>{o.totalStockQty}</td>
                    <td>{Number(o.totalStockValue || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No inventory data.</p>
          )}
        </div>

        <div className="admin-analytics-card">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={20} />
            Sales by Channel
          </h2>
          {loading && !channelAnalytics ? (
            <p>Loading channel analytics...</p>
          ) : channelAnalytics ? (
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Orders</th>
                  <th>Revenue (₹)</th>
                </tr>
              </thead>
              <tbody>
                {(channelAnalytics.summary?.channels || []).map((c) => (
                  <tr key={c.channel}>
                    <td>{formatChannelName(c.channel)}</td>
                    <td>{c.totalOrders || 0}</td>
                    <td>{Number(c.totalRevenue || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>No channel analytics.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminAnalytics;

