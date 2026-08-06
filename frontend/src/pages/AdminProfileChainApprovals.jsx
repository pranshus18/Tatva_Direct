import { useEffect, useState } from 'react';
import { getApiUrl } from '../config/api';
import { CheckCircle, Clock, ExternalLink, FileText, RefreshCw, User, XCircle } from 'lucide-react';
import { certificateLabelFromUrl } from '../utils/authorizationCertificateUrls';
import { formatDateTimeIST } from '../utils/dateTime';
import './AdminDashboard.css';
import './AdminProfileChainApprovals.css';

function StatusBadge({ status, rejectionReason }) {
  const st = String(status || 'pending');
  return (
    <div className="admin-chain-card-status">
      <span className={`status-badge ${st}`}>
        {st === 'approved' ? <CheckCircle size={14} /> : null}
        {st === 'rejected' ? <XCircle size={14} /> : null}
        {st === 'pending' ? <Clock size={14} /> : null}
        {st}
      </span>
      {st === 'rejected' && rejectionReason ? (
        <div className="admin-chain-rejection-reason">{rejectionReason}</div>
      ) : null}
    </div>
  );
}

function BrandDocuments({ documents = [] }) {
  if (!documents.length) {
    return <span className="admin-chain-docs-empty">No documents uploaded</span>;
  }
  return (
    <ul className="admin-chain-docs-list">
      {documents.map((doc) => (
        <li key={doc.url}>
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-chain-doc-link"
            title={doc.label}
          >
            <FileText size={14} aria-hidden />
            <span className="admin-chain-doc-link-label">
              {certificateLabelFromUrl(doc.url) || doc.fileName || 'Document'}
            </span>
            <ExternalLink size={12} aria-hidden className="admin-chain-doc-external" />
          </a>
        </li>
      ))}
    </ul>
  );
}

const AdminProfileChainApprovals = () => {
  const [brandItems, setBrandItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

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
      setBrandItems(Array.isArray(data.brandItems) ? data.brandItems : []);
    } catch (e) {
      console.error(e);
      setBrandItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const approve = async (item) => {
    const supplierName = item.user?.name || item.user?.email || 'this supplier';
    const brandLabel = item.brand || 'this brand';
    const roleLabel = item.roleLabel || item.role || 'role';
    if (!window.confirm(`Approve ${roleLabel} for brand "${brandLabel}" (${supplierName})?`)) {
      return;
    }

    setActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl(`/api/admin/supplier-chain-requests/${item.requestId}/approve`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryId: item.entryId || undefined,
          brand: item.brand || undefined
        })
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

  const reject = async (item) => {
    const reason = window.prompt(
      `Reason for rejecting ${item.brand || 'brand'} (${item.user?.name || 'supplier'}):`,
      ''
    );
    if (reason == null || !String(reason).trim()) return;

    setActionLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl(`/api/admin/supplier-chain-requests/${item.requestId}/reject`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: String(reason).trim(),
          entryId: item.entryId || undefined,
          brand: item.brand || undefined
        })
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
    <div className="admin-container admin-chain-review-page">
      <div className="admin-header">
        <div>
          <h1>Profile brand assignment</h1>
          <p>One review box per brand — approve or reject each supply-chain role independently</p>
        </div>
        <div className="admin-actions">
          <button className="btn-refresh" type="button" onClick={fetchRequests} disabled={loading || actionLoading}>
            <RefreshCw size={16} className={loading ? 'spinning' : ''} />
            Refresh
          </button>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="admin-chain-filter-select"
            disabled={actionLoading}
          >
            <option value="all">All profiles</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      <div className="admin-content">
        {brandItems.length === 0 ? (
          <div className="empty-state">
            <User size={48} color="#94a3b8" />
            <p>No profile assignments found</p>
            <p className="empty-state-subtitle">
              {statusFilter === 'pending'
                ? 'No brands are waiting for supply-chain role approval.'
                : statusFilter === 'approved'
                  ? 'No approved supplier profile assignments yet.'
                  : statusFilter === 'rejected'
                    ? 'No rejected profile assignments.'
                    : 'Try another filter or refresh.'}
            </p>
          </div>
        ) : (
          <div className="admin-chain-cards-layout">
            <div className="admin-chain-cards-header">
              <span>Supplier</span>
              <span>Requested assignment</span>
              <span>Document</span>
              <span>Status</span>
              <span>Submitted</span>
              <span>Actions</span>
            </div>

            <div className="admin-chain-card-list">
              {brandItems.map((item) => {
                const u = item.user;
                const isPending = item.status === 'pending' && item.canAct;
                return (
                  <article key={item.id} className="admin-chain-brand-card">
                    <div className="admin-chain-brand-card__grid">
                      <section className="admin-chain-brand-card__cell" data-label="Supplier">
                        <div className="admin-chain-supplier-name">{u?.name || '—'}</div>
                        <div className="admin-chain-supplier-email">{u?.email || '—'}</div>
                        {u?.company ? <div className="admin-chain-supplier-company">{u.company}</div> : null}
                      </section>

                      <section className="admin-chain-brand-card__cell" data-label="Requested assignment">
                        {item.roleChange ? (
                          <div className="admin-chain-role-change-banner">
                            <span className="admin-chain-role-change-banner__label">Role change</span>
                            <span>
                              {item.roleChange.fromRoleLabel} → {item.roleChange.toRoleLabel}
                            </span>
                          </div>
                        ) : null}
                        <div className="admin-chain-assignment-item admin-chain-assignment-item--solo">
                          <span className="admin-chain-assignment-role">{item.roleLabel || item.role}</span>
                          <span className="admin-chain-assignment-brand">Brand: {item.brand}</span>
                        </div>
                      </section>

                      <section className="admin-chain-brand-card__cell" data-label="Document">
                        <BrandDocuments documents={item.documents} />
                      </section>

                      <section className="admin-chain-brand-card__cell" data-label="Status">
                        <StatusBadge status={item.status} rejectionReason={item.rejectionReason} />
                      </section>

                      <section className="admin-chain-brand-card__cell" data-label="Submitted">
                        <span className="admin-chain-submitted-cell">
                          {item.submittedAt ? formatDateTimeIST(item.submittedAt, '—') : '—'}
                        </span>
                      </section>

                      <section
                        className="admin-chain-brand-card__cell admin-chain-brand-card__cell--actions"
                        data-label="Actions"
                      >
                        {isPending ? (
                          <div className="admin-chain-actions-wrap">
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={actionLoading}
                              onClick={() => approve(item)}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={actionLoading}
                              onClick={() => reject(item)}
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="admin-chain-actions-empty">—</span>
                        )}
                      </section>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminProfileChainApprovals;
