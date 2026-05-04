import { useEffect, useState } from 'react';
import { getApiUrl } from '../config/api';
import { AlertTriangle, CheckCircle, Eye, RefreshCw, Shield, Wallet } from 'lucide-react';
import AdminNotifications from '../components/AdminNotifications';
import './AdminDashboard.css';

const AdminFinance = ({ user }) => {
  const [loading, setLoading] = useState(true);
  const [runningRecon, setRunningRecon] = useState(false);
  const [metrics, setMetrics] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [issues, setIssues] = useState([]);
  const [riskSignals, setRiskSignals] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token') || ''}`
  });

  const fetchFinanceData = async () => {
    setLoading(true);
    try {
      const [metricsResp, issuesResp, riskResp, auditResp] = await Promise.all([
        fetch(getApiUrl('/api/payments/metrics'), { headers: authHeaders() }),
        fetch(getApiUrl('/api/payments/reconciliation/issues?status=open&limit=30'), { headers: authHeaders() }),
        fetch(getApiUrl('/api/payments/risk/signals?status=open&limit=30'), { headers: authHeaders() }),
        fetch(getApiUrl('/api/payments/audit/logs?limit=30'), { headers: authHeaders() })
      ]);

      const [metricsData, issuesData, riskData, auditData] = await Promise.all([
        metricsResp.json(),
        issuesResp.json(),
        riskResp.json(),
        auditResp.json()
      ]);

      if (metricsData.status === 'success') setMetrics(metricsData.metrics || null);
      if (issuesData.status === 'success') setIssues(issuesData.issues || []);
      if (riskData.status === 'success') setRiskSignals(riskData.signals || []);
      if (auditData.status === 'success') setAuditLogs(auditData.logs || []);
    } catch (error) {
      console.error('[AdminFinance] Failed to fetch finance data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFinanceData();
  }, []);

  const runReconciliation = async () => {
    setRunningRecon(true);
    try {
      const resp = await fetch(getApiUrl('/api/payments/reconciliation/run'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({})
      });
      const data = await resp.json();
      if (data.status === 'success') {
        setReconciliation(data.reconciliation || null);
        await fetchFinanceData();
      } else {
        alert(data.message || 'Failed to run reconciliation');
      }
    } catch (error) {
      console.error('[AdminFinance] Reconciliation run failed:', error);
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

  if (loading) {
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
          <p>Reconciliation, risk alerts, payment confidence, and immutable audit trail</p>
        </div>
        <div className="admin-actions">
          <AdminNotifications />
          <button className="btn-refresh" onClick={fetchFinanceData} disabled={loading}>
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
            <h3>{metrics?.reconciliationSuccessRatePct ?? 0}%</h3>
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
            <h3>{metrics?.webhookFailureCount ?? 0}</h3>
            <p>Webhook Processing Failures</p>
          </div>
        </div>
      </div>

      {reconciliation && (
        <div className="dashboard-section" style={{ marginBottom: '1rem' }}>
          <h2>Latest Reconciliation Run</h2>
          <p>
            Checked: {reconciliation.checked} | Mismatches: {reconciliation.mismatches} | Success:{' '}
            {reconciliation.successRatePct}%
          </p>
        </div>
      )}

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
                    <h4>{issue.issue_type}</h4>
                    <p>Severity: {issue.severity}</p>
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
