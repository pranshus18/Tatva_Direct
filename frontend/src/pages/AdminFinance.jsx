import { useCallback, useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '../config/api';
import { AlertTriangle, CheckCircle, Download, Eye, FileText, RefreshCw, Shield, Wallet } from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
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
  const [downloadingFormat, setDownloadingFormat] = useState('');
  const [metrics, setMetrics] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [statement, setStatement] = useState(null);
  const [runs, setRuns] = useState([]);
  const [settlementReport, setSettlementReport] = useState(null);
  const [issues, setIssues] = useState([]);
  const [riskSignals, setRiskSignals] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
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

  const fetchFinanceData = useCallback(async () => {
    setLoading(true);
    try {
      const query = dateQuery();
      const [metricsResp, issuesResp, riskResp, auditResp, runsResp, settlementResp] = await Promise.all([
        fetch(getApiUrl('/api/payments/metrics'), { headers: authHeaders() }),
        fetch(getApiUrl('/api/payments/reconciliation/issues?status=open&limit=50'), { headers: authHeaders() }),
        fetch(getApiUrl('/api/payments/risk/signals?status=open&limit=30'), { headers: authHeaders() }),
        fetch(getApiUrl('/api/payments/audit/logs?limit=30'), { headers: authHeaders() }),
        fetch(getApiUrl('/api/payments/reconciliation/runs?limit=10'), { headers: authHeaders() }),
        fetch(getApiUrl(`/api/payments/settlement/report?${query}`), { headers: authHeaders() })
      ]);

      const [metricsData, issuesData, riskData, auditData, runsData, settlementData] = await Promise.all([
        metricsResp.json(),
        issuesResp.json(),
        riskResp.json(),
        auditResp.json(),
        runsResp.json(),
        settlementResp.json()
      ]);

      if (metricsData.status === 'success') setMetrics(metricsData.metrics || null);
      if (issuesData.status === 'success') setIssues(issuesData.issues || []);
      if (riskData.status === 'success') setRiskSignals(riskData.signals || []);
      if (auditData.status === 'success') setAuditLogs(auditData.logs || []);
      if (runsData.status === 'success') setRuns(runsData.runs || []);
      if (settlementData.status === 'success') setSettlementReport(settlementData.report || null);
    } catch (error) {
      console.error('[AdminFinance] Failed to fetch finance data:', error);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate]);

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
            lines: data.reconciliation.lines
          });
        }
        await fetchFinanceData();
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
        await fetchFinanceData();
        await fetchStatement();
      } else {
        alert(data.message || 'Failed to update issue');
      }
    } catch (error) {
      console.error('[AdminFinance] Failed to update issue:', error);
    }
  };

  const reviewRisk = async (id, status) => {
    try {
      const resp = await fetch(getApiUrl(`/api/payments/risk/signals/${id}/review`), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status })
      });
      const data = await resp.json();
      if (data.status === 'success') {
        await fetchFinanceData();
      } else {
        alert(data.message || 'Failed to update risk signal');
      }
    } catch (error) {
      console.error('[AdminFinance] Failed to review risk signal:', error);
    }
  };

  const filteredLines = useMemo(() => {
    const lines = statement?.lines || [];
    if (statementFilter === 'mismatch') return lines.filter((line) => line.status === 'mismatch');
    if (statementFilter === 'matched') return lines.filter((line) => line.status === 'matched');
    return lines;
  }, [statement, statementFilter]);

  const downloadStatement = async (format) => {
    setDownloadingFormat(format);
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set('fromDate', `${fromDate}T00:00:00.000Z`);
      if (toDate) params.set('toDate', `${toDate}T23:59:59.999Z`);
      params.set('filter', statementFilter);
      params.set('format', format);

      const resp = await fetch(getApiUrl(`/api/payments/reconciliation/statement/download?${params.toString()}`), {
        headers: authHeaders()
      });

      if (!resp.ok) {
        let message = `Failed to download ${format.toUpperCase()} statement`;
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
      const filename = match?.[1] || `reconciliation-statement-${fromDate}-to-${toDate}.${format}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[AdminFinance] Statement download failed:', error);
      alert(`Failed to download ${format.toUpperCase()} statement`);
    } finally {
      setDownloadingFormat('');
    }
  };

  if (loading && !statement) {
    return (
      <div className="admin-loading">
        <div className="spinner" />
        <p>Loading finance controls...</p>
      </div>
    );
  }

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <h1>Finance Ops</h1>
          <p>Reconciliation statement, settlement report, risk alerts, and audit trail</p>
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
          <h2>Reconciliation Period</h2>
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

      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <div className="stat-icon revenue">
            <Wallet size={24} />
          </div>
          <div className="stat-content">
            <h3>{metrics?.paymentSuccessRatePct ?? 0}%</h3>
            <p>Payment Success Rate</p>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="stat-icon transactions">
            <CheckCircle size={24} />
          </div>
          <div className="stat-content">
            <h3>{statement?.successRatePct ?? metrics?.reconciliationSuccessRatePct ?? 0}%</h3>
            <p>Reconciliation Success</p>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="stat-icon users">
            <AlertTriangle size={24} />
          </div>
          <div className="stat-content">
            <h3>{metrics?.openHighSeverityIssues ?? 0}</h3>
            <p>Open High Severity Issues</p>
          </div>
        </div>
        <div className="admin-stat-card">
          <div className="stat-icon suppliers">
            <Shield size={24} />
          </div>
          <div className="stat-content">
            <h3>{formatCurrency(settlementReport?.totalCaptured || 0)}</h3>
            <p>Captured in Period</p>
          </div>
        </div>
      </div>

      {(reconciliation || statement) && (
        <div className="dashboard-section" style={{ marginBottom: '1rem' }}>
          <h2>Reconciliation Summary</h2>
          <p>
            Checked: {reconciliation?.checked ?? statement?.checked ?? 0} | Matched:{' '}
            {reconciliation?.matched ?? statement?.matched ?? 0} | Mismatched orders:{' '}
            {reconciliation?.mismatches ?? statement?.mismatches ?? 0} | Open issue rows:{' '}
            {reconciliation?.issueCount ?? statement?.issueCount ?? 0}
            {reconciliation?.autoResolved ? ` | Auto-resolved: ${reconciliation.autoResolved}` : ''}
            {reconciliation?.newIssues != null ? ` | New issues logged: ${reconciliation.newIssues}` : ''}
          </p>
          <p style={{ marginTop: '0.5rem', color: '#64748b' }}>
            Totals — Orders: {formatCurrency(statement?.totalOrderAmount ?? reconciliation?.totalOrderAmount ?? 0)} |
            Receipts: {formatCurrency(statement?.totalReceiptAmount ?? reconciliation?.totalReceiptAmount ?? 0)} |
            Transactions: {formatCurrency(statement?.totalTransactionAmount ?? reconciliation?.totalTransactionAmount ?? 0)} |
            Ledger: {formatCurrency(statement?.totalLedgerAmount ?? 0)}
          </p>
        </div>
      )}

      <div className="dashboard-section" style={{ marginBottom: '1rem' }}>
        <div className="section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2>Reconciliation Statement</h2>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={statementFilter} onChange={(e) => setStatementFilter(e.target.value)}>
              <option value="all">All rows</option>
              <option value="matched">Matched only</option>
              <option value="mismatch">Mismatches only</option>
            </select>
            <button
              className="btn-refresh"
              onClick={() => downloadStatement('csv')}
              disabled={Boolean(downloadingFormat)}
            >
              <Download size={16} />
              {downloadingFormat === 'csv' ? 'Downloading...' : 'Download CSV'}
            </button>
            <button
              className="btn-refresh"
              onClick={() => downloadStatement('pdf')}
              disabled={Boolean(downloadingFormat)}
            >
              <FileText size={16} />
              {downloadingFormat === 'pdf' ? 'Downloading...' : 'Download PDF'}
            </button>
          </div>
        </div>
        <p style={{ margin: '0 0 1rem', fontSize: '0.85rem', color: '#64748b' }}>
          Download includes summary totals, settlement breakdown, and per-order details: service provider, supplier,
          payment method/reference, receipt, transaction, ledger, variance, status, and issues.
        </p>
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
                <th>Reference</th>
                <th>Transaction</th>
                <th>Ledger</th>
                <th>Variance</th>
                <th>Status</th>
                <th>Issues</th>
              </tr>
            </thead>
            <tbody>
              {filteredLines.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: '1.5rem' }}>
                    {loadingStatement ? 'Loading statement...' : 'No paid orders found for this period.'}
                  </td>
                </tr>
              ) : (
                filteredLines.map((line) => (
                  <tr key={line.orderId}>
                    <td>{line.orderNumber || line.orderId}</td>
                    <td>{line.orderDate ? new Date(line.orderDate).toLocaleDateString('en-IN') : '—'}</td>
                    <td>{line.serviceProvider || '—'}</td>
                    <td>{line.supplier || '—'}</td>
                    <td>{formatCurrency(line.orderTotal)}</td>
                    <td>
                      {line.receipt?.present
                        ? `${line.receipt.number || 'Yes'} (${formatCurrency(line.receipt.amount)})`
                        : 'Missing'}
                    </td>
                    <td>{line.receipt?.paymentReference || line.transaction?.providerPaymentId || '—'}</td>
                    <td>
                      {line.transaction?.present
                        ? `${line.transaction.status || 'Yes'} (${formatCurrency(line.transaction.amount)})`
                        : 'Missing'}
                    </td>
                    <td>{line.ledger?.present ? formatCurrency(line.ledger.amount) : 'Missing'}</td>
                    <td>
                      {line.varianceOrderReceipt == null ? '—' : formatCurrency(line.varianceOrderReceipt)}
                    </td>
                    <td>
                      <span className={`status ${line.status === 'matched' ? 'confirmed' : 'pending'}`}>
                        {line.status}
                      </span>
                    </td>
                    <td>{(line.issueTypes || []).map(formatIssueType).join(', ') || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="dashboard-section">
          <div className="section-header"><h2>Reconciliation Issues</h2></div>
          <div className="items-list">
            {issues.length === 0 ? (
              <div className="empty-state"><p>No open reconciliation issues.</p></div>
            ) : (
              issues.map((issue) => (
                <div className="item-card" key={issue.id}>
                  <div className="item-info">
                    <h4>{formatIssueType(issue.issue_type)}</h4>
                    <p>
                      Order: {issue.orders?.order_number || issue.order_id || 'N/A'} | Severity: {issue.severity}
                    </p>
                    <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      Expected: {JSON.stringify(issue.expected_value || {})} | Actual:{' '}
                      {JSON.stringify(issue.actual_value || {})}
                    </p>
                  </div>
                  <div className="item-status">
                    <button className="btn-icon" onClick={() => resolveIssue(issue.id, 'resolved')} title="Resolve">
                      <CheckCircle size={16} />
                    </button>
                    <button className="btn-icon" onClick={() => resolveIssue(issue.id, 'ignored')} title="Ignore">
                      <Eye size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="dashboard-section">
          <div className="section-header"><h2>Settlement Breakdown</h2></div>
          <div className="items-list">
            <div className="item-card">
              <div className="item-info">
                <h4>Captured payments</h4>
                <p>{settlementReport?.transactionCount || 0} transactions in selected period</p>
              </div>
              <div className="item-status">
                <span className="status confirmed">{formatCurrency(settlementReport?.totalCaptured || 0)}</span>
              </div>
            </div>
            {settlementReport?.byMethod &&
              Object.entries(settlementReport.byMethod).map(([method, amount]) => (
                <div className="item-card" key={method}>
                  <div className="item-info">
                    <h4>{String(method).replace(/_/g, ' ').toUpperCase()}</h4>
                    <p>Settlement method breakdown</p>
                  </div>
                  <div className="item-status">
                    <span className="status delivered">{formatCurrency(amount)}</span>
                  </div>
                </div>
              ))}
          </div>
        </div>

        <div className="dashboard-section">
          <div className="section-header"><h2>Recent Reconciliation Runs</h2></div>
          <div className="items-list">
            {runs.length === 0 ? (
              <div className="empty-state"><p>No reconciliation runs yet.</p></div>
            ) : (
              runs.map((run) => (
                <div className="item-card" key={run.id}>
                  <div className="item-info">
                    <h4>{run.run_type || 'payment_receipt'}</h4>
                    <p>
                      Checked {run.total_checked || 0} | Mismatched orders {run.mismatched_count || 0} | Status:{' '}
                      {run.status}
                    </p>
                  </div>
                  <div className="item-status">
                    <span className="status confirmed">
                      {run.summary?.successRatePct ?? 0}% | {new Date(run.created_at).toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="dashboard-section">
          <div className="section-header"><h2>Risk Signals</h2></div>
          <div className="items-list">
            {riskSignals.length === 0 ? (
              <div className="empty-state"><p>No open risk signals.</p></div>
            ) : (
              riskSignals.map((signal) => (
                <div className="item-card" key={signal.id}>
                  <div className="item-info">
                    <h4>{signal.signal_type}</h4>
                    <p>Risk score: {signal.risk_score}</p>
                  </div>
                  <div className="item-status">
                    <button className="btn-icon" onClick={() => reviewRisk(signal.id, 'reviewed')} title="Reviewed">
                      <CheckCircle size={16} />
                    </button>
                    <button className="btn-icon" onClick={() => reviewRisk(signal.id, 'blocked')} title="Blocked">
                      <AlertTriangle size={16} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="dashboard-section">
        <div className="section-header"><h2>Recent Audit Trail</h2></div>
        <div className="items-list">
          {auditLogs.length === 0 ? (
            <div className="empty-state"><p>No recent audit logs.</p></div>
          ) : (
            auditLogs.map((log) => (
              <div className="item-card" key={log.id}>
                <div className="item-info">
                  <h4>{log.action}</h4>
                  <p>{log.resource_type} {log.resource_id ? `#${log.resource_id}` : ''}</p>
                </div>
                <div className="item-status">
                  <span className="status confirmed">{new Date(log.created_at).toLocaleString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminFinance;
