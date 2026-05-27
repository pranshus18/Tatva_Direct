import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, Users, Smartphone } from 'lucide-react';
import { getApiUrl } from '../config/api';
import './Profile.css';

const WARN_UTILIZATION = 0.8;

function utilizationPct(acc) {
  const limit = Number(acc?.creditLimit || 0);
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((Number(acc.outstanding || 0) / limit) * 100));
}

export default function SupplierCreditAccounts() {
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [savingKey, setSavingKey] = useState(null);
  const [posPhone, setPosPhone] = useState('');
  const [posLimit, setPosLimit] = useState('');
  const [posPeriod, setPosPeriod] = useState('30');
  const [posNotes, setPosNotes] = useState('');
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
    setBuyers(buyersPayload.status === 'success' ? buyersPayload.buyers || [] : []);

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
    (buyersPayload.buyers || []).forEach((b) => {
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

  const accountsByBuyer = useMemo(() => {
    const m = new Map();
    accounts.forEach((a) => {
      if (a.buyerUserId) m.set(a.buyerUserId, a);
    });
    return m;
  }, [accounts]);

  const posAccounts = useMemo(
    () => accounts.filter((a) => a.partyType === 'pos_customer' || a.customerPhone),
    [accounts]
  );

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

  const saveCredit = async ({ buyerUserId, customerPhone, draftKey }) => {
    const draft = drafts[draftKey] || {};
    const limit = Number(draft.creditLimit);
    if (!Number.isFinite(limit) || limit < 0) {
      alert('Enter a valid credit limit (₹).');
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
          customerPhone: customerPhone || null,
          creditLimit: limit,
          paylaterThreshold: Number(draft.paylaterThreshold) || 0,
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

  const savePosCredit = async (e) => {
    e.preventDefault();
    const phone = posPhone.trim();
    const limit = Number(posLimit);
    if (!phone) {
      alert('Enter customer phone.');
      return;
    }
    if (!Number.isFinite(limit) || limit < 0) {
      alert('Enter a valid credit limit.');
      return;
    }
    try {
      setSavingKey(`pos-${phone}`);
      const token = localStorage.getItem('token');
      const res = await fetch(getApiUrl('/api/supplier/credit-accounts'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          customerPhone: phone,
          creditLimit: limit,
          paylaterThreshold: 0,
          creditPeriodDays: Number(posPeriod) || 30,
          isEnabled: true,
          notes: posNotes || null
        })
      });
      const payload = await res.json();
      if (!res.ok || payload.status !== 'success') {
        throw new Error(payload.message || 'Failed to save');
      }
      setPosPhone('');
      setPosLimit('');
      setPosNotes('');
      await loadData();
    } catch (err) {
      alert(err.message || 'Failed to save');
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
            Set credit limits and pay-later minimum order amounts per buyer. Pay later only appears when the
            order total meets the minimum. You will get a notification when usage reaches{' '}
            {Math.round(WARN_UTILIZATION * 100)}% of the limit.
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
            <Smartphone size={20} /> POS customers (by phone)
          </h2>
          <form onSubmit={savePosCredit} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <input
              type="tel"
              placeholder="Phone *"
              value={posPhone}
              onChange={(e) => setPosPhone(e.target.value)}
              style={inputStyle}
            />
            <input
              type="number"
              min="0"
              step="100"
              placeholder="Limit ₹ *"
              value={posLimit}
              onChange={(e) => setPosLimit(e.target.value)}
              style={{ ...inputStyle, width: 120 }}
            />
            <select value={posPeriod} onChange={(e) => setPosPeriod(e.target.value)} style={inputStyle}>
              {[7, 15, 30, 45, 60, 90].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Notes (optional)"
              value={posNotes}
              onChange={(e) => setPosNotes(e.target.value)}
              style={{ ...inputStyle, minWidth: 160, flex: 1 }}
            />
            <button type="submit" className="btn-primary" disabled={savingKey?.startsWith('pos-')}>
              Add / update
            </button>
          </form>
          {posAccounts.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No POS credit accounts yet.</p>
          ) : (
            <CreditTable
              rows={posAccounts}
              drafts={drafts}
              savingKey={savingKey}
              onDraft={updateDraft}
              onSave={(row) =>
                saveCredit({
                  customerPhone: row.customerPhone,
                  draftKey: row.customerPhone || row.customerId
                })
              }
              idKey={(r) => r.customerPhone || r.id}
              draftKey={(r) => r.customerPhone || r.customerId}
              nameCol={(r) => r.partyName || r.customerPhone}
            />
          )}
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
                    <th style={th}>Days</th>
                    <th style={th}>Used %</th>
                    <th style={th}>Outstanding</th>
                    <th style={th}>Available</th>
                    <th style={th}>On</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {filteredBuyers.map((buyer) => {
                    const acc = accountsByBuyer.get(buyer.buyerId);
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
                            title="Minimum order amount for pay later (must be greater than 0)"
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
                          <button
                            type="button"
                            className="btn-secondary"
                            style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                            disabled={savingKey === buyer.buyerId}
                            onClick={() =>
                              saveCredit({ buyerUserId: buyer.buyerId, draftKey: buyer.buyerId })
                            }
                          >
                            {savingKey === buyer.buyerId ? '…' : 'Save'}
                          </button>
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
          {' · '}
          <Link to="/supplier-pos">Open POS</Link>
        </p>
      </div>
    </div>
  );
}

function CreditTable({ rows, drafts, savingKey, onDraft, onSave, idKey, draftKey, nameCol }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
      <thead>
        <tr>
          <th style={th}>Customer</th>
          <th style={th}>Limit</th>
          <th style={th}>Used %</th>
          <th style={th}>Available</th>
          <th style={th} />
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const key = draftKey(row);
          const draft = drafts[key] || {};
          const pct = utilizationPct(row);
          return (
            <tr
              key={idKey(row)}
              style={
                pct >= 99
                  ? { background: '#fef2f2' }
                  : pct >= WARN_UTILIZATION * 100
                    ? { background: '#fffbeb' }
                    : {}
              }
            >
              <td style={td}>{nameCol(row)}</td>
              <td style={td}>
                <input
                  type="number"
                  min="0"
                  value={draft.creditLimit ?? row.creditLimit}
                  onChange={(e) => onDraft(key, 'creditLimit', e.target.value)}
                  style={cellInput}
                />
              </td>
              <td style={td}>{pct}%</td>
              <td style={td}>₹{Number(row.available || 0).toLocaleString('en-IN')}</td>
              <td style={td}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ fontSize: '0.8rem' }}
                  disabled={savingKey === key}
                  onClick={() => onSave(row)}
                >
                  {savingKey === key ? '…' : 'Save'}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
