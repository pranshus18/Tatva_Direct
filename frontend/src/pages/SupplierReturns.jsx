import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { resolveApiPath } from '../config/api';
import SupplierOrderScopeNav from '../components/supplier/SupplierOrderScopeNav';
import './SupplierReturns.css';
import {
  SUPPLIER_RETURN_ACTIONS as statusActions,
  RETURN_STATUS_LABEL as STATUS_LABEL,
  labelReturnStatus
} from '../utils/orderReturnUi';
import { formatDateIST, formatDateTimeIST } from '../utils/dateTime';

const MAIN_TABS = [
  { id: 'incoming', label: 'Downstream returns' },
  { id: 'outgoing', label: 'Upstream returns' }
];

const INCOMING_SOURCES = [
  { id: 'all', label: 'All sources' },
  { id: 'customer', label: 'Customers' },
  { id: 'chain', label: 'Chain partners' }
];

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

const mergeById = (lists) => {
  const map = new Map();
  for (const list of lists) {
    for (const row of list || []) {
      if (row?.id) map.set(row.id, row);
    }
  }
  return [...map.values()];
};

const SupplierReturns = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mainTab = searchParams.get('tab') === 'outgoing' ? 'outgoing' : 'incoming';
  const incomingSource = ['all', 'customer', 'chain'].includes(searchParams.get('source'))
    ? searchParams.get('source')
    : 'all';

  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('newest');

  const setMainTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    if (tab === 'incoming') next.delete('tab');
    setSearchParams(next, { replace: true });
  };

  const setIncomingSource = (source) => {
    const next = new URLSearchParams(searchParams);
    if (source === 'all') next.delete('source');
    else next.set('source', source);
    setSearchParams(next, { replace: true });
  };

  const fetchIncoming = useCallback(async () => {
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    const scopes =
      incomingSource === 'all' ? ['customer', 'chain'] : [incomingSource];

    const responses = await Promise.all(
      scopes.map((scope) =>
        fetch(resolveApiPath(`/api/supplier/returns?scope=${scope}`), { headers }).then((r) => r.json())
      )
    );

    const failed = responses.find((data) => data.status !== 'success');
    if (failed) throw new Error(failed.message || 'Failed to fetch returns');

    return mergeById(responses.map((data) => data.returns || [])).sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
    );
  }, [incomingSource]);

  const fetchOutgoing = useCallback(async () => {
    const token = localStorage.getItem('token');
    const res = await fetch(resolveApiPath('/api/dashboard/service-provider/returns?scope=upstream'), {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'success') {
      throw new Error(data.message || 'Failed to fetch upstream returns');
    }
    return data.returns || [];
  }, []);

  const fetchReturns = useCallback(async () => {
    try {
      setLoading(true);
      const rows = mainTab === 'outgoing' ? await fetchOutgoing() : await fetchIncoming();
      setReturns(rows);
    } catch (e) {
      console.error('Fetch supplier returns failed:', e);
      alert(e.message || 'Failed to fetch returns');
      setReturns([]);
    } finally {
      setLoading(false);
    }
  }, [mainTab, fetchIncoming, fetchOutgoing]);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns]);

  const filteredReturns = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    const qNormalized = normalizeSearchText(q);
    return (returns || [])
      .filter((r) => {
        if (statusFilter !== 'all' && r.status !== statusFilter) return false;
        if (!q) return true;
        const rawFields = [
          r.reason,
          r.tracking_id,
          r.id,
          r.order_number,
          r.order_id,
          r.buyer_name,
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
  }, [returns, statusFilter, searchTerm, sortBy]);

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
        body: JSON.stringify({
          status,
          ...(supplierNotes ? { supplierNotes } : {})
        })
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

  const emptyCopy =
    mainTab === 'outgoing'
      ? {
          title: 'No upstream return requests',
          subtitle: 'Request a return from a delivered order under My Upstream Orders.'
        }
      : incomingSource === 'chain'
        ? {
            title: 'No chain return requests',
            subtitle: 'When a downstream partner returns goods from a B2B order, it will show up here.'
          }
        : incomingSource === 'customer'
          ? {
              title: 'No customer return requests',
              subtitle: 'When service providers request returns on retail orders, they will show up here.'
            }
          : {
              title: 'No return requests to process',
              subtitle: 'Incoming returns from customers and chain partners will show up here.'
            };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <div>
          <h1>Returns</h1>
          <p>
            Downstream returns are requests from buyers to you. Upstream returns are requests you raised on
            purchase orders with your suppliers.
          </p>
        </div>
        <button className="btn-secondary" onClick={() => navigate('/supplier-dashboard')}>
          Back
        </button>
      </div>

      <SupplierOrderScopeNav />

      <div className="sr-main-tabs" role="tablist" aria-label="Return direction">
        {MAIN_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={mainTab === tab.id}
            className={`sr-main-tab ${mainTab === tab.id ? 'sr-main-tab--active' : ''}`}
            onClick={() => setMainTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
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
              <div className="sr-toolbar__title">
                {mainTab === 'outgoing' ? 'Upstream return requests you filed' : 'Downstream returns to process'}
              </div>
              <div className="sr-toolbar__subtitle">{filteredReturns.length} shown</div>
            </div>
            <div className="sr-toolbar__controls">
              {mainTab === 'incoming' ? (
                <select
                  value={incomingSource}
                  onChange={(e) => setIncomingSource(e.target.value)}
                  aria-label="Filter by buyer type"
                >
                  {INCOMING_SOURCES.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : null}
              <div className="search-box sr-search">
                <input
                  type="text"
                  placeholder="Search reason, buyer, order #, tracking ID"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">All statuses</option>
                {Object.keys(STATUS_LABEL).map((key) => (
                  <option key={key} value={key}>
                    {STATUS_LABEL[key]}
                  </option>
                ))}
              </select>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
          </div>

          {filteredReturns.length === 0 ? (
            <div className="sr-empty">
              <div className="sr-empty__title">{emptyCopy.title}</div>
              <div className="sr-empty__subtitle">{emptyCopy.subtitle}</div>
              {mainTab === 'outgoing' ? (
                <button
                  type="button"
                  className="btn-secondary sr-empty__action"
                  onClick={() => navigate('/supplier-orders?direction=upstream')}
                >
                  Go to upstream orders
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-secondary sr-empty__action"
                  onClick={() => navigate('/supplier-orders')}
                >
                  Go to downstream orders
                </button>
              )}
            </div>
          ) : (
            <div className="sr-grid">
              {filteredReturns.map((r) => {
                const actions = mainTab === 'incoming' ? statusActions[r.status] || [] : [];
                const created = r.created_at ? new Date(r.created_at) : null;
                const closedUpstream =
                  mainTab === 'outgoing' && r.status === 'closed' && r.metadata?.supplier_closed_at;
                const sourceLabel =
                  r.return_scope === 'chain'
                    ? 'Chain partner'
                    : r.return_scope === 'customer'
                      ? 'Customer'
                      : null;

                return (
                  <div key={r.id} className="sr-card">
                    <div className="sr-card__top">
                      <div className="sr-card__topLeft">
                        <span className={statusPillClass(r.status)}>{labelForStatus(r.status)}</span>
                        {sourceLabel && mainTab === 'incoming' ? (
                          <span className="sr-source-pill">{sourceLabel}</span>
                        ) : null}
                        <span className="sr-id">#{String(r.id || '').slice(0, 8)}</span>
                      </div>
                      <div className="sr-meta">
                        {created ? (
                          <span title={formatDateTimeIST(created, '—')}>Created {formatDateIST(created, '—')}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="sr-card__body">
                      {r.order_number ? (
                        <div className="sr-field">
                          <div className="sr-field__label">Order</div>
                          <button
                            type="button"
                            className="sr-field__value sr-mono sr-order-link"
                            onClick={() =>
                              navigate(
                                mainTab === 'outgoing'
                                  ? `/supplier-orders?direction=upstream&order=${encodeURIComponent(r.order_number)}`
                                  : `/supplier-orders?order=${encodeURIComponent(r.order_number)}`
                              )
                            }
                          >
                            {r.order_number}
                          </button>
                        </div>
                      ) : null}
                      {r.buyer_name && mainTab === 'incoming' ? (
                        <div className="sr-field">
                          <div className="sr-field__label">Buyer</div>
                          <div className="sr-field__value">{r.buyer_name}</div>
                        </div>
                      ) : null}
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
                      {closedUpstream ? (
                        <div className="sr-field sr-field--full">
                          <div className="sr-field__label">Inventory</div>
                          <div className="sr-field__value sr-ack-note">
                            Your upstream partner closed this return on{' '}
                            {formatDateTimeIST(r.metadata.supplier_closed_at, '—')}. Their stock was
                            updated automatically.
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {mainTab === 'incoming' ? (
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
                              {updatingId === r.id ? 'Updating…' : `Mark ${labelReturnStatus(next)}`}
                            </button>
                          ))
                        )}
                      </div>
                    ) : null}
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
