import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { resolveApiPath } from '../config/api';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RotateCcw } from 'lucide-react';
import './ServiceProviderReturns.css';

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
      return 'spr-status spr-status--requested';
    case 'approved':
      return 'spr-status spr-status--approved';
    case 'rejected':
      return 'spr-status spr-status--rejected';
    case 'picked_up':
      return 'spr-status spr-status--picked';
    case 'received':
      return 'spr-status spr-status--received';
    case 'refunded':
    case 'replaced':
      return 'spr-status spr-status--resolved';
    case 'closed':
      return 'spr-status spr-status--closed';
    default:
      return 'spr-status';
  }
};

const labelForStatus = (status) => STATUS_LABEL[status] || String(status || '').replaceAll('_', ' ');

const normalizeSearchText = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const ServiceProviderReturns = () => {
  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('newest');
  const [acknowledgingId, setAcknowledgingId] = useState(null);
  const navigate = useNavigate();

  const fetchReturns = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('token');
      const res = await fetch(resolveApiPath('/api/dashboard/service-provider/returns'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setReturns(data.returns || []);
      } else {
        alert(data.message || 'Failed to fetch returns');
      }
    } catch (e) {
      console.error('Fetch service-provider returns failed:', e);
      alert('Failed to fetch returns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReturns();
  }, []);

  const acknowledgeClosure = async (returnId) => {
    try {
      setAcknowledgingId(returnId);
      const token = localStorage.getItem('token');
      const res = await fetch(
        resolveApiPath(`/api/dashboard/service-provider/returns/${returnId}/acknowledge-closure`),
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          }
        }
      );
      const data = await res.json();
      if (!res.ok || data.status !== 'success') {
        alert(data.message || 'Could not confirm return completion.');
        return;
      }
      const inv = data.inventory;
      if (inv?.already) {
        alert('Inventory was already updated for this return.');
      } else if (inv?.skipped && inv?.reason === 'scrap') {
        alert('This return was marked as scrap — inventory was not increased.');
      } else if (inv?.skipped) {
        alert('Nothing further to add to inventory for this return.');
      } else if (inv?.ok && inv?.qtyToAdd != null) {
        alert(`Confirmed. ${inv.qtyToAdd} unit(s) were added back to the supplier’s stock.`);
      } else {
        alert('Return completion confirmed.');
      }
      await fetchReturns();
    } catch (e) {
      console.error('acknowledgeClosure failed:', e);
      alert('Could not confirm return completion. Please try again.');
    } finally {
      setAcknowledgingId(null);
    }
  };

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

  return (
    <SpPageLayout showStepper={false}>
      <SpPageHeader
        title="My Returns"
        description="Track return requests raised on your orders"
        icon={RotateCcw}
        actions={<Button variant="outline" onClick={() => navigate('/your-orders')}>View orders</Button>}
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="dashboard-section !p-0">
          <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
            <div className="min-w-[200px] flex-1">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Search</p>
              <Input
                placeholder="Reason, tracking ID, return ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Status</p>
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
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
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Sort</p>
              <select className="h-10 rounded-md border border-input bg-background px-3 text-sm" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </div>
            <p className="w-full text-sm text-muted-foreground sm:ml-auto sm:w-auto">{filteredReturns.length} shown</p>
          </div>

          {filteredReturns.length === 0 ? (
            <div className="spr-empty">
              <div className="spr-empty__title">No return requests</div>
              <div className="spr-empty__subtitle">When you request a return on an order, it will show up here.</div>
            </div>
          ) : (
            <div className="spr-grid">
              {filteredReturns.map((r) => {
                const created = r.created_at ? new Date(r.created_at) : null;
                return (
                  <div key={r.id} className="spr-card">
                    <div className="spr-card__top">
                      <div className="spr-card__topLeft">
                        <span className={statusPillClass(r.status)}>{labelForStatus(r.status)}</span>
                        <span className="spr-id">#{String(r.id || '').slice(0, 8)}</span>
                      </div>
                      <div className="spr-meta">
                        {created ? (
                          <span title={created.toLocaleString()}>Created {created.toLocaleDateString()}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="spr-card__body">
                      <div className="spr-field">
                        <div className="spr-field__label">Reason</div>
                        <div className="spr-field__value">{r.reason || '—'}</div>
                      </div>
                      <div className="spr-field">
                        <div className="spr-field__label">Quantity</div>
                        <div className="spr-field__value">{r.quantity ?? '—'}</div>
                      </div>
                      <div className="spr-field">
                        <div className="spr-field__label">Tracking ID</div>
                        <div className="spr-field__value spr-mono">{r.tracking_id || '—'}</div>
                      </div>
                      {r.status === 'closed' ? (
                        <div className="spr-field spr-field--full">
                          <div className="spr-field__label">Return completion</div>
                          <div className="spr-field__value">
                            {r.metadata?.buyer_acknowledged_closure_at ? (
                              <span className="spr-ack">
                                You confirmed on{' '}
                                {new Date(r.metadata.buyer_acknowledged_closure_at).toLocaleString()}
                              </span>
                            ) : (
                              <span className="spr-ack spr-ack--pending">
                                Waiting for your confirmation so inventory can be restored to the
                                supplier.
                              </span>
                            )}
                          </div>
                          <div className="spr-card__actions spr-card__actions--inline">
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={acknowledgingId === r.id}
                              onClick={() => acknowledgeClosure(r.id)}
                            >
                              {acknowledgingId === r.id
                                ? 'Working…'
                                : r.metadata?.buyer_acknowledged_closure_at
                                  ? 'Retry inventory sync'
                                  : 'Confirm return complete'}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </SpPageLayout>
  );
};

export default ServiceProviderReturns;
