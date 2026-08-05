import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Users } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { formatDateIST } from '../utils/dateTime';
import './Profile.css';

const WARN_UTILIZATION = 0.8;

function utilizationPct(acc) {
  const limit = Number(acc?.creditLimit || 0);
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((Number(acc.outstanding || 0) / limit) * 100));
}

function findAccountForBuyer(buyer, accounts = []) {
  if (!buyer || !accounts.length) return null;
  if (buyer.linkedBuyerUserId) {
    const byUser = accounts.find((a) => a.buyerUserId === buyer.linkedBuyerUserId);
    if (byUser) return byUser;
  }
  if (buyer.linkedCustomerId) {
    const byCustomer = accounts.find((a) => a.customerId === buyer.linkedCustomerId);
    if (byCustomer) return byCustomer;
  }
  const phone = String(buyer.phone || '').trim();
  if (phone) {
    const byPhone = accounts.find((a) => a.customerPhone === phone);
    if (byPhone) return byPhone;
  }
  return null;
}

function buyerCreditTarget(buyer) {
  return {
    buyerUserId: buyer?.linkedBuyerUserId || null,
    customerId: buyer?.linkedCustomerId || null,
    customerPhone: buyer?.phone || null,
    draftKey: buyer?.buyerId
  };
}

export default function SupplierCreditAccounts() {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [filter, setFilter] = useState('');

  const loadData = useCallback(async () => {
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    const [creditRes, buyersRes] = await Promise.all([
      fetch(getApiUrl('/api/supplier/credit-accounts'), { headers }),
      fetch(getApiUrl('/api/supplier/analytics/buyer-purchases?top=all'), { headers })
    ]);
    const creditPayload = await creditRes.json();
    const buyersPayload = await buyersRes.json();
    const list = creditPayload.status === 'success' ? creditPayload.accounts || [] : [];
    setAccounts(list);
    const buyerList = buyersPayload.status === 'success' ? buyersPayload.buyers || [] : [];
    setBuyers(buyerList);

    const nextDrafts = {};
    list.forEach((acc) => {
      const key = acc.buyerUserId || acc.customerPhone || acc.customerId;
      if (!key) return;
      nextDrafts[key] = {
        creditLimit: String(acc.creditLimit ?? ''),
        paylaterThreshold: String(acc.payLaterThreshold ?? 0),
        creditPeriodDays: String(acc.creditPeriodDays ?? 30),
        isEnabled: acc.isEnabled !== false,
        notes: acc.notes || ''
      };
    });
    buyerList.forEach((b) => {
      const acc = findAccountForBuyer(b, list);
      if (acc) {
        nextDrafts[b.buyerId] = {
          creditLimit: String(acc.creditLimit ?? ''),
          paylaterThreshold: String(acc.payLaterThreshold ?? b.paylaterThreshold ?? 0),
          creditPeriodDays: String(acc.creditPeriodDays ?? 30),
          isEnabled: acc.isEnabled !== false,
          notes: acc.notes || ''
        };
        return;
      }
      if (!nextDrafts[b.buyerId]) {
        nextDrafts[b.buyerId] = {
          creditLimit: '',
          paylaterThreshold: String(b.paylaterThreshold ?? 0),
          creditPeriodDays: '30',
          isEnabled: true,
          notes: ''
        };
      }
    });
    setDrafts(nextDrafts);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await loadData();
      } catch (e) {
        console.error(e);
        alert('Failed to load credit accounts');
      } finally {
        setLoading(false);
      }
    })();
  }, [loadData]);

  const filteredBuyers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return buyers;
    return buyers.filter((b) =>
      [b.name, b.company, b.email].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [buyers, filter]);

  const summary = useMemo(() => {
    const enabled = accounts.filter((a) => a.isEnabled !== false && Number(a.creditLimit) > 0);
    const nearLimit = enabled.filter((a) => utilizationPct(a) >= WARN_UTILIZATION * 100);
    const atLimit = enabled.filter((a) => utilizationPct(a) >= 99);
    return {
      totalAccounts: accounts.length,
      nearLimit: nearLimit.length,
      atLimit: atLimit.length,
      totalLimit: enabled.reduce((s, a) => s + Number(a.creditLimit || 0), 0),
      totalOutstanding: enabled.reduce((s, a) => s + Number(a.outstanding || 0), 0)
    };
  }, [accounts]);

  const updateDraft = (key, field, value) => {
    setDrafts((prev) => ({
      ...prev,
      [key]: {
        creditLimit: prev[key]?.creditLimit ?? '',
        paylaterThreshold: prev[key]?.paylaterThreshold ?? '0',
        creditPeriodDays: prev[key]?.creditPeriodDays ?? '30',
        isEnabled: prev[key]?.isEnabled !== false,
        notes: prev[key]?.notes ?? '',
        ...prev[key],
        [field]: value
      }
    }));
  };

  const saveCredit = async ({ buyerUserId, customerId, customerPhone, draftKey }) => {
    const draft = drafts[draftKey] || {};
    const limit = Number(draft.creditLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      alert('Enter a valid credit limit (₹).');
      return;
    }
    const paylaterThreshold = Number(draft.paylaterThreshold);
    if (!Number.isFinite(paylaterThreshold) || paylaterThreshold < 0) {
      alert('Enter a valid pay-later minimum (₹0 or more).');
      return;
    }
    if (paylaterThreshold > 0 && limit <= 0) {
      alert('Set a credit limit (₹) before enabling a pay-later minimum.');
      return;
    }
    try {
      setSavingKey(draftKey);
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/credit-accounts'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          buyerUserId: buyerUserId || null,
          customerId: customerId || null,
          customerPhone: customerPhone || null,
          creditLimit: limit,
          paylaterThreshold,
          creditPeriodDays: Number(draft.creditPeriodDays) || 30,
          isEnabled: draft.isEnabled !== false,
          notes: draft.notes || null
        })
      });
      const payload = await res.json();
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Failed to save');
      }
      await loadData();
    } catch (e) {
      alert(e.message || 'Failed to save credit account');
    } finally {
      setSavingKey(null);
    }
  };

  const settleCycle = async ({ buyerUserId, customerPhone, customerId, partyName }) => {
    const label = partyName || 'this customer';
    const confirmed = window.confirm(
      `Mark the full outstanding credit for ${label} as paid?\n\nThis settles the current loan cycle. Revenue and dashboard totals will update after settlement.`
    );
    if (!confirmed) return;

    const settleKey = buyerUserId || customerPhone || customerId || 'settle';
    try {
      setSavingKey(`settle-${settleKey}`);
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/credit-accounts/settle'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          buyerUserId: buyerUserId || null,
          customerPhone: customerPhone || null,
          customerId: customerId || null
        })
      });
      const payload = await res.json();
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Failed to settle');
      }
      alert(payload.message || 'Credit cycle settled.');
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to settle credit cycle');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return (
      <div className="dashboard-loading">
        <div className="spinner" />
        <p>Loading credit accounts…</p>
      </div>
    );
  }

  return (
    <div className="profile-container">
      <div className="profile-header">
        <div className="profile-title">
          <Wallet size={24} />
          <h1>Credit on account</h1>
        </div>
      </div>

      <div className="profile-content">
        <div className="profile-section">
          <p style={{ color: '#64748b', fontSize: '0.92rem', marginTop: 0 }}>
            <strong>Credit limit</strong> is the maximum total outstanding a buyer can have on pay-later
            orders at once (e.g. ₹1,00,000 — they can use the full amount across orders, but not more).
            <strong>Pay-later minimum</strong> is a lifetime net revenue gate. <strong>Loan cycle:</strong> when
            the cycle ends, buyers must settle outstanding orders from their vault (top up first if needed) before
            new pay-later orders.
          </p>
          <div className="supplier-summary-grid">
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Credit accounts</p>
              <p className="supplier-summary-value">{summary.totalAccounts}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total limit (enabled)</p>
              <p className="supplier-summary-value">₹{summary.totalLimit.toLocaleString('en-IN')}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Total outstanding</p>
              <p className="supplier-summary-value">₹{summary.totalOutstanding.toLocaleString('en-IN')}</p>
            </div>
            <div className="supplier-summary-card">
              <p className="supplier-summary-label">Near / at limit</p>
              <p className="supplier-summary-value" style={{ color: summary.atLimit ? '#b91c1c' : undefined }}>
                {summary.nearLimit}
                {summary.atLimit > 0 ? ` (${summary.atLimit} full)` : ''}
              </p>
            </div>
          </div>
        </div>

        <div className="profile-section">
          <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={20} /> B2B buyers
          </h2>
          <input
            type="search"
            placeholder="Search buyers…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ ...inputStyle, marginBottom: '1rem', maxWidth: 360 }}
          />
          {filteredBuyers.length === 0 ? (
            <p style={{ color: '#94a3b8' }}>No buyers yet. Limits can be set when they place orders.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
                <thead>
                  <tr>
                    <th style={th}>Buyer</th>
                    <th style={th}>Company</th>
                    <th style={th}>Limit ₹</th>
                    <th style={th}>Pay-later min ₹</th>
                    <th style={th}>Loan cycle (days)</th>
                    <th style={th}>Cycle due</th>
                    <th style={th}>Used %</th>
                    <th style={th}>Outstanding</th>
                    <th style={th}>Available</th>
                    <th style={th}>On</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {filteredBuyers.map((buyer) => {
                    const acc = findAccountForBuyer(buyer, accounts);
                    const draft = drafts[buyer.buyerId] || {
                      creditLimit: '',
                      paylaterThreshold: String(buyer.paylaterThreshold ?? 0),
                      creditPeriodDays: '30',
                      isEnabled: true,
                      notes: ''
                    };
                    const pct = acc ? utilizationPct(acc) : 0;
                    const rowStyle =
                      pct >= 99
                        ? { background: '#fef2f2' }
                        : pct >= WARN_UTILIZATION * 100
                          ? { background: '#fffbeb' }
                          : {};
                    return (
                      <tr key={buyer.buyerId} style={rowStyle}>
                        <td style={td}>{buyer.name || '—'}</td>
                        <td style={td}>{buyer.company || '—'}</td>
                        <td style={td}>
                          <input
                            type="number"
                            min="0"
                            value={draft.creditLimit}
                            onChange={(e) => updateDraft(buyer.buyerId, 'creditLimit', e.target.value)}
                            style={cellInput}
                            placeholder="0"
                          />
                        </td>
                        <td style={td}>
                          <input
                            type="number"
                            min="0"
                            value={draft.paylaterThreshold ?? '0'}
                            onChange={(e) =>
                              updateDraft(buyer.buyerId, 'paylaterThreshold', e.target.value)
                            }
                            style={cellInput}
                            placeholder="0"
                            title="Minimum order amount for pay later on this order (₹0 = no minimum)"
                          />
                        </td>
                        <td style={td}>
                          <input
                            type="number"
                            min="1"
                            value={draft.creditPeriodDays}
                            onChange={(e) => updateDraft(buyer.buyerId, 'creditPeriodDays', e.target.value)}
                            style={{ ...cellInput, width: 64 }}
                          />
                        </td>
                        <td style={td}>
                          {acc?.cycleDueAt ? (
                            <span style={{ color: acc.cycleIsOverdue ? '#b91c1c' : '#334155' }}>
                              {formatDateIST(acc.cycleDueAt, '—')}
                              {acc.cycleIsOverdue ? ' (overdue)' : ` (${acc.cycleDaysRemaining ?? 0}d left)`}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={td}>{acc ? `${pct}%` : '—'}</td>
                        <td style={td}>₹{Number(acc?.outstanding || 0).toLocaleString('en-IN')}</td>
                        <td style={td}>₹{Number(acc?.available ?? 0).toLocaleString('en-IN')}</td>
                        <td style={td}>
                          <input
                            type="checkbox"
                            checked={draft.isEnabled}
                            onChange={(e) => updateDraft(buyer.buyerId, 'isEnabled', e.target.checked)}
                          />
                        </td>
                        <td style={td}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            <button
                              type="button"
                              className="btn-secondary"
                              style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                              disabled={savingKey === buyer.buyerId}
                              onClick={() => saveCredit(buyerCreditTarget(buyer))}
                            >
                              {savingKey === buyer.buyerId ? '…' : 'Save'}
                            </button>
                            {acc && Number(acc.outstanding) > 0 ? (
                              <span
                                className="upstream-muted-meta"
                                style={{ fontSize: '0.75rem', display: 'block', marginTop: '0.35rem' }}
                                title="Buyer must pay open orders from their vault"
                              >
                                Outstanding — buyer pays via vault
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
          <Link to="/supplier-buyer-purchases">View sales analytics</Link>
        </p>
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

const cellInput = {
  ...inputStyle,
  padding: '0.35rem 0.5rem',
  width: 100
};
