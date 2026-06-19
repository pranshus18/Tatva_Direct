import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '../config/api';
import { AlertTriangle, CheckCircle, Eye, FileText, RefreshCw, Wallet } from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import { formatDateIST } from '../utils/dateTime';
import './AdminDashboard.css';

const ISSUE_LABELS = {
  missing_receipt: 'Missing receipt',
  missing_payment_txn: 'Missing payment transaction',
  amount_mismatch: 'Amount mismatch',
  ledger_mismatch: 'Ledger entry missing',
  missing_invoice: 'Missing invoice'
};

function formatCurrency(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function formatIssueType(type) {
  return ISSUE_LABELS[type] || String(type || '').replace(/_/g, ' ');
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return {
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10)
  };
}

const AdminFinance = ({ user }) => {
  const initialRange = useMemo(() => defaultDateRange(), []);
  const [loading, setLoading] = useState(true);
  const [runningRecon, setRunningRecon] = useState(false);
  const [loadingStatement, setLoadingStatement] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [reconciliation, setReconciliation] = useState(null);
  const [statement, setStatement] = useState(null);
  const [issues, setIssues] = useState([]);
  const [fromDate, setFromDate] = useState(initialRange.fromDate);
  const [toDate, setToDate] = useState(initialRange.toDate);
  const [statementFilter, setStatementFilter] = useState('all');

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token') || ''}`
  });

  const dateQuery = () => {
    const params = new URLSearchParams();
    if (fromDate) params.set('fromDate', `${fromDate}T00:00:00.000Z`);
    if (toDate) params.set('toDate', `${toDate}T23:59:59.999Z`);
    return params.toString();
  };

  const fetchStatement = useCallback(async () => {
    setLoadingStatement(true);
    try {
      const query = dateQuery();
      const resp = await fetch(getApiUrl(`/api/payments/reconciliation/statement?${query}`), {
        headers: authHeaders()
      });
      const data = await resp.json();
      if (data.status === 'success') {
        setStatement(data.statement || null);
      } else {
        alert(data.message || 'Failed to load reconciliation statement');
      }
    } catch (error) {
      console.error('[AdminFinance] Failed to load statement:', error);
      alert('Failed to load reconciliation statement');
    } finally {
      setLoadingStatement(false);
    }
  }, [fromDate, toDate]);

  const fetchIssues = useCallback(async () => {
    try {
      const resp = await fetch(getApiUrl('/api/payments/reconciliation/issues?status=open&limit=50'), {
        headers: authHeaders()
      });
      const data = await resp.json();
      if (data.status === 'success') setIssues(data.issues || []);
    } catch (error) {
      console.error('[AdminFinance] Failed to fetch issues:', error);
    }
  }, []);

  const fetchFinanceData = useCallback(async () => {
    setLoading(true);
    try {
      await fetchIssues();
    } finally {
      setLoading(false);
    }
  }, [fetchIssues]);

  useEffect(() => {
    fetchFinanceData();
    fetchStatement();
  }, [fetchFinanceData, fetchStatement]);

  const runReconciliation = async () => {
    setRunningRecon(true);
    try {
      const resp = await fetch(getApiUrl('/api/payments/reconciliation/run'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          fromDate: fromDate ? `${fromDate}T00:00:00.000Z` : null,
          toDate: toDate ? `${toDate}T23:59:59.999Z` : null
        })
      });
      const data = await resp.json();
      if (data.status === 'success') {
        setReconciliation(data.reconciliation || null);
        if (data.reconciliation?.lines) {
          setStatement({
            fromDate,
            toDate,
            checked: data.reconciliation.checked,
            matched: data.reconciliation.matched,
            mismatches: data.reconciliation.mismatches,
            issueCount: data.reconciliation.issueCount,
            successRatePct: data.reconciliation.successRatePct,
            totalOrderAmount: data.reconciliation.totalOrderAmount,
            totalReceiptAmount: data.reconciliation.totalReceiptAmount,
            totalTransactionAmount: data.reconciliation.totalTransactionAmount,
            totalLedgerAmount: data.reconciliation.totalLedgerAmount,
            lines: data.reconciliation.lines
          });
        }
        await fetchIssues();
      } else {
        alert(data.message || 'Failed to run reconciliation');
      }
    } catch (error) {
      console.error('[AdminFinance] Reconciliation run failed:', error);
      alert('Failed to run reconciliation');
    } finally {
      setRunningRecon(false);
    }
  };

  const resolveIssue = async (id, status) => {
    try {
      const resp = await fetch(getApiUrl(`/api/payments/reconciliation/issues/${id}/resolve`), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status, notes: `Updated from finance page to ${status}` })
      });
      const data = await resp.json();
      if (data.status === 'success') {
        await fetchIssues();
        await fetchStatement();
      } else {
        alert(data.message || 'Failed to update issue');
      }
    } catch (error) {
      console.error('[AdminFinance] Failed to update issue:', error);
    }
  };

  const filteredLines = useMemo(() => {
    const lines = statement?.lines || [];
    if (statementFilter === 'mismatch') return lines.filter((line) => line.status === 'mismatch');
    if (statementFilter === 'matched') return lines.filter((line) => line.status === 'matched');
    return lines;
  }, [statement, statementFilter]);

  const downloadStatementPdf = async () => {
    setDownloadingPdf(true);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('fromDate', `${fromDate}T00:00:00.000Z`);
      if (toDate) params.set('toDate', `${toDate}T23:59:59.999Z`);
      params.set('filter', statementFilter);

      const resp = await fetch(getApiUrl(`/api/payments/reconciliation/statement/download?${params.toString()}`), {
        headers: authHeaders()
      });

      if (!resp.ok) {
        let message = 'Failed to download PDF statement';
        try {
          const data = await resp.json();
          message = data.message || message;
        } catch (_e) {
          // Response may not be JSON when download fails before file generation.
        }
        alert(message);
        return;
      }

      const blob = await resp.blob();
      const disposition = resp.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/i);
      const filename = match?.[1] || `reconciliation-statement-${fromDate}-to-${toDate}.pdf`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[AdminFinance] Statement download failed:', error);
      alert('Failed to download PDF statement');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const successRate = statement?.successRatePct ?? reconciliation?.successRatePct ?? 100;
  const openIssues = issues.length;

  if (loading && !statement) {
    return (
      <div className="admin-loading">
        <div className="spinner" />
        <p>Loading reconciliation...</p>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <h1>Reconciliation</h1>
          <p>Check paid orders against receipts, transactions, and ledger — then download the statement.</p>
        </div>
        <div className="admin-actions">
          <AdminNotifications />
          <button className="btn-refresh" onClick={() => { fetchFinanceData(); fetchStatement(); }} disabled={loading || loadingStatement}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <button className="btn-refresh" onClick={runReconciliation} disabled={runningRecon}>
            <CheckCircle size={16} />
            {runningRecon ? 'Running...' : 'Run reconciliation'}
          </button>
          <div className="admin-user-info">
            <span>Welcome, {user?.name}</span>
            <div className="admin-badge">Finance</div>
          </div>
        </div>
      </div>

      <div className="dashboard-section" style={{ marginBottom: '1rem' }}>
        <div className="section-header">
          <h2>Period</h2>
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: '0.35rem', fontSize: '0.875rem' }}>
            From
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label style={{ display: 'grid', gap: '0.35rem', fontSize: '0.875rem' }}>
            To
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          <button className="btn-refresh" onClick={() => { fetchFinanceData(); fetchStatement(); }} disabled={loadingStatement}>
            {loadingStatement ? 'Loading...' : 'Load statement'}
          </button>
        </div>
      </div>

      <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
        <div className="admin-stat-card">
          <div className="stat-icon transactions">
            <CheckCircle size={24} />
          </div>
          <div className="stat-content">
            <h3>{successRate}%</h3>
            <p>Matched</p>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="stat-icon users">
            <AlertTriangle size={24} />
          </div>
          <div className="stat-content">
            <h3>{openIssues}</h3>
            <p>Open issues</p>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="stat-icon revenue">
            <Wallet size={24} />
          </div>
          <div className="stat-content">
            <h3>{formatCurrency(statement?.totalOrderAmount ?? reconciliation?.totalOrderAmount ?? 0)}</h3>
            <p>Paid orders total</p>
          </div>
        </div>
      </div>

      {(reconciliation || statement) && (
        <div className="dashboard-section" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: '#64748b' }}>
            {statement?.checked ?? reconciliation?.checked ?? 0} orders checked ·{' '}
            {statement?.matched ?? reconciliation?.matched ?? 0} matched ·{' '}
            {statement?.mismatches ?? reconciliation?.mismatches ?? 0} mismatched
            {reconciliation?.autoResolved ? ` · ${reconciliation.autoResolved} auto-fixed` : ''}
          </p>
        </div>
      )}

      {openIssues > 0 && (
        <div className="dashboard-section" style={{ marginBottom: '1rem' }}>
          <div className="section-header">
            <h2>Needs attention ({openIssues})</h2>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748b' }}>
              Run reconciliation to auto-fix most of these, or resolve manually.
            </p>
          </div>
          <div className="items-list">
            {issues.map((issue) => (
              <div className="item-card" key={issue.id} style={{ alignItems: 'flex-start' }}>
                <div className="item-info" style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 0.35rem', fontWeight: 600 }}>
                    {issue.orderNumber || 'Unknown order'}
                    {issue.orderAmount != null ? ` · ${formatCurrency(issue.orderAmount)}` : ''}
                  </p>
                  <p style={{ margin: 0, color: '#334155' }}>
                    {issue.summary || formatIssueType(issue.issue_type)}
                  </p>
                </div>
                <div className="item-status" style={{ display: 'flex', gap: '0.35rem' }}>
                  <button className="btn-refresh" onClick={() => resolveIssue(issue.id, 'resolved')} title="Mark resolved">
                    <CheckCircle size={14} />
                    Resolve
                  </button>
                  <button className="btn-refresh" onClick={() => resolveIssue(issue.id, 'ignored')} title="Ignore issue">
                    <Eye size={14} />
                    Ignore
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="dashboard-section" style={{ marginBottom: '1rem' }}>
        <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Statement</h2>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={statementFilter} onChange={(e) => setStatementFilter(e.target.value)}>
              <option value="all">All rows</option>
              <option value="matched">Matched only</option>
              <option value="mismatch">Mismatches only</option>
            </select>
            <button className="btn-refresh" onClick={downloadStatementPdf} disabled={downloadingPdf}>
              <FileText size={16} />
              {downloadingPdf ? 'Downloading...' : 'Download PDF'}
            </button>
          </div>
        </div>
        <div className="transactions-table">
          <table>
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Service Provider</th>
                <th>Supplier</th>
                <th>Order Total</th>
                <th>Receipt</th>
                <th>Transaction</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredLines.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', padding: '1.5rem' }}>
                    {loadingStatement ? 'Loading statement...' : 'No paid orders found for this period.'}
                  </td>
                </tr>
              ) : (
                filteredLines.map((line) => (
                  <tr key={line.orderId}>
                    <td>{line.orderNumber || line.orderId}</td>
                    <td>{line.orderDate ? formatDateIST(line.orderDate, '—') : '—'}</td>
                    <td>{line.serviceProvider || '—'}</td>
                    <td>{line.supplier || '—'}</td>
                    <td>{formatCurrency(line.orderTotal)}</td>
                    <td>{line.receipt?.present ? formatCurrency(line.receipt.amount) : 'Missing'}</td>
                    <td>{line.transaction?.present ? formatCurrency(line.transaction.amount) : 'Missing'}</td>
                    <td>
                      <span className={`status ${line.status === 'matched' ? 'confirmed' : 'pending'}`}>
                        {line.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminFinance;
