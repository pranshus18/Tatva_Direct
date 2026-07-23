import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Wallet as VaultIcon, RefreshCw } from 'lucide-react';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import { Button } from '@/components/ui/button';
import { formatDateTimeIST, parseServerDate } from '../utils/dateTime';
import {
  loadVaultSnapshot
} from '../services/vaultService';
import VaultAddMoneyPanel from '../components/VaultAddMoneyPanel';

const STATEMENT_HEADER_BG = '#7a2433';

const formatInr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const directionLabel = (direction) =>
  String(direction || '').toLowerCase() === 'credit' ? 'Credit' : 'Debit';

/** Match PM reconciliation statement date style: 22 Jul '26 */
function formatStatementDate(value, fallback = '—') {
  const date = parseServerDate(value);
  if (!date) return fallback;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${Number(map.day)} ${map.month} '${map.year}`;
}

function filterTransactions(rows, filters) {
  let next = [...rows];
  const search = String(filters.search || '').trim().toLowerCase();
  if (search) {
    next = next.filter((row) =>
      [
        row.details,
        row.description,
        row.transaction_type,
        row.payment_method,
        row.paymentMethod,
        row.flag,
        row.project_id,
        row.projectId,
        row.orderNumber,
        row.orderId,
        row.transaction_id,
        row.id
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search)
    );
  }
  if (filters.from) {
    const fromTs = new Date(`${filters.from}T00:00:00.000Z`).getTime();
    next = next.filter((row) => new Date(row.created_at || row.date).getTime() >= fromTs);
  }
  if (filters.to) {
    const toTs = new Date(`${filters.to}T23:59:59.999Z`).getTime();
    next = next.filter((row) => new Date(row.created_at || row.date).getTime() <= toTs);
  }
  return next;
}

export default function VaultPage({ variant = 'service_provider' }) {
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [balance, setBalance] = useState(0);
  const [ledgerSummary, setLedgerSummary] = useState({
    totalCredit: 0,
    totalDebit: 0,
    netFlow: 0,
    transactionCount: 0
  });
  const [transactions, setTransactions] = useState([]);
  const [vaultConfig, setVaultConfig] = useState({
    minTopupInr: 100,
    razorpay: { enabled: false },
    pmVault: { enabled: true }
  });
  const [notice, setNotice] = useState('');
  const [topupAmount, setTopupAmount] = useState('1000');
  const [searchInput, setSearchInput] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [filters, setFilters] = useState({ search: '', from: '', to: '' });
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [sortBy, setSortBy] = useState('created_at_desc');

  const loadVaultData = async () => {
    setLoading(true);
    setNotice('');
    try {
      const snapshot = await loadVaultSnapshot();
      setBalance(snapshot.balance);
      setLedgerSummary(snapshot.summary);
      setTransactions(snapshot.transactions);
      setVaultConfig(snapshot.config);
    } catch (e) {
      const message =
        e.code === 'PM_AUTH_REQUIRED' || e.status === 401
          ? 'Vault session expired. Sign out and sign in again with phone OTP to access your PM vault.'
          : e.message || 'Failed to load vault data';
      setNotice(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVaultData();
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(loadVaultData, 20000);
    return () => window.clearInterval(intervalId);
  }, []);

  const filteredTransactions = useMemo(
    () => filterTransactions(transactions, filters),
    [transactions, filters]
  );

  const sortedTransactions = useMemo(() => {
    const rows = [...filteredTransactions];
    if (sortBy === 'created_at_asc') {
      rows.sort(
        (a, b) =>
          new Date(a.created_at || a.date).getTime() - new Date(b.created_at || b.date).getTime()
      );
    } else if (sortBy === 'amount_asc') {
      rows.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
    } else if (sortBy === 'amount_desc') {
      rows.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    } else {
      rows.sort(
        (a, b) =>
          new Date(b.created_at || b.date).getTime() - new Date(a.created_at || a.date).getTime()
      );
    }
    return rows;
  }, [filteredTransactions, sortBy]);

  const downloadCsv = () => {
    const header = [
      'Date',
      'Transaction details',
      'Amount',
      'Debit / Credit',
      'Payment Method',
      'Platform',
      'Project ID',
      'Transaction ID'
    ];
    const lines = sortedTransactions.map((row) => [
      formatStatementDate(row.created_at || row.date, ''),
      row.details || row.description || row.transaction_type || '',
      Number(row.amount || 0).toFixed(2),
      row.debit_credit || directionLabel(row.direction),
      row.payment_method || row.paymentMethod || 'Wallet',
      row.flag || '',
      row.project_id || row.projectId || '',
      row.transaction_id || row.id || ''
    ]);
    const csv = [header, ...lines]
      .map((cols) =>
        cols.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')
      )
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-statement-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleVaultUpdated = async () => {
    setNotice('Vault credited successfully.');
    await loadVaultData();
  };

  const handleVaultError = (message) => {
    setNotice(message || 'Vault top-up failed');
  };

  const pageBody = (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-4">
        <div className="text-sm text-slate-500">Vault balance</div>
        <div className="text-2xl font-bold text-slate-900">
          {loading ? 'Loading…' : formatInr(balance)}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Shared PM platform vault — same balance on Tatva Direct and Tatva PM.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">Total credit</div>
          <div className="text-xl font-semibold text-green-700">{formatInr(ledgerSummary.totalCredit)}</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">Total debit</div>
          <div className="text-xl font-semibold text-rose-700">{formatInr(ledgerSummary.totalDebit)}</div>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <div className="text-xs text-slate-500">Transactions</div>
          <div className="text-xl font-semibold text-slate-900">
            {Number(ledgerSummary.transactionCount || transactions.length || 0)}
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-white p-4">
        <div className="mb-2 text-sm font-medium text-slate-700">Add money to vault</div>
        <VaultAddMoneyPanel
          variant="page"
          showPresets
          amount={topupAmount}
          onAmountChange={setTopupAmount}
          minTopupInr={vaultConfig?.minTopupInr || 100}
          processing={processing}
          onProcessingChange={(value) => {
            setProcessing(value);
            if (value) setNotice('');
          }}
          disabled={loading}
          onSuccess={handleVaultUpdated}
          onError={handleVaultError}
        />
      </div>

      {notice ? (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
          {notice}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border bg-white">
        <div className="border-b px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                Reconciliation statement
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Transactions for your Customer profile
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              <Button variant="outline" onClick={downloadCsv} disabled={!sortedTransactions.length}>
                Download CSV
              </Button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search transactions"
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
              onClick={() =>
                setFilters({
                  search: searchInput.trim(),
                  from: fromInput,
                  to: toInput
                })
              }
            >
              Apply filters
            </Button>
          </div>
        </div>

        <div
          className="px-4 py-2.5 text-sm font-semibold text-white sm:px-5"
          style={{ backgroundColor: STATEMENT_HEADER_BG }}
        >
          Transaction Summary
        </div>

        {loading ? (
          <p className="px-4 py-6 text-sm text-slate-500 sm:px-5">Loading reconciliation statement…</p>
        ) : sortedTransactions.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 sm:px-5">No vault transactions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-600">
                  <th className="px-4 py-3 font-medium sm:px-5">Date</th>
                  <th className="px-4 py-3 font-medium sm:px-5">Transaction details</th>
                  <th className="px-4 py-3 text-right font-medium sm:px-5">Amount</th>
                  <th className="px-4 py-3 font-medium sm:px-5">Debit / Credit</th>
                  <th className="px-4 py-3 font-medium sm:px-5">Payment Method</th>
                  <th className="px-4 py-3 font-medium sm:px-5">Platform</th>
                  <th className="px-4 py-3 font-medium sm:px-5">Project ID</th>
                  <th className="px-4 py-3 font-medium sm:px-5">Transaction ID</th>
                </tr>
              </thead>
              <tbody>
                {sortedTransactions.map((row) => {
                  const projectId = row.project_id || row.projectId;
                  return (
                    <tr
                      key={row.transaction_id || row.id}
                      className="cursor-pointer border-b border-slate-200 last:border-b-0 hover:bg-slate-50"
                      onClick={() => setSelectedTransaction(row)}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700 sm:px-5">
                        {formatStatementDate(row.created_at || row.date)}
                      </td>
                      <td className="px-4 py-3 text-slate-900 sm:px-5">
                        {row.details || row.description || row.transaction_type || '—'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-slate-900 sm:px-5">
                        {formatInr(row.amount)}
                      </td>
                      <td className="px-4 py-3 text-slate-700 sm:px-5">
                        {row.debit_credit || directionLabel(row.direction)}
                      </td>
                      <td className="px-4 py-3 text-slate-700 sm:px-5">
                        {row.payment_method || row.paymentMethod || 'Wallet'}
                      </td>
                      <td className="px-4 py-3 text-slate-700 sm:px-5">{row.flag || '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 sm:px-5">
                        {projectId || '—'}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600 sm:px-5">
                        {row.transaction_id || row.id || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedTransaction ? (
        <TransactionDetailModal row={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
      ) : null}
    </div>
  );

  if (variant === 'supplier') {
    return (
      <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
              <VaultIcon className="h-6 w-6" />
              Vault balance
            </h1>
            <p className="text-sm text-slate-500">PM platform vault shared across Tatva portals.</p>
          </div>
          <Button variant="outline" onClick={loadVaultData} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>
        {pageBody}
      </div>
    );
  }

  return (
    <SpPageLayout showStepper={false}>
      <SpPageHeader
        title="Vault balance"
        description="PM platform vault — credit, view reconciliation statement, and pay for orders."
        icon={VaultIcon}
        actions={
          <Button variant="outline" onClick={loadVaultData} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        }
      />
      {pageBody}
    </SpPageLayout>
  );
}

function TransactionDetailModal({ row, onClose }) {
  const modalNode = (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Transaction detail</h3>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="modal-body space-y-2 text-sm">
          <Detail label="When" value={formatDateTimeIST(row.created_at || row.date, '—')} />
          <Detail label="Details" value={row.details || row.description} />
          <Detail label="Debit / Credit" value={row.debit_credit || directionLabel(row.direction)} />
          <Detail label="Amount" value={formatInr(row.amount)} />
          <Detail label="Payment Method" value={row.payment_method || row.paymentMethod || 'Wallet'} />
          <Detail label="Platform" value={row.flag || '—'} />
          <Detail label="Project ID" value={row.project_id || row.projectId || '—'} />
          <Detail label="Transaction ID" value={row.transaction_id || row.id} />
          <Detail label="Reference" value={row.reference || row.transactionId || '—'} />
          <Detail label="Order" value={row.orderNumber || row.orderId || '—'} />
          <Detail label="Payment ID" value={row.paymentId || '—'} />
          <Detail label="Balance after" value={formatInr(row.balance_after)} />
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modalNode;
  return createPortal(modalNode, document.body);
}

function Detail({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b pb-1">
      <div className="text-slate-500">{label}</div>
      <div className="text-right font-medium text-slate-900">{value || '—'}</div>
    </div>
  );
}
