import React, { useEffect, useMemo, useState } from 'react';
import { Wallet as WalletIcon, RefreshCw } from 'lucide-react';
import { getApiUrl } from '../config/api';
import { Button } from '@/components/ui/button';
import { formatDateIST, formatDateTimeIST } from '../utils/dateTime';

const formatInr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const directionLabel = (direction) => (String(direction || '').toLowerCase() === 'credit' ? 'Credit' : 'Debit');
const signedAmount = (row) =>
  `${String(row?.direction || '').toLowerCase() === 'credit' ? '+' : '-'}${formatInr(row?.amount || 0)}`;

const INDIAN_BANK_OPTIONS = [
  'State Bank of India',
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'Punjab National Bank',
  'Bank of Baroda',
  'Kotak Mahindra Bank',
  'Canara Bank',
  'Union Bank of India',
  'IDFC FIRST Bank',
  'IndusInd Bank',
  'Other'
];

const formatBankAccountLabel = (account) => {
  if (!account) return '';
  const bank = String(account.bank_name || '').trim();
  const holder = String(account.account_holder_name || '').trim();
  const number = String(account.account_number || '').trim();
  const masked = number ? `****${number.slice(-4)}` : '';
  const upi = String(account.upi_id || '').trim();
  if (bank && masked) return `${bank} (${masked})${holder ? ` - ${holder}` : ''}`;
  if (upi) return `UPI ${upi}${holder ? ` - ${holder}` : ''}`;
  return holder || account.id;
};


export default function SupplierWallet() {
  const [loading, setLoading] = useState(true);
  const [processingTopup, setProcessingTopup] = useState(false);
  const [balance, setBalance] = useState(0);
  const [ledgerSummary, setLedgerSummary] = useState({
    totalCredit: 0,
    totalDebit: 0,
    netFlow: 0,
    transactionCount: 0
  });
  const [transactions, setTransactions] = useState([]);
  const [payouts, setPayouts] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState('');
  const [txPageInfo, setTxPageInfo] = useState({ hasMore: false, nextCursor: null });
  const [payoutPageInfo, setPayoutPageInfo] = useState({ hasMore: false, nextCursor: null });
  const [txCursor, setTxCursor] = useState(null);
  const [payoutCursor, setPayoutCursor] = useState(null);
  const [txCursorHistory, setTxCursorHistory] = useState([]);
  const [payoutCursorHistory, setPayoutCursorHistory] = useState([]);
  const [summary, setSummary] = useState({
    totalNet: 0,
    totalFee: 0,
    pendingNet: 0,
    releasedNet: 0
  });
  const [notice, setNotice] = useState('');
  const [topupAmount, setTopupAmount] = useState('1000');
  const [walletConfig, setWalletConfig] = useState({ minTopupInr: 100, razorpay: { enabled: false } });
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawNote, setWithdrawNote] = useState('');
  const [bankDetails, setBankDetails] = useState({
    accountHolderName: '',
    bankName: '',
    accountNumber: '',
    ifscCode: '',
    upiId: ''
  });
  const [searchInput, setSearchInput] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [filters, setFilters] = useState({ search: '', from: '', to: '' });
  const [selectedRow, setSelectedRow] = useState(null);
  const [txSortBy, setTxSortBy] = useState('created_at_desc');
  const [payoutSortBy, setPayoutSortBy] = useState('created_at_desc');
  const [exportingAllTx, setExportingAllTx] = useState(false);
  const [exportingAllPayouts, setExportingAllPayouts] = useState(false);

  const buildQueryString = (nextFilters, nextCursor = null, limit = 50) => {
    const qs = new URLSearchParams({ limit: String(limit) });
    if (nextCursor) qs.set('cursor', nextCursor);
    if (nextFilters.search) qs.set('search', nextFilters.search);
    if (nextFilters.from) qs.set('from', `${nextFilters.from}T00:00:00.000Z`);
    if (nextFilters.to) qs.set('to', `${nextFilters.to}T23:59:59.999Z`);
    return qs.toString();
  };

  const loadData = async ({
    nextTxCursor = txCursor,
    nextPayoutCursor = payoutCursor,
    nextFilters = filters
  } = {}) => {
    setLoading(true);
    setNotice('');
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const headers = { Authorization: `Bearer ${token}` };
      const [balanceResp, txResp, payoutResp, bankResp, withdrawalResp, summaryResp, configResp] = await Promise.all([
        fetch(getApiUrl('/api/supplier/wallet/balance'), { headers }),
        fetch(getApiUrl(`/api/supplier/wallet/transactions?${buildQueryString(nextFilters, nextTxCursor, 50)}`), { headers }),
        fetch(getApiUrl(`/api/supplier/wallet/payouts?${buildQueryString(nextFilters, nextPayoutCursor, 50)}`), { headers }),
        fetch(getApiUrl('/api/supplier/wallet/withdraw/bank-accounts'), { headers }),
        fetch(getApiUrl('/api/supplier/wallet/withdrawals?limit=20'), { headers }),
        fetch(getApiUrl('/api/supplier/wallet/ledger-summary'), { headers }),
        fetch(getApiUrl('/api/supplier/wallet/config'), { headers })
      ]);
      const balanceData = await balanceResp.json().catch(() => ({}));
      const txData = await txResp.json().catch(() => ({}));
      const payoutData = await payoutResp.json().catch(() => ({}));
      const bankData = await bankResp.json().catch(() => ({}));
      const withdrawalData = await withdrawalResp.json().catch(() => ({}));
      const summaryData = await summaryResp.json().catch(() => ({}));
      const configData = await configResp.json().catch(() => ({}));
      if (!balanceResp.ok || balanceData.status !== 'success') {
        throw new Error(balanceData.message || 'Failed to load supplier wallet balance');
      }
      if (!txResp.ok || txData.status !== 'success') {
        throw new Error(txData.message || 'Failed to load supplier wallet transactions');
      }
      if (!payoutResp.ok || payoutData.status !== 'success') {
        throw new Error(payoutData.message || 'Failed to load supplier payout tracking');
      }
      if (!bankResp.ok || bankData.status !== 'success') {
        throw new Error(bankData.message || 'Failed to load withdrawal bank details');
      }
      if (!withdrawalResp.ok || withdrawalData.status !== 'success') {
        throw new Error(withdrawalData.message || 'Failed to load withdrawal requests');
      }
      if (!summaryResp.ok || summaryData.status !== 'success') {
        throw new Error(summaryData.message || 'Failed to load wallet statement summary');
      }
      if (!configResp.ok || configData.status !== 'success') {
        throw new Error(configData.message || 'Failed to load wallet credit configuration');
      }
      setBalance(Number(balanceData.balance || 0));
      setLedgerSummary(
        summaryData.summary || {
          totalCredit: 0,
          totalDebit: 0,
          netFlow: 0,
          transactionCount: 0
        }
      );
      setWalletConfig(configData.config || { minTopupInr: 100, razorpay: { enabled: false } });
      setTransactions(txData.transactions || []);
      setTxPageInfo(txData.pageInfo || { hasMore: false, nextCursor: null });
      setPayouts(payoutData.payouts || []);
      const bankAccountRows = bankData.bankAccounts || [];
      setBankAccounts(bankAccountRows);
      setSelectedBankAccountId((prev) => {
        if (prev && bankAccountRows.some((row) => row.id === prev)) return prev;
        return bankAccountRows.find((row) => row.is_default)?.id || bankAccountRows[0]?.id || '';
      });
      setWithdrawals(withdrawalData.withdrawals || []);
      setPayoutPageInfo(payoutData.pageInfo || { hasMore: false, nextCursor: null });
      setSummary(
        payoutData.summary || {
          totalNet: 0,
          totalFee: 0,
          pendingNet: 0,
          releasedNet: 0
        }
      );
    } catch (e) {
      setNotice(e.message || 'Failed to load wallet data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData({ nextTxCursor: txCursor, nextPayoutCursor: payoutCursor, nextFilters: filters });
  }, [txCursor, payoutCursor, filters]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadData({ nextTxCursor: txCursor, nextPayoutCursor: payoutCursor, nextFilters: filters });
    }, 20000);
    return () => window.clearInterval(intervalId);
  }, [txCursor, payoutCursor, filters]);

  const sortedTransactions = useMemo(() => {
    const rows = [...transactions];
    if (txSortBy === 'created_at_asc') rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (txSortBy === 'amount_asc') rows.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
    else if (txSortBy === 'amount_desc') rows.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    else rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return rows;
  }, [transactions, txSortBy]);

  const sortedPayouts = useMemo(() => {
    const rows = [...payouts];
    if (payoutSortBy === 'created_at_asc') rows.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    else if (payoutSortBy === 'net_amount_asc') rows.sort((a, b) => Number(a.net_amount || 0) - Number(b.net_amount || 0));
    else if (payoutSortBy === 'net_amount_desc') rows.sort((a, b) => Number(b.net_amount || 0) - Number(a.net_amount || 0));
    else rows.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return rows;
  }, [payouts, payoutSortBy]);

  const toCsv = (rows) =>
    rows
      .map((cols) =>
        cols
          .map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`)
          .join(',')
      )
      .join('\n');

  const downloadTransactionsCsv = () => {
    const header = [
      'Date',
      'Transaction details',
      'Amount',
      'Debit/Credit',
      'Payment Method',
      'Project ID',
      'Balance After',
      'Transaction ID'
    ];
    const lines = sortedTransactions.map((row) => [
      new Date(row.created_at).toISOString(),
      row.description || row.transaction_type || '',
      Number(row.amount || 0).toFixed(2),
      directionLabel(row.direction),
      'Wallet',
      row.orderNumber || row.orderId || '-',
      Number(row.balance_after || 0).toFixed(2),
      row.id || ''
    ]);
    const blob = new Blob([toCsv([header, ...lines])], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `supplier-wallet-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPayoutsCsv = () => {
    const header = ['When', 'Paid By', 'Paid To', 'Order', 'Gross', 'Fee', 'Net', 'Status'];
    const lines = sortedPayouts.map((row) => [
      new Date(row.created_at).toISOString(),
      row.paidBy?.label || '',
      row.paidTo?.label || '',
      row.orderNumber || row.order_id || '',
      Number(row.gross_amount || 0).toFixed(2),
      Number(row.platform_fee_amount || 0).toFixed(2),
      Number(row.net_amount || 0).toFixed(2),
      row.status || ''
    ]);
    const blob = new Blob([toCsv([header, ...lines])], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `supplier-payout-history-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllTransactionsCsv = async () => {
    if (exportingAllTx) return;
    setExportingAllTx(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const headers = { Authorization: `Bearer ${token}` };
      const allRows = [];
      let nextCursor = null;
      let pages = 0;
      do {
        const resp = await fetch(
          getApiUrl(`/api/supplier/wallet/transactions?${buildQueryString(filters, nextCursor, 200)}`),
          { headers }
        );
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.status !== 'success') throw new Error(data.message || 'Failed export');
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
        'Balance After',
        'Transaction ID'
      ];
      const lines = allRows.map((row) => [
        new Date(row.created_at).toISOString(),
        row.description || row.transaction_type || '',
        Number(row.amount || 0).toFixed(2),
        directionLabel(row.direction),
        'Wallet',
        row.orderNumber || row.orderId || '-',
        Number(row.balance_after || 0).toFixed(2),
        row.id || ''
      ]);
      const blob = new Blob([toCsv([header, ...lines])], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `supplier-wallet-ledger-all-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setNotice(e.message || 'Failed to export all supplier transactions');
    } finally {
      setExportingAllTx(false);
    }
  };

  const downloadAllPayoutsCsv = async () => {
    if (exportingAllPayouts) return;
    setExportingAllPayouts(true);
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const headers = { Authorization: `Bearer ${token}` };
      const allRows = [];
      let nextCursor = null;
      let pages = 0;
      do {
        const resp = await fetch(
          getApiUrl(`/api/supplier/wallet/payouts?${buildQueryString(filters, nextCursor, 200)}`),
          { headers }
        );
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.status !== 'success') throw new Error(data.message || 'Failed payout export');
        allRows.push(...(data.payouts || []));
        nextCursor = data?.pageInfo?.hasMore ? data?.pageInfo?.nextCursor || null : null;
        pages += 1;
      } while (nextCursor && pages < 200);
      const header = ['When', 'Paid By', 'Paid To', 'Order', 'Gross', 'Fee', 'Net', 'Status'];
      const lines = allRows.map((row) => [
        new Date(row.created_at).toISOString(),
        row.paidBy?.label || '',
        row.paidTo?.label || '',
        row.orderNumber || row.order_id || '',
        Number(row.gross_amount || 0).toFixed(2),
        Number(row.platform_fee_amount || 0).toFixed(2),
        Number(row.net_amount || 0).toFixed(2),
        row.status || ''
      ]);
      const blob = new Blob([toCsv([header, ...lines])], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `supplier-payout-history-all-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setNotice(e.message || 'Failed to export all payout rows');
    } finally {
      setExportingAllPayouts(false);
    }
  };

  const handleWithdraw = async () => {
    if (withdrawing) return;
    const amount = Number(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice('Enter a valid withdrawal amount');
      return;
    }
    if (!selectedBankAccountId) {
      setNotice('Please add and select a bank account before withdrawing.');
      return;
    }
    setWithdrawing(true);
    setNotice('');
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const resp = await fetch(getApiUrl('/api/supplier/wallet/withdraw'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          amount,
          note: withdrawNote.trim() || null,
          bankAccountId: selectedBankAccountId,
          idempotencyKey: `supplier-wallet-withdraw-ui-${Date.now()}`
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.status !== 'success') throw new Error(data.message || 'Failed to withdraw');
      setWithdrawAmount('');
      setWithdrawNote('');
      setNotice('Withdrawal request submitted. Admin will review and process it.');
      await loadData({ nextTxCursor: txCursor, nextPayoutCursor: payoutCursor, nextFilters: filters });
    } catch (e) {
      setNotice(e.message || 'Failed to withdraw from supplier wallet');
    } finally {
      setWithdrawing(false);
    }
  };

  const loadRazorpayScript = () =>
    new Promise((resolve) => {
      if (window.Razorpay) return resolve(true);
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });

  const handleTopup = async () => {
    if (processingTopup) return;
    const amount = Number(topupAmount);
    const minTopup = Number(walletConfig?.minTopupInr || 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice('Enter a valid credit amount');
      return;
    }
    if (amount < minTopup) {
      setNotice(`Minimum credit amount is INR ${minTopup}`);
      return;
    }
    if (!walletConfig?.razorpay?.isConfigured) {
      setNotice('Razorpay credentials are not configured. Please configure gateway keys to continue.');
      return;
    }
    setProcessingTopup(true);
    setNotice('');
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const createResp = await fetch(getApiUrl('/api/supplier/wallet/topup/create'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          amount,
          idempotencyKey: `supplier-wallet-topup-ui-${Date.now()}`
        })
      });
      const createData = await createResp.json().catch(() => ({}));
      if (!createResp.ok || createData.status !== 'success') {
        throw new Error(createData.message || 'Failed to create wallet credit request');
      }

      const paymentIntent = createData.paymentIntent || {};

      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) throw new Error('Unable to load Razorpay checkout');
      const options = {
        key: paymentIntent.keyId,
        order_id: paymentIntent.orderId,
        name: 'Tatva Direct',
        description: 'Supplier wallet credit',
        amount: paymentIntent.amount,
        currency: paymentIntent.currency || 'INR',
        handler: async (response) => {
          try {
            const confirmResp = await fetch(getApiUrl('/api/supplier/wallet/topup/confirm'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature
              })
            });
            const confirmData = await confirmResp.json().catch(() => ({}));
            if (!confirmResp.ok || confirmData.status !== 'success') {
              throw new Error(confirmData.message || 'Wallet credit confirmation failed');
            }
            setNotice('Supplier wallet credited successfully.');
            await loadData({ nextTxCursor: txCursor, nextPayoutCursor: payoutCursor, nextFilters: filters });
          } catch (e) {
            setNotice(e.message || 'Wallet credit completed but confirmation failed');
          } finally {
            setProcessingTopup(false);
          }
        },
        modal: {
          ondismiss: () => setProcessingTopup(false)
        },
        theme: { color: '#4f46e5' }
      };
      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (e) {
      setNotice(e.message || 'Failed to start wallet credit');
      setProcessingTopup(false);
    }
  };

  const handleSaveBankDetails = async () => {
    try {
      const hasUpi = Boolean(String(bankDetails.upiId || '').trim());
      const hasAccount = Boolean(String(bankDetails.accountNumber || '').trim());
      const hasIfsc = Boolean(String(bankDetails.ifscCode || '').trim());
      if (!hasUpi && !(hasAccount && hasIfsc)) {
        throw new Error('Enter UPI ID, or account number + IFSC code to save bank details.');
      }
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const resp = await fetch(getApiUrl('/api/supplier/wallet/withdraw/bank-accounts'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(bankDetails)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.status !== 'success') throw new Error(data.message || 'Failed to save bank details');
      if (data.bankAccount?.id) setSelectedBankAccountId(data.bankAccount.id);
      await loadData({ nextTxCursor: txCursor, nextPayoutCursor: payoutCursor, nextFilters: filters });
      setNotice('Withdrawal bank details saved. You can now select this account for withdrawal.');
    } catch (e) {
      setNotice(e.message || 'Failed to save bank details');
    }
  };

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <WalletIcon className="h-6 w-6" />
            Supplier Wallet
          </h1>
          <p className="text-sm text-slate-500">Track payout releases, ledger entries, and wallet balance.</p>
        </div>
        <Button variant="outline" onClick={loadData} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {notice ? <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{notice}</div> : null}

      <div className="mb-4 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Wallet balance" value={formatInr(balance)} />
        <MetricCard label="Total Credit" value={formatInr(ledgerSummary.totalCredit)} />
        <MetricCard label="Total Debit" value={formatInr(ledgerSummary.totalDebit)} />
        <MetricCard label="Pending payout" value={formatInr(summary.pendingNet)} />
        <MetricCard label="Released payout" value={formatInr(summary.releasedNet)} />
        <MetricCard label="Platform fee tracked" value={formatInr(summary.totalFee)} />
      </div>
      <div className="mb-4 rounded-lg border bg-white p-4">
        <div className="mb-2 text-sm font-medium text-slate-700">Credit supplier wallet</div>
        <div className="mb-2 flex flex-wrap gap-2">
          {[walletConfig?.minTopupInr || 100, 500, 1000, 2000, 5000].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setTopupAmount(String(preset))}
              className="rounded-md border px-3 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              +{formatInr(preset)}
            </button>
          ))}
        </div>
        <div className="mb-2 text-xs text-slate-600">
          <strong>Payment Gateway:</strong> Razorpay
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min={Number(walletConfig?.minTopupInr || 100)}
            step={1}
            value={topupAmount}
            onChange={(e) => setTopupAmount(e.target.value)}
            className="h-10 rounded-md border px-3 text-sm"
            placeholder="Amount in INR"
          />
          <Button onClick={handleTopup} disabled={processingTopup}>
            {processingTopup ? 'Processing...' : 'Credit wallet'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Credit funds here before placing/paying upstream orders. Minimum credit: INR{' '}
          {Number(walletConfig?.minTopupInr || 100)}.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          On Razorpay checkout, user can choose UPI, card, net banking, or other available methods.
        </p>
      </div>
      <div className="mb-4 rounded-lg border bg-white p-4">
        <div className="mb-2 text-sm font-medium text-slate-700">Withdrawal bank details</div>
        <div className="grid gap-2 md:grid-cols-5">
          <input
            type="text"
            value={bankDetails.accountHolderName}
            onChange={(e) => setBankDetails((prev) => ({ ...prev, accountHolderName: e.target.value }))}
            placeholder="Account holder name"
            className="h-10 rounded-md border px-3 text-sm"
          />
          <select
            value={bankDetails.bankName}
            onChange={(e) => setBankDetails((prev) => ({ ...prev, bankName: e.target.value }))}
            className="h-10 rounded-md border px-3 text-sm"
          >
            <option value="">Select bank name</option>
            {INDIAN_BANK_OPTIONS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={bankDetails.accountNumber}
            onChange={(e) => setBankDetails((prev) => ({ ...prev, accountNumber: e.target.value }))}
            placeholder="Account number"
            className="h-10 rounded-md border px-3 text-sm"
          />
          <input
            type="text"
            value={bankDetails.ifscCode}
            onChange={(e) => setBankDetails((prev) => ({ ...prev, ifscCode: e.target.value }))}
            placeholder="IFSC code"
            className="h-10 rounded-md border px-3 text-sm"
          />
          <input
            type="text"
            value={bankDetails.upiId}
            onChange={(e) => setBankDetails((prev) => ({ ...prev, upiId: e.target.value }))}
            placeholder="UPI ID (optional)"
            className="h-10 rounded-md border px-3 text-sm"
          />
        </div>
        <div className="mt-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">Selected withdrawal account</label>
          <select
            value={selectedBankAccountId}
            onChange={(e) => setSelectedBankAccountId(e.target.value)}
            className="h-10 w-full rounded-md border px-3 text-sm"
          >
            <option value="">Select bank account</option>
            {bankAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {formatBankAccountLabel(account)}
              </option>
            ))}
          </select>
          {!bankAccounts.length ? (
            <p className="mt-1 text-xs text-slate-500">
              No saved bank accounts yet. Fill details above and click "Save bank details".
            </p>
          ) : null}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="outline" onClick={handleSaveBankDetails}>
            Save bank details
          </Button>
          <span className="text-xs text-slate-500">
            Current: {bankAccounts[0]?.upi_id || bankAccounts[0]?.account_number ? 'Available' : 'Not added'}
          </span>
        </div>
      </div>
      <div className="mb-4 rounded-lg border bg-white p-4">
        <div className="mb-2 text-sm font-medium text-slate-700">Withdraw from wallet</div>
        <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
          <input
            type="number"
            min={1}
            step={1}
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder="Amount in INR"
            className="h-10 rounded-md border px-3 text-sm"
          />
          <input
            type="text"
            maxLength={500}
            value={withdrawNote}
            onChange={(e) => setWithdrawNote(e.target.value)}
            placeholder="Optional note"
            className="h-10 rounded-md border px-3 text-sm"
          />
          <Button onClick={handleWithdraw} disabled={withdrawing}>
            {withdrawing ? 'Withdrawing...' : 'Withdraw'}
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Withdrawal requests are approved by admin before final debit happens in wallet ledger.
        </p>
      </div>
      <div className="mb-4 rounded-lg border bg-white p-4">
        <div className="mb-2 text-sm font-medium text-slate-700">Withdrawal request history</div>
        {!withdrawals.length ? (
          <p className="text-sm text-slate-500">No withdrawal requests yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="px-2 py-2">When</th>
                  <th className="px-2 py-2">Amount</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((row) => (
                  <tr key={row.id} className="border-b last:border-b-0">
                    <td className="px-2 py-2 text-slate-600">{formatDateTimeIST(row.created_at, '—')}</td>
                    <td className="px-2 py-2 font-medium text-slate-900">{formatInr(row.amount)}</td>
                    <td className="px-2 py-2 capitalize text-slate-700">{row.status || '-'}</td>
                    <td className="px-2 py-2 text-slate-600">{row.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="mb-4 grid gap-2 md:grid-cols-4">
        <input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search order/person/status"
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
            setTxCursor(null);
            setPayoutCursor(null);
            setTxCursorHistory([]);
            setPayoutCursorHistory([]);
          }}
        >
          Reset filters
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setFilters({ search: searchInput.trim(), from: fromInput, to: toInput });
            setTxCursor(null);
            setPayoutCursor(null);
            setTxCursorHistory([]);
            setPayoutCursorHistory([]);
          }}
        >
          Apply filters
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Transaction Summary</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={txSortBy}
                onChange={(e) => setTxSortBy(e.target.value)}
                className="h-9 rounded-md border px-2 text-sm"
              >
                <option value="created_at_desc">Newest first</option>
                <option value="created_at_asc">Oldest first</option>
                <option value="amount_desc">Amount high to low</option>
                <option value="amount_asc">Amount low to high</option>
              </select>
              <Button variant="outline" onClick={downloadTransactionsCsv} disabled={!transactions.length}>
                Download page CSV
              </Button>
              <Button variant="outline" onClick={downloadAllTransactionsCsv} disabled={exportingAllTx}>
                {exportingAllTx ? 'Exporting...' : 'Download all CSV'}
              </Button>
            </div>
          </div>
          <div className="mb-2 flex gap-2">
            <Button
              variant="outline"
              disabled={!txCursorHistory.length}
              onClick={() => {
                setTxCursorHistory((prev) => {
                  if (!prev.length) return prev;
                  const next = [...prev];
                  const previousCursor = next.pop();
                  setTxCursor(previousCursor || null);
                  return next;
                });
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={!txPageInfo?.hasMore || !txPageInfo?.nextCursor}
              onClick={() => {
                setTxCursorHistory((prev) => [...prev, txCursor]);
                setTxCursor(txPageInfo.nextCursor);
              }}
            >
              Next
            </Button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : transactions.length === 0 ? (
            <p className="text-sm text-slate-500">No supplier wallet transactions yet.</p>
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
                    <th className="px-2 py-2 text-right">Balance After</th>
                    <th className="px-2 py-2">Transaction ID</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTransactions.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b last:border-b-0 hover:bg-slate-50"
                      onClick={() => setSelectedRow(row)}
                    >
                      <td className="px-2 py-2 text-slate-600">{formatDateIST(row.created_at, '—')}</td>
                      <td className="px-2 py-2 font-medium text-slate-900">{row.description || row.transaction_type || '-'}</td>
                      <td
                        className={`px-2 py-2 text-right font-semibold ${row.direction === 'credit' ? 'text-green-600' : 'text-rose-600'}`}
                      >
                        {signedAmount(row)}
                      </td>
                      <td className="px-2 py-2 text-slate-700">{directionLabel(row.direction)}</td>
                      <td className="px-2 py-2 text-slate-700">Wallet</td>
                      <td className="px-2 py-2 text-slate-600">{row.orderNumber || row.orderId || '-'}</td>
                      <td className="px-2 py-2 text-right font-medium text-slate-900">
                        {formatInr(row.balance_after)}
                      </td>
                      <td className="px-2 py-2 text-xs text-slate-600">{row.id || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Supplier payout history</h2>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={payoutSortBy}
                onChange={(e) => setPayoutSortBy(e.target.value)}
                className="h-9 rounded-md border px-2 text-sm"
              >
                <option value="created_at_desc">Newest first</option>
                <option value="created_at_asc">Oldest first</option>
                <option value="net_amount_desc">Net high to low</option>
                <option value="net_amount_asc">Net low to high</option>
              </select>
              <Button variant="outline" onClick={downloadPayoutsCsv} disabled={!payouts.length}>
                Download page CSV
              </Button>
              <Button variant="outline" onClick={downloadAllPayoutsCsv} disabled={exportingAllPayouts}>
                {exportingAllPayouts ? 'Exporting...' : 'Download all CSV'}
              </Button>
            </div>
          </div>
          <div className="mb-2 flex gap-2">
            <Button
              variant="outline"
              disabled={!payoutCursorHistory.length}
              onClick={() => {
                setPayoutCursorHistory((prev) => {
                  if (!prev.length) return prev;
                  const next = [...prev];
                  const previousCursor = next.pop();
                  setPayoutCursor(previousCursor || null);
                  return next;
                });
              }}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={!payoutPageInfo?.hasMore || !payoutPageInfo?.nextCursor}
              onClick={() => {
                setPayoutCursorHistory((prev) => [...prev, payoutCursor]);
                setPayoutCursor(payoutPageInfo.nextCursor);
              }}
            >
              Next
            </Button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : payouts.length === 0 ? (
            <p className="text-sm text-slate-500">No payout records yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-slate-500">
                    <th className="px-2 py-2">When</th>
                    <th className="px-2 py-2">Paid By</th>
                    <th className="px-2 py-2">Paid To</th>
                    <th className="px-2 py-2">Order</th>
                    <th className="px-2 py-2 text-right">Gross</th>
                    <th className="px-2 py-2 text-right">Fee</th>
                    <th className="px-2 py-2 text-right">Net</th>
                    <th className="px-2 py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedPayouts.map((row) => (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b last:border-b-0 hover:bg-slate-50"
                      onClick={() => setSelectedRow(row)}
                    >
                      <td className="px-2 py-2 text-slate-600">{formatDateTimeIST(row.created_at, '—')}</td>
                      <td className="px-2 py-2 text-slate-700">{row.paidBy?.label || '-'}</td>
                      <td className="px-2 py-2 text-slate-700">{row.paidTo?.label || '-'}</td>
                      <td className="px-2 py-2 text-slate-600">{row.orderNumber || row.order_id || '-'}</td>
                      <td className="px-2 py-2 text-right font-medium text-slate-900">{formatInr(row.gross_amount)}</td>
                      <td className="px-2 py-2 text-right text-amber-700">{formatInr(row.platform_fee_amount)}</td>
                      <td className="px-2 py-2 text-right font-semibold text-green-700">{formatInr(row.net_amount)}</td>
                      <td className="px-2 py-2">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-700">
                          {row.status || '-'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {selectedRow ? <WalletRowDetailModal row={selectedRow} onClose={() => setSelectedRow(null)} /> : null}
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

function WalletRowDetailModal({ row, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>History detail</h3>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="modal-body">
          <pre className="overflow-auto rounded-md bg-slate-50 p-3 text-xs text-slate-800">
            {JSON.stringify(row, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
