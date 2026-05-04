import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveApiPath } from '../config/api';
import './SupplierReturns.css';

const statusActions = {
  requested: ['approved', 'rejected'],
  approved: ['picked_up', 'received'],
  picked_up: ['received'],
  received: ['refunded', 'replaced'],
  refunded: ['closed'],
  replaced: ['closed']
};

const STATUS_LABEL = {
  requested: 'Requested',
  approved: 'Approved',
  rejected: 'Rejected',
  picked_up: 'Picked up',
  received: 'Received',
  refunded: 'Refunded',
  replaced: 'Replaced',
  closed: 'Closed'
};

const statusPillClass = (status) => {
  switch (status) {
    case 'requested':
      return 'sr-status sr-status--requested';
    case 'approved':
      return 'sr-status sr-status--approved';
    case 'rejected':
      return 'sr-status sr-status--rejected';
    case 'picked_up':
      return 'sr-status sr-status--picked';
    case 'received':
      return 'sr-status sr-status--received';
    case 'refunded':
    case 'replaced':
      return 'sr-status sr-status--resolved';
    case 'closed':
      return 'sr-status sr-status--closed';
    default:
      return 'sr-status';
  }
};

const labelForStatus = (status) => STATUS_LABEL[status] || String(status || '').replaceAll('_', ' ');

const normalizeSearchText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const SupplierReturns = () => {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const navigate = useNavigate();

  const fetchReturns = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await fetch(resolveApiPath('/api/supplier/returns'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setReturns(data.returns || []);
      } else {
        alert(data.message || 'Failed to fetch returns');
      }
    } catch (e) {
      console.error('Fetch supplier returns failed:', e);
      alert('Failed to fetch returns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReturns();
  }, []);

  const filteredReturns = (returns || [])
    .filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!searchTerm.trim()) return true;
      const q = searchTerm.trim().toLowerCase();
      const qNormalized = normalizeSearchText(q);
      const rawFields = [
        r.reason,
        r.tracking_id,
        r.trackingId,
        r.id,
        r.order_number,
        r.orderNumber,
        r.product_name,
        r.productName,
        r.metadata?.tracking_id,
        r.metadata?.trackingId,
        r.metadata?.orderNumber
      ];
      const haystack = rawFields.map((value) => String(value || '').toLowerCase());
      const normalizedHaystack = haystack.map((value) => normalizeSearchText(value));
      return (
        haystack.some((value) => value.includes(q)) ||
        (!!qNormalized && normalizedHaystack.some((value) => value.includes(qNormalized)))
      );
    })
    .sort((a, b) => {
      const ta = new Date(a.created_at || 0).getTime();
      const tb = new Date(b.created_at || 0).getTime();
      return sortBy === 'oldest' ? ta - tb : tb - ta;
    });

  const updateStatus = async (id, status) => {
    const supplierNotes = window.prompt(`Notes for "${status}" (optional):`, '') || '';
    try {
      setUpdatingId(id);
      const token = localStorage.getItem('token');
      const res = await fetch(resolveApiPath(`/api/supplier/returns/${id}/status`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status, supplierNotes })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        await fetchReturns();
      } else {
        alert(data.message || 'Failed to update return');
      }
    } catch (e) {
      console.error('Update supplier return failed:', e);
      alert('Failed to update return');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          <h1>Return Requests</h1>
          <p>Process incoming return requests from service providers</p>
        </div>
        <button className="btn-secondary" onClick={() => navigate('/supplier-dashboard')}>Back</button>
      </div>

      {loading ? (
        <div className="dashboard-loading">
          <div className="spinner" />
          <p>Loading return requests...</p>
        </div>
      ) : (
        <div className="dashboard-section">
          <div className="sr-toolbar">
            <div className="sr-toolbar__left">
              <div className="sr-toolbar__title">Requests</div>
              <div className="sr-toolbar__subtitle">{filteredReturns.length} shown</div>
            </div>
            <div className="sr-toolbar__controls">
              <div className="search-box sr-search">
                <input
                  type="text"
                  placeholder="Search reason, tracking ID, return ID"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                <option value="requested">Requested</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="picked_up">Picked up</option>
                <option value="received">Received</option>
                <option value="refunded">Refunded</option>
                <option value="replaced">Replaced</option>
                <option value="closed">Closed</option>
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>

          {filteredReturns.length === 0 ? (
            <div className="sr-empty">
              <div className="sr-empty__title">No return requests</div>
              <div className="sr-empty__subtitle">When service providers request returns, they’ll show up here.</div>
            </div>
          ) : (
            <div className="sr-grid">
              {filteredReturns.map((r) => {
                const actions = statusActions[r.status] || [];
                const created = r.created_at ? new Date(r.created_at) : null;
                return (
                  <div key={r.id} className="sr-card">
                    <div className="sr-card__top">
                      <div className="sr-card__topLeft">
                        <span className={statusPillClass(r.status)}>{labelForStatus(r.status)}</span>
                        <span className="sr-id">#{String(r.id || '').slice(0, 8)}</span>
                      </div>
                      <div className="sr-meta">
                        {created ? (
                          <span title={created.toLocaleString()}>Created {created.toLocaleDateString()}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="sr-card__body">
                      <div className="sr-field">
                        <div className="sr-field__label">Reason</div>
                        <div className="sr-field__value">{r.reason || '—'}</div>
                      </div>
                      <div className="sr-field">
                        <div className="sr-field__label">Quantity</div>
                        <div className="sr-field__value">{r.quantity ?? '—'}</div>
                      </div>
                      <div className="sr-field">
                        <div className="sr-field__label">Tracking ID</div>
                        <div className="sr-field__value sr-mono">{r.tracking_id || '—'}</div>
                      </div>
                    </div>

                    <div className="sr-card__actions">
                      {actions.length === 0 ? (
                        <div className="sr-actionsHint">No actions available for this status.</div>
                      ) : (
                        actions.map((next) => (
                          <button
                            key={next}
                            className="btn-secondary sr-actionBtn"
                            disabled={updatingId === r.id}
                            onClick={() => updateStatus(r.id, next)}
                          >
                            {updatingId === r.id ? 'Updating…' : `Mark ${labelForStatus(next)}`}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SupplierReturns;
