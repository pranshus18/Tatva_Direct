import React, { useEffect, useMemo, useState } from 'react';
import { Wallet as WalletIcon, RefreshCw } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { Button } from '@/components/ui/button';

const formatInr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const directionLabel = (direction) => (String(direction || '').toLowerCase() === 'credit' ? 'Credit' : 'Debit');
const signedAmount = (row) =>
  `${String(row?.direction || '').toLowerCase() === 'credit' ? '+' : '-'}${formatInr(row?.amount || 0)}`;

export default function AdminWallet() {
  const [loading, setLoading] = useState(true);
  const [walletType, setWalletType] = useState('platform_escrow');
  const [overview, setOverview] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [userWalletSummary, setUserWalletSummary] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [userWalletType, setUserWalletType] = useState('customer');
  const [userSearchInput, setUserSearchInput] = useState('');
  const [pageInfo, setPageInfo] = useState({ hasMore: false, nextCursor: null });
  const [cursor, setCursor] = useState(null);
  const [cursorHistory, setCursorHistory] = useState([]);
  const [notice, setNotice] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [filters, setFilters] = useState({ search: '', from: '', to: '' });
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [sortBy, setSortBy] = useState('created_at_desc');
  const [exportingAll, setExportingAll] = useState(false);

  const buildQuery = (selectedWalletType = walletType, nextCursor = null, nextFilters = filters, limit = 50) => {
    const query = new URLSearchParams({ walletType: selectedWalletType, limit: String(limit) });
    if (nextCursor) query.set('cursor', nextCursor);
    if (nextFilters.search) query.set('search', nextFilters.search);
    if (nextFilters.from) query.set('from', `${nextFilters.from}T00:00:00.000Z`);
    if (nextFilters.to) query.set('to', `${nextFilters.to}T23:59:59.999Z`);
    return query.toString();
  };

  const loadData = async (selectedWalletType = walletType, nextCursor = cursor, nextFilters = filters) => {
    setLoading(true);
    setNotice('');
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const headers = { Authorization: `Bearer ${token}` };
      const userQuery = new URLSearchParams({
        walletType: userWalletType,
        limit: '150',
        search: userSearchInput.trim()
      });
      const [overviewResp, txResp, userSummaryResp, withdrawalsResp] = await Promise.all([
        fetch(getApiUrl('/api/admin/wallet/overview'), { headers }),
        fetch(getApiUrl(`/api/admin/wallet/transactions?${buildQuery(selectedWalletType, nextCursor, nextFilters, 50)}`), {
          headers
        }),
        fetch(getApiUrl(`/api/admin/wallet/users-summary?${userQuery.toString()}`), { headers }),
        fetch(getApiUrl('/api/admin/wallet/withdrawals?status=pending&limit=100'), { headers })
      ]);
      const overviewData = await overviewResp.json().catch(() => ({}));
      const txData = await txResp.json().catch(() => ({}));
      const userSummaryData = await userSummaryResp.json().catch(() => ({}));
      const withdrawalsData = await withdrawalsResp.json().catch(() => ({}));
      if (!overviewResp.ok || overviewData.status !== 'success') {
        throw new Error(overviewData.message || 'Failed to load admin wallet overview');
      }
      if (!txResp.ok || txData.status !== 'success') {
        throw new Error(txData.message || 'Failed to load admin wallet transactions');
      }
      if (!userSummaryResp.ok || userSummaryData.status !== 'success') {
        throw new Error(userSummaryData.message || 'Failed to load user wallet summary');
      }
      if (!withdrawalsResp.ok || withdrawalsData.status !== 'success') {
        throw new Error(withdrawalsData.message || 'Failed to load withdrawal requests');
      }
      setOverview(overviewData.overview || null);
      setTransactions(txData.transactions || []);
      setPageInfo(txData.pageInfo || { hasMore: false, nextCursor: null });
      setUserWalletSummary(userSummaryData.users || []);
      setWithdrawals(withdrawalsData.withdrawals || []);
    } catch (e) {
      setNotice(e.message || 'Failed to load wallet tracking data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData(walletType, cursor, filters);
  }, [walletType, cursor, filters, userWalletType]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadData(walletType, cursor, filters);
    }, 20000);
    return () => window.clearInterval(intervalId);
  }, [walletType, cursor, filters, userWalletType, userSearchInput]);

  useEffect(() => {
    setCursor(null);
    setCursorHistory([]);
  }, [walletType]);

  const sortedTransactions = useMemo(() => {
    const rows = [...transactions];
    if (sortBy === 'created_at_asc') rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (sortBy === 'amount_asc') rows.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
    else if (sortBy === 'amount_desc') rows.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    else rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return rows;
  }, [transactions, sortBy]);

  const downloadCsv = () => {
    const header = [
      'Date',
      'Transaction details',
      'Amount',
      'Debit/Credit',
      'Payment Method',
      'Project ID',
      'Transaction ID',
      'Paid By',
      'Paid To',
      'Gross',
      'Fee',
      'Supplier Net'
    ];
    const lines = sortedTransactions.map((row) => [
      new Date(row.created_at).toISOString(),
      row.description || row.transaction_type || '',
      Number(row.amount || 0).toFixed(2),
      directionLabel(row.direction),
      'Wallet',
      row.orderNumber || row.orderId || '-',
      row.id || '',
      row.paidBy?.label || '',
      row.paidTo?.label || '',
      Number(row.grossAmount || 0).toFixed(2),
      Number(row.platformFeeAmount || 0).toFixed(2),
      Number(row.supplierPayoutAmount || 0).toFixed(2),
    ]);
    const csv = [header, ...lines]
      .map((cols) =>
        cols
          .map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`)
          .join(',')
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `admin-${walletType}-transaction-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllCsv = async () => {
    if (exportingAll) return;
    setExportingAll(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const headers = { Authorization: `Bearer ${token}` };
      const allRows = [];
      let nextCursor = null;
      let pages = 0;
      do {
        const resp = await fetch(
          getApiUrl(`/api/admin/wallet/transactions?${buildQuery(walletType, nextCursor, filters, 200)}`),
          { headers }
        );
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.status !== 'success') {
          throw new Error(data.message || 'Failed to export all admin wallet rows');
        }
        allRows.push(...(data.transactions || []));
        nextCursor = data?.pageInfo?.hasMore ? data?.pageInfo?.nextCursor || null : null;
        pages += 1;
      } while (nextCursor && pages < 200);

      const header = [
        'Date',
        'Transaction details',
        'Amount',
        'Debit/Credit',
        'Payment Method',
        'Project ID',
        'Transaction ID',
        'Paid By',
        'Paid To',
        'Gross',
        'Fee',
        'Supplier Net'
      ];
      const lines = allRows.map((row) => [
        new Date(row.created_at).toISOString(),
        row.description || row.transaction_type || '',
        Number(row.amount || 0).toFixed(2),
        directionLabel(row.direction),
        'Wallet',
        row.orderNumber || row.orderId || '-',
        row.id || '',
        row.paidBy?.label || '',
        row.paidTo?.label || '',
        Number(row.grossAmount || 0).toFixed(2),
        Number(row.platformFeeAmount || 0).toFixed(2),
        Number(row.supplierPayoutAmount || 0).toFixed(2)
      ]);
      const csv = [header, ...lines]
        .map((cols) =>
          cols
            .map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`)
            .join(',')
        )
        .join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `admin-${walletType}-transaction-history-all-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setNotice(e.message || 'Failed to export full admin history');
    } finally {
      setExportingAll(false);
    }
  };

  const processWithdrawal = async (row, action) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const resp = await fetch(getApiUrl(`/api/admin/wallet/withdrawals/${row.id}/${action}`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ note: action === 'reject' ? 'Rejected by admin' : 'Approved by admin' })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.status !== 'success') throw new Error(data.message || `Failed to ${action} withdrawal`);
      setNotice(`Withdrawal ${action}d successfully.`);
      await loadData(walletType, cursor, filters);
    } catch (e) {
      setNotice(e.message || `Failed to ${action} withdrawal`);
    }
  };

  return (
    <div className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <WalletIcon className="h-6 w-6" />
            Admin Wallet Tracking
          </h1>
          <p className="text-sm text-slate-500">
            Monitor escrow, platform revenue, top-ups, and supplier payout pipeline in one place.
          </p>
        </div>
        <Button variant="outline" onClick={() => loadData(walletType)} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {notice ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{notice}</div> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Escrow balance" value={formatInr(overview?.platformEscrowBalance)} />
        <MetricCard label="Platform revenue balance" value={formatInr(overview?.platformRevenueBalance)} />
        <MetricCard label="Pending supplier payout" value={formatInr(overview?.payoutAmountPending)} />
        <MetricCard label="Total completed top-ups" value={formatInr(overview?.topupAmountCompleted)} />
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <MetricCard label="Pending payout count" value={overview?.payoutCountPending ?? 0} />
        <MetricCard label="Completed top-up count" value={overview?.topupCountCompleted ?? 0} />
        <MetricCard label="Lifetime platform fee booked" value={formatInr(overview?.lifetimePlatformFeeBooked)} />
      </div>

      <div className="mb-4 rounded-lg border bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Pending withdrawal requests</h2>
          <span className="text-xs text-slate-500">Approve to debit wallet; reject to cancel request</span>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : withdrawals.length === 0 ? (
          <p className="text-sm text-slate-500">No pending withdrawal requests.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="px-2 py-2">When</th>
                  <th className="px-2 py-2">User</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2">Bank</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2">Note</th>
                  <th className="px-2 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="px-2 py-2 text-slate-600">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="px-2 py-2 text-slate-900">
                      <div className="font-medium">{row.user?.name || row.user?.email || '-'}</div>
                      <div className="text-xs text-slate-500">{row.user?.company || row.user?.id || '-'}</div>
                    </td>
                    <td className="px-2 py-2 capitalize text-slate-700">{row.user?.userType || '-'}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">
                      {row.bankAccount?.upiId || `${row.bankAccount?.accountNumberMasked || '-'} ${row.bankAccount?.ifscCode || ''}`}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold text-slate-900">{formatInr(row.amount)}</td>
                    <td className="px-2 py-2 text-slate-600">{row.note || '-'}</td>
                    <td className="px-2 py-2">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => processWithdrawal(row, 'reject')}>
                          Reject
                        </Button>
                        <Button size="sm" onClick={() => processWithdrawal(row, 'approve')}>
                          Approve
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mb-4 rounded-lg border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Individual user wallet balances and spend</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={userWalletType}
              onChange={(e) => setUserWalletType(e.target.value)}
              className="h-9 rounded-md border px-2 text-sm"
            >
              <option value="customer">Service provider wallets</option>
              <option value="supplier">Supplier wallets</option>
            </select>
            <input
              value={userSearchInput}
              onChange={(e) => setUserSearchInput(e.target.value)}
              placeholder="Search name/company/email"
              className="h-9 rounded-md border px-2 text-sm"
            />
            <Button variant="outline" onClick={() => loadData(walletType, cursor, filters)} disabled={loading}>
              Apply
            </Button>
          </div>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : userWalletSummary.length === 0 ? (
          <p className="text-sm text-slate-500">No user wallets found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="px-2 py-2">User</th>
                  <th className="px-2 py-2">User ID</th>
                  <th className="px-2 py-2">Wallet ID</th>
                  <th className="px-2 py-2">Type</th>
                  <th className="px-2 py-2 text-right">Wallet Balance</th>
                  <th className="px-2 py-2 text-right">Credit</th>
                  <th className="px-2 py-2 text-right">Debit</th>
                  <th className="px-2 py-2 text-right">Order Spend</th>
                </tr>
              </thead>
              <tbody>
                {userWalletSummary.map((row) => (
                  <tr key={row.walletId || row.userId} className="border-b last:border-b-0">
                    <td className="px-2 py-2">
                      <div className="font-medium text-slate-900">{row.name || '-'}</div>
                      <div className="text-xs text-slate-500">{row.company || row.email || '-'}</div>
                    </td>
                    <td className="px-2 py-2 text-xs text-slate-600">{row.userId || '-'}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">{row.walletId || '-'}</td>
                    <td className="px-2 py-2 capitalize text-slate-700">{row.userType || '-'}</td>
                    <td className="px-2 py-2 text-right font-semibold text-slate-900">{formatInr(row.currentBalance)}</td>
                    <td className="px-2 py-2 text-right text-green-700">{formatInr(row.totalCredit)}</td>
                    <td className="px-2 py-2 text-right text-rose-700">{formatInr(row.totalDebit)}</td>
                    <td className="px-2 py-2 text-right font-semibold text-indigo-700">{formatInr(row.totalOrderSpend)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">Transaction Summary</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={walletType}
              onChange={(e) => setWalletType(e.target.value)}
              className="h-9 rounded-md border px-2 text-sm"
            >
              <option value="platform_escrow">Platform Escrow</option>
              <option value="platform_revenue">Platform Revenue</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="h-9 rounded-md border px-2 text-sm"
            >
              <option value="created_at_desc">Newest first</option>
              <option value="created_at_asc">Oldest first</option>
              <option value="amount_desc">Amount high to low</option>
              <option value="amount_asc">Amount low to high</option>
            </select>
            <Button variant="outline" onClick={downloadCsv} disabled={!transactions.length}>
              Download page CSV
            </Button>
            <Button variant="outline" onClick={downloadAllCsv} disabled={exportingAll}>
              {exportingAll ? 'Exporting...' : 'Download all CSV'}
            </Button>
          </div>
        </div>
        <div className="mb-3 grid gap-2 md:grid-cols-4">
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by type/order/person"
            className="h-9 rounded-md border px-2 text-sm"
          />
          <input
            type="date"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="h-9 rounded-md border px-2 text-sm"
          />
          <input
            type="date"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            className="h-9 rounded-md border px-2 text-sm"
          />
          <Button
            variant="outline"
            onClick={() => {
              setFilters({ search: '', from: '', to: '' });
              setSearchInput('');
              setFromInput('');
              setToInput('');
              setCursor(null);
              setCursorHistory([]);
            }}
          >
            Reset filters
          </Button>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setFilters({
                search: searchInput.trim(),
                from: fromInput,
                to: toInput
              });
              setCursor(null);
              setCursorHistory([]);
            }}
          >
            Apply filters
          </Button>
          <Button
            variant="outline"
            disabled={!cursorHistory.length}
            onClick={() => {
              setCursorHistory((prev) => {
                if (!prev.length) return prev;
                const next = [...prev];
                const previousCursor = next.pop();
                setCursor(previousCursor || null);
                return next;
              });
            }}
          >
            Previous page
          </Button>
          <Button
            variant="outline"
            disabled={!pageInfo?.hasMore || !pageInfo?.nextCursor}
            onClick={() => {
              setCursorHistory((prev) => [...prev, cursor]);
              setCursor(pageInfo.nextCursor);
            }}
          >
            Next page
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-slate-500">Loading...</p>
        ) : transactions.length === 0 ? (
          <p className="text-sm text-slate-500">No wallet transactions found for this ledger.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <div className="bg-[#6e1129] px-3 py-2 text-sm font-semibold text-white">Transaction Summary</div>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-100 text-left text-slate-700">
                  <th className="px-2 py-2">Date</th>
                  <th className="px-2 py-2">Transaction details</th>
                  <th className="px-2 py-2 text-right">Amount</th>
                  <th className="px-2 py-2">Debit / Credit</th>
                  <th className="px-2 py-2">Payment Method</th>
                  <th className="px-2 py-2">Project ID</th>
                  <th className="px-2 py-2">Transaction ID</th>
                  <th className="px-2 py-2">Paid By</th>
                  <th className="px-2 py-2">Paid To</th>
                  <th className="px-2 py-2 text-right">Gross</th>
                  <th className="px-2 py-2 text-right">Fee</th>
                  <th className="px-2 py-2 text-right">Supplier Net</th>
                </tr>
              </thead>
              <tbody>
                {sortedTransactions.map((row) => (
                  <tr
                    key={row.id}
                    className="cursor-pointer border-b last:border-b-0 hover:bg-slate-50"
                    onClick={() => setSelectedTransaction(row)}
                  >
                    <td className="px-2 py-2 text-slate-600">{new Date(row.created_at).toLocaleDateString()}</td>
                    <td className="px-2 py-2 font-medium text-slate-900">{row.description || row.transaction_type || '-'}</td>
                    <td
                      className={`px-2 py-2 text-right font-semibold ${row.direction === 'credit' ? 'text-green-600' : 'text-rose-600'}`}
                    >
                      {signedAmount(row)}
                    </td>
                    <td className="px-2 py-2 text-slate-700">{directionLabel(row.direction)}</td>
                    <td className="px-2 py-2 text-slate-700">Wallet</td>
                    <td className="px-2 py-2 text-slate-600">{row.orderNumber || row.orderId || '-'}</td>
                    <td className="px-2 py-2 text-xs text-slate-600">{row.id || '-'}</td>
                    <td className="px-2 py-2 text-slate-700">{row.paidBy?.label || '-'}</td>
                    <td className="px-2 py-2 text-slate-700">{row.paidTo?.label || '-'}</td>
                    <td className="px-2 py-2 text-right text-slate-900">{formatInr(row.grossAmount)}</td>
                    <td className="px-2 py-2 text-right text-amber-700">{formatInr(row.platformFeeAmount)}</td>
                    <td className="px-2 py-2 text-right text-green-700">{formatInr(row.supplierPayoutAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {selectedTransaction ? (
        <AdminWalletRowDetail row={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
      ) : null}
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function AdminWalletRowDetail({ row, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Transaction detail</h3>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        <pre className="max-h-[60vh] overflow-auto rounded-md bg-slate-50 p-3 text-xs text-slate-800">
          {JSON.stringify(row, null, 2)}
        </pre>
      </div>
    </div>
  );
}
