import { useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '../config/api';
import { CheckCircle, Clock, Copy, RefreshCw, Search, Tag, XCircle } from 'lucide-react';
import { formatDateTimeIST } from '../utils/dateTime';
import './AdminDashboard.css';

const AdminBrandApprovals = () => {
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending'); // pending | approved | rejected | all
  const [approvedSearch, setApprovedSearch] = useState('');

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return brands;
    return (brands || []).filter((b) => String(b?.status || 'pending') === statusFilter);
  }, [brands, statusFilter]);

  const approvedBrands = useMemo(() => {
    const q = String(approvedSearch || '').trim().toLowerCase();
    return (brands || [])
      .filter((b) => String(b?.status || 'pending') === 'approved')
      .filter((b) => (q ? String(b?.name || '').toLowerCase().includes(q) : true))
      .sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
  }, [brands, approvedSearch]);

  const fetchBrands = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      // Always fetch ALL brands so approved ones are available as reference,
      // even while the table is filtered to "Pending".
      const url = getApiUrl('/api/admin/brands/all');

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        cache: 'no-store'
      });

      if (!response.ok) {
        if (response.status === 401) {
          window.location.href = '/admin-login';
          return;
        }
        const err = await response.json().catch(() => ({}));
        throw new Error(err.message || response.statusText);
      }

      const data = await response.json();
      setBrands(data.brands || []);
    } catch (e) {
      console.error('Failed to fetch brands:', e);
      setBrands([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBrands();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approveBrand = async (brand) => {
    if (!confirm(`Approve brand "${brand?.name}"?`)) return;
    setActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/admin/brands/${brand.id}/approve`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to approve brand');
      }
      await fetchBrands();
    } catch (e) {
      alert(e.message || 'Failed to approve brand');
    } finally {
      setActionLoading(false);
    }
  };

  const rejectBrand = async (brand) => {
    const reason = prompt(`Reject brand "${brand?.name}". Enter reason:`);
    if (!reason || !reason.trim()) return;
    setActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(getApiUrl(`/api/admin/brands/${brand.id}/reject`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: reason.trim() })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to reject brand');
      }
      await fetchBrands();
    } catch (e) {
      alert(e.message || 'Failed to reject brand');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <div className="spinner" />
        <p>Loading brand approvals...</p>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <h1>Brand Approvals</h1>
          <p>Approve brands before suppliers can submit products</p>
        </div>
        <div className="admin-actions">
          <button className="btn-refresh" onClick={fetchBrands} disabled={loading || actionLoading}>
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            Refresh
          </button>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '0.75rem',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              fontSize: '0.875rem',
              background: 'white'
            }}
            disabled={actionLoading}
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <div className="admin-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <Tag size={48} color="#94a3b8" />
            <p>No brands found</p>
            <p className="empty-state-subtitle">
              {statusFilter === 'pending'
                ? 'No pending brand requests right now.'
                : 'Try changing the status filter.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table" style={{ minWidth: '900px' }}>
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Status</th>
                  <th>Requested by</th>
                  <th>Requested at</th>
                  <th>Rejection reason</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => {
                  const status = String(b?.status || 'pending');
                  const requester = b?.requester;
                  return (
                    <tr key={b.id}>
                      <td style={{ fontWeight: 700, color: '#1e293b' }}>{b.name}</td>
                      <td>
                        <span className={`status-badge ${status}`}>
                          {status === 'approved' ? <CheckCircle size={14} /> : null}
                          {status === 'rejected' ? <XCircle size={14} /> : null}
                          {status === 'pending' ? <Clock size={14} /> : null}
                          {status}
                        </span>
                      </td>
                      <td>
                        {requester
                          ? `${requester.name || 'User'}${requester.email ? ` (${requester.email})` : ''}`
                          : b.requested_by || '-'}
                      </td>
                      <td>{b.requested_at ? formatDateTimeIST(b.requested_at, '-') : '-'}</td>
                      <td style={{ color: status === 'rejected' ? '#b91c1c' : '#64748b' }}>
                        {b.rejection_reason || '-'}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                          {status !== 'approved' && (
                            <button
                              className="btn-primary"
                              onClick={() => approveBrand(b)}
                              disabled={actionLoading}
                              style={{ background: 'linear-gradient(135deg, #059669, #047857)' }}
                            >
                              <CheckCircle size={16} />
                              Approve
                            </button>
                          )}
                          {status !== 'rejected' && (
                            <button
                              className="btn-secondary"
                              onClick={() => rejectBrand(b)}
                              disabled={actionLoading}
                              style={{
                                background: 'rgba(239, 68, 68, 0.08)',
                                borderColor: 'rgba(239, 68, 68, 0.25)',
                                color: '#dc2626'
                              }}
                            >
                              <XCircle size={16} />
                              Reject
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Approved Brands reference (always visible, full width below table) */}
        <div
          style={{
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid rgba(226,232,240,0.9)',
            borderRadius: '16px',
            padding: '1.25rem',
            boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
            <div>
              <h3 style={{ margin: 0, color: '#0f172a' }}>Approved brands</h3>
              <p style={{ margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                Reference list for admins and suppliers
              </p>
            </div>
            <button
              type="button"
              className="btn-secondary"
              disabled={approvedBrands.length === 0}
              onClick={async () => {
                try {
                  const text = approvedBrands.map((b) => b.name).join('\n');
                  await navigator.clipboard.writeText(text);
                } catch {
                  alert('Copy failed. Your browser may block clipboard access.');
                }
              }}
              style={{ whiteSpace: 'nowrap' }}
              title="Copy approved brands"
            >
              <Copy size={16} aria-hidden />
              Copy
            </button>
          </div>

          <div style={{ marginTop: '1rem' }}>
            <div
              className="input-wrapper"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.65rem 0.8rem',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                background: 'white'
              }}
            >
              <Search size={16} color="#64748b" aria-hidden />
              <input
                value={approvedSearch}
                onChange={(e) => setApprovedSearch(e.target.value)}
                placeholder="Search approved brands…"
                style={{
                  border: 'none',
                  outline: 'none',
                  width: '100%',
                  fontSize: '0.95rem',
                  background: 'transparent'
                }}
              />
              <span style={{ color: '#94a3b8', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                {approvedBrands.length}
              </span>
            </div>
          </div>

          <div style={{ marginTop: '0.9rem', maxHeight: '55vh', overflow: 'auto' }}>
            {approvedBrands.length === 0 ? (
              <div style={{ padding: '0.75rem 0', color: '#64748b' }}>
                No approved brands yet.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {approvedBrands.map((b) => {
                  const requester = b?.requester;
                  const approver = b?.approver;
                  return (
                    <div
                      key={b.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(140px, 1.2fr) minmax(180px, 1.5fr) minmax(160px, 1fr) minmax(160px, 1fr)',
                        gap: '0.75rem 1rem',
                        alignItems: 'center',
                        padding: '0.75rem 1rem',
                        borderRadius: '10px',
                        background: 'rgba(16,185,129,0.06)',
                        border: '1px solid rgba(16,185,129,0.18)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                        <CheckCircle size={16} color="#059669" aria-hidden style={{ flexShrink: 0 }} />
                        <span
                          style={{
                            fontWeight: 700,
                            color: '#065f46',
                            fontSize: '0.95rem',
                            wordBreak: 'break-word'
                          }}
                        >
                          {b.name}
                        </span>
                      </div>
                      <div style={{ color: '#475569', fontSize: '0.875rem', minWidth: 0, wordBreak: 'break-word' }}>
                        <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block' }}>Requested by</span>
                        {requester
                          ? `${requester.name || 'User'}${requester.email ? ` (${requester.email})` : ''}`
                          : b.requested_by || '-'}
                      </div>
                      <div style={{ color: '#475569', fontSize: '0.875rem' }}>
                        <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block' }}>Requested at</span>
                        {b.requested_at ? formatDateTimeIST(b.requested_at, '-') : '-'}
                      </div>
                      <div style={{ color: '#475569', fontSize: '0.875rem', minWidth: 0, wordBreak: 'break-word' }}>
                        <span style={{ color: '#94a3b8', fontSize: '0.75rem', display: 'block' }}>Approved</span>
                        {b.approved_at ? formatDateTimeIST(b.approved_at, '-') : '-'}
                        {approver?.name ? ` · ${approver.name}` : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdminBrandApprovals;

