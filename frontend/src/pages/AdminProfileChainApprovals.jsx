import { useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '../config/api';
import { CheckCircle, Clock, ExternalLink, FileText, RefreshCw, User, XCircle } from 'lucide-react';
import './AdminDashboard.css';

const ROLE_LABELS = {
  manufacturer: 'Manufacturer (MGF)',
  stockist: 'Stockist',
  regional_distributor: 'Regional distributor',
  local_distributor: 'Local distributor',
  dealer: 'Dealer',
  retailer: 'Retailer'
};

function summarizePayload(payload) {
  if (!payload || typeof payload !== 'object') return '—';
  const entries = Array.isArray(payload.companyInfoEntries) ? payload.companyInfoEntries : [];
  if (entries.length > 0) {
    return entries
      .map((e) => {
        const r = ROLE_LABELS[e.role] || e.role || '—';
        const b = String(e.brands || '').trim() || '—';
        return `${r}: ${b.slice(0, 120)}${b.length > 120 ? '…' : ''}`;
      })
      .join(' • ');
  }
  const r = ROLE_LABELS[payload.supplierRole] || payload.supplierRole || '—';
  const b = String(payload.brands || '').trim() || '—';
  return `${r} — brands: ${b.slice(0, 160)}${b.length > 160 ? '…' : ''}`;
}

/** Certificates uploaded with the pending supply-chain request (per entry + legacy). */
function documentsFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const docs = [];
  const seen = new Set();
  const entries = Array.isArray(payload.companyInfoEntries) ? payload.companyInfoEntries : [];

  const addDoc = (url, label) => {
    const value = String(url || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    docs.push({ url: value, label });
  };

  for (const e of entries) {
    const role = ROLE_LABELS[e.role] || e.role || 'Role';
    const brands = String(e.brands || '').trim();
    const label = brands ? `${role} — ${brands}` : role;
    const urls = Array.isArray(e?.authorizationCertificateUrls)
      ? e.authorizationCertificateUrls
      : [];
    if (urls.length > 0) {
      urls.forEach((url) => addDoc(url, label));
    } else {
      addDoc(e?.authorizationCertificateUrl, label);
    }
  }

  const legacyUrls = Array.isArray(payload.authorizationCertificateUrls)
    ? payload.authorizationCertificateUrls
    : [];
  if (legacyUrls.length > 0) {
    legacyUrls.forEach((url) => addDoc(url, 'Profile certificate'));
  } else {
    addDoc(payload.authorizationCertificateUrl, 'Profile certificate');
  }

  return docs;
}

function RequestDocumentsCell({ payload }) {
  const docs = documentsFromPayload(payload);
  if (docs.length === 0) {
    return <span className="admin-chain-docs-empty">No documents uploaded</span>;
  }
  return (
    <ul className="admin-chain-docs-list">
      {docs.map((doc) => (
        <li key={doc.url}>
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-chain-doc-link"
            title={doc.label}
          >
            <FileText size={14} aria-hidden />
            <span className="admin-chain-doc-link-label">{doc.label}</span>
            <ExternalLink size={12} aria-hidden className="admin-chain-doc-external" />
          </a>
        </li>
      ))}
    </ul>
  );
}

const AdminProfileChainApprovals = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending');

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return requests;
    return (requests || []).filter((r) => String(r?.status || '') === statusFilter);
  }, [requests, statusFilter]);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const q = statusFilter === 'all' ? 'all' : statusFilter;
      const res = await fetch(getApiUrl(`/api/admin/supplier-chain-requests?status=${encodeURIComponent(q)}`), {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (res.status === 401) {
        window.location.href = '/admin-login';
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') {
        throw new Error(data.message || res.statusText);
      }
      setRequests(data.requests || []);
    } catch (e) {
      console.error(e);
      setRequests([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const approve = async (row) => {
    if (!window.confirm(`Approve supply-chain profile for ${row.user?.name || row.user?.email || 'this supplier'}?`)) return;
    setActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl(`/api/admin/supplier-chain-requests/${row.id}/approve`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') throw new Error(data.message || 'Approve failed');
      await fetchRequests();
    } catch (e) {
      alert(e.message || 'Failed to approve');
    } finally {
      setActionLoading(false);
    }
  };

  const reject = async (row) => {
    const reason = window.prompt('Reason for rejection (shown to supplier):', '');
    if (reason == null || !String(reason).trim()) return;
    setActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl(`/api/admin/supplier-chain-requests/${row.id}/reject`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: String(reason).trim() })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.status !== 'success') throw new Error(data.message || 'Reject failed');
      await fetchRequests();
    } catch (e) {
      alert(e.message || 'Failed to reject');
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-loading">
        <div className="spinner" />
        <p>Loading profile assignments…</p>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <h1>Profile brand assignment</h1>
          <p>Approve retailer/dealer (and other chain) roles and brands before they take effect for each supplier</p>
        </div>
        <div className="admin-actions">
          <button className="btn-refresh" type="button" onClick={fetchRequests} disabled={loading || actionLoading}>
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            Refresh
          </button>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              padding: '0.75rem',
              border: '1px solid #e5e7eb',
              borderRadius: 8,
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

      <div className="admin-content">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <User size={48} color="#94a3b8" />
            <p>No requests</p>
            <p className="empty-state-subtitle">
              {statusFilter === 'pending'
                ? 'No suppliers are waiting for chain profile approval.'
                : 'Try another filter or refresh.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-table admin-chain-approvals-table">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Requested assignment</th>
                  <th>Document</th>
                  <th>Status</th>
                  <th>Submitted</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const st = String(row.status || 'pending');
                  const u = row.user;
                  return (
                    <tr key={row.id}>
                      <td>
                        <div style={{ fontWeight: 700, color: '#1e293b' }}>{u?.name || '—'}</div>
                        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{u?.email || '—'}</div>
                        {u?.company ? (
                          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>{u.company}</div>
                        ) : null}
                      </td>
                      <td style={{ maxWidth: 420, fontSize: '0.9rem', color: '#334155', lineHeight: 1.4 }}>
                        {summarizePayload(row.payload)}
                      </td>
                      <td className="admin-chain-docs-cell">
                        <RequestDocumentsCell payload={row.payload} />
                      </td>
                      <td>
                        <span className={`status-badge ${st}`}>
                          {st === 'approved' ? <CheckCircle size={14} /> : null}
                          {st === 'rejected' ? <XCircle size={14} /> : null}
                          {st === 'pending' ? <Clock size={14} /> : null}
                          {st}
                        </span>
                        {st === 'rejected' && row.rejection_reason ? (
                          <div style={{ fontSize: '0.8rem', color: '#b91c1c', marginTop: 6 }}>{row.rejection_reason}</div>
                        ) : null}
                      </td>
                      <td style={{ fontSize: '0.85rem', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                      </td>
                      <td>
                        {st === 'pending' ? (
                          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={actionLoading}
                              onClick={() => approve(row)}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={actionLoading}
                              onClick={() => reject(row)}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span style={{ color: '#94a3b8', fontSize: '0.85rem' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminProfileChainApprovals;
