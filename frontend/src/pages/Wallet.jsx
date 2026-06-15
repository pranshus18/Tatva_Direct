import React, { useEffect, useMemo, useState } from 'react';
import { getApiUrl } from '../config/api';
import SpPageLayout from '../components/sp/SpPageLayout';
import SpPageHeader from '../components/sp/SpPageHeader';
import { Wallet as WalletIcon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

const formatInr = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const directionLabel = (direction) => (String(direction || '').toLowerCase() === 'credit' ? 'Credit' : 'Debit');
const signedAmount = (row) =>
  `${String(row?.direction || '').toLowerCase() === 'credit' ? '+' : '-'}${formatInr(row?.amount || 0)}`;

const Wallet = () => {
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [wallet, setWallet] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [withdrawals, setWithdrawals] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [walletConfig, setWalletConfig] = useState({ minTopupInr: 100, razorpay: { enabled: false } });
  const [pageInfo, setPageInfo] = useState({ hasMore: false, nextCursor: null });
  const [cursor, setCursor] = useState(null);
  const [cursorHistory, setCursorHistory] = useState([]);
  const [notice, setNotice] = useState('');
  const [topupAmount, setTopupAmount] = useState('1000');
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
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [sortBy, setSortBy] = useState('created_at_desc');
  const [exportingAll, setExportingAll] = useState(false);

  const buildTxQuery = (nextCursor = null, nextFilters = filters, limit = 50) => {
    const query = new URLSearchParams();
    query.set('limit', String(limit));
    if (nextCursor) query.set('cursor', nextCursor);
    if (nextFilters.search) query.set('search', nextFilters.search);
    if (nextFilters.from) query.set('from', `${nextFilters.from}T00:00:00.000Z`);
    if (nextFilters.to) query.set('to', `${nextFilters.to}T23:59:59.999Z`);
    return query.toString();
  };

  const loadWalletData = async (nextCursor = null, nextFilters = filters) => {
    setLoading(true);
    setNotice('');
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const [balanceResp, txResp, bankResp, withdrawalsResp, configResp] = await Promise.all([
        fetch(getApiUrl('/api/wallet/balance'), {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(getApiUrl(`/api/wallet/transactions?${buildTxQuery(nextCursor, nextFilters, 50)}`), {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(getApiUrl('/api/wallet/withdraw/bank-accounts'), {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(getApiUrl('/api/wallet/withdrawals?limit=20'), {
          headers: { Authorization: `Bearer ${token}` }
        }),
        fetch(getApiUrl('/api/wallet/config'), {
          headers: { Authorization: `Bearer ${token}` }
        })
      ]);

      const balanceData = await balanceResp.json().catch(() => ({}));
      const txData = await txResp.json().catch(() => ({}));
      const bankData = await bankResp.json().catch(() => ({}));
      const withdrawalsData = await withdrawalsResp.json().catch(() => ({}));
      const configData = await configResp.json().catch(() => ({}));
      if (!balanceResp.ok || balanceData.status !== 'success') {
        throw new Error(balanceData.message || 'Failed to load wallet balance');
      }
      if (!txResp.ok || txData.status !== 'success') {
        throw new Error(txData.message || 'Failed to load wallet transactions');
      }
      if (!bankResp.ok || bankData.status !== 'success') {
        throw new Error(bankData.message || 'Failed to load withdrawal bank details');
      }
      if (!withdrawalsResp.ok || withdrawalsData.status !== 'success') {
        throw new Error(withdrawalsData.message || 'Failed to load withdrawal history');
      }
      if (!configResp.ok || configData.status !== 'success') {
        throw new Error(configData.message || 'Failed to load wallet top-up configuration');
      }
      setWallet(balanceData.wallet || null);
      setTransactions(txData.transactions || []);
      setPageInfo(txData.pageInfo || { hasMore: false, nextCursor: null });
      setBankAccounts(bankData.bankAccounts || []);
      setWithdrawals(withdrawalsData.withdrawals || []);
      setWalletConfig(configData.config || { minTopupInr: 100, razorpay: { enabled: false } });
    } catch (e) {
      setNotice(e.message || 'Failed to load wallet data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWalletData(cursor, filters);
  }, [cursor, filters]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      loadWalletData(cursor, filters);
    }, 20000);
    return () => window.clearInterval(intervalId);
  }, [cursor, filters]);

  const sortedTransactions = useMemo(() => {
    const rows = [...transactions];
    if (sortBy === 'created_at_asc') {
      rows.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else if (sortBy === 'amount_asc') {
      rows.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
    } else if (sortBy === 'amount_desc') {
      rows.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
    } else {
      rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
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
      'Transaction ID'
    ];
    const lines = sortedTransactions.map((row) => [
      new Date(row.created_at).toISOString(),
      row.description || row.transaction_type || '',
      Number(row.amount || 0).toFixed(2),
      directionLabel(row.direction),
      'Wallet',
      row.orderNumber || row.orderId || '-',
      row.id || ''
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
    a.download = `service-provider-wallet-history-${new Date().toISOString().slice(0, 10)}.csv`;
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
      let pageCount = 0;
      do {
        const resp = await fetch(
          getApiUrl(`/api/wallet/transactions?${buildTxQuery(nextCursor, filters, 200)}`),
          { headers }
        );
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.status !== 'success') {
          throw new Error(data.message || 'Failed to export all wallet rows');
        }
        allRows.push(...(data.transactions || []));
        nextCursor = data?.pageInfo?.hasMore ? data?.pageInfo?.nextCursor || null : null;
        pageCount += 1;
      } while (nextCursor && pageCount < 200);

      const header = [
        'Date',
        'Transaction details',
        'Amount',
        'Debit/Credit',
        'Payment Method',
        'Project ID',
        'Transaction ID'
      ];
      const lines = allRows.map((row) => [
        new Date(row.created_at).toISOString(),
        row.description || row.transaction_type || '',
        Number(row.amount || 0).toFixed(2),
        directionLabel(row.direction),
        'Wallet',
        row.orderNumber || row.orderId || '-',
        row.id || ''
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
      a.download = `service-provider-wallet-history-all-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setNotice(e.message || 'Failed to export full wallet history');
    } finally {
      setExportingAll(false);
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
    if (processing) return;
    const amount = Number(topupAmount);
    const minTopup = Number(walletConfig?.minTopupInr || 100);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice('Enter a valid top-up amount');
      return;
    }
    if (amount < minTopup) {
      setNotice(`Minimum top-up amount is INR ${minTopup}`);
      return;
    }
    setProcessing(true);
    setNotice('');
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');

      const createResp = await fetch(getApiUrl('/api/wallet/topup/create'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          amount,
          idempotencyKey: `wallet-topup-ui-${Date.now()}`
        })
      });
      const createData = await createResp.json().catch(() => ({}));
      if (!createResp.ok || createData.status !== 'success') {
        throw new Error(createData.message || 'Failed to create top-up request');
      }

      const paymentIntent = createData.paymentIntent || {};
      if (paymentIntent.requiresCheckout === false || paymentIntent.provider === 'dev_bypass') {
        setNotice('Wallet top-up successful.');
        await loadWalletData(cursor, filters);
        setProcessing(false);
        return;
      }
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) throw new Error('Unable to load Razorpay checkout');
      const options = {
        key: paymentIntent.keyId,
        order_id: paymentIntent.orderId,
        name: 'Tatva Direct',
        description: 'Wallet top-up',
        amount: paymentIntent.amount,
        currency: paymentIntent.currency || 'INR',
        handler: async (response) => {
          try {
            const confirmResp = await fetch(getApiUrl('/api/wallet/topup/confirm'), {
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
              throw new Error(confirmData.message || 'Top-up confirmation failed');
            }
            setNotice('Wallet top-up successful.');
            await loadWalletData();
          } catch (e) {
            setNotice(e.message || 'Top-up completed but confirmation failed');
          } finally {
            setProcessing(false);
          }
        },
        modal: {
          ondismiss: () => {
            setProcessing(false);
          }
        },
        theme: { color: '#4f46e5' }
      };
      const rzp = new window.Razorpay(options);
      rzp.open();
    } catch (e) {
      setNotice(e.message || 'Failed to start top-up');
      setProcessing(false);
    }
  };

  const handleWithdraw = async () => {
    if (withdrawing) return;
    const amount = Number(withdrawAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setNotice('Enter a valid withdrawal amount');
      return;
    }
    setWithdrawing(true);
    setNotice('');
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const resp = await fetch(getApiUrl('/api/wallet/withdraw'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          amount,
          note: withdrawNote.trim() || null,
          bankAccountId: bankAccounts[0]?.id || null,
          idempotencyKey: `wallet-withdraw-ui-${Date.now()}`
        })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to withdraw from wallet');
      }
      setNotice('Withdrawal request submitted. Admin will review and process it.');
      setWithdrawAmount('');
      setWithdrawNote('');
      await loadWalletData(cursor, filters);
    } catch (e) {
      setNotice(e.message || 'Failed to withdraw from wallet');
    } finally {
      setWithdrawing(false);
    }
  };

  const handleSaveBankDetails = async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) throw new Error('Please login again');
      const resp = await fetch(getApiUrl('/api/wallet/withdraw/bank-accounts'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(bankDetails)
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.status !== 'success') {
        throw new Error(data.message || 'Failed to save bank details');
      }
      setNotice('Withdrawal bank details saved.');
      await loadWalletData(cursor, filters);
    } catch (e) {
      setNotice(e.message || 'Failed to save bank details');
    }
  };

  return (
    <SpPageLayout showStepper={false}>
      <SpPageHeader
        title="Wallet"
        description="Top up your wallet and view payment history."
        icon={WalletIcon}
        actions={
          <Button variant="outline" onClick={loadWalletData} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        }
      />
      <div className="space-y-4">
        <div className="rounded-lg border bg-white p-4">
          <div className="text-sm text-slate-500">Current balance</div>
          <div className="text-2xl font-bold text-slate-900">
            {formatInr(wallet?.balance)}
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4">
          <div className="mb-2 text-sm font-medium text-slate-700">Top up wallet</div>
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
            <Button onClick={handleTopup} disabled={processing}>
              {processing ? 'Processing...' : 'Top up'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            To add money: 1) choose amount, 2) complete checkout, 3) wallet balance updates instantly.
            Minimum top-up: INR {Number(walletConfig?.minTopupInr || 100)}.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Payment method: Razorpay in production. In development, dev bypass is used if Razorpay keys are missing.
          </p>
        </div>

        <div className="rounded-lg border bg-white p-4">
          <div className="mb-2 text-sm font-medium text-slate-700">Withdrawal bank details</div>
          <div className="grid gap-2 md:grid-cols-5">
            <input
              type="text"
              value={bankDetails.accountHolderName}
              onChange={(e) => setBankDetails((prev) => ({ ...prev, accountHolderName: e.target.value }))}
              placeholder="Account holder name"
              className="h-10 rounded-md border px-3 text-sm"
            />
            <input
              type="text"
              value={bankDetails.bankName}
              onChange={(e) => setBankDetails((prev) => ({ ...prev, bankName: e.target.value }))}
              placeholder="Bank name"
              className="h-10 rounded-md border px-3 text-sm"
            />
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
          <div className="mt-2 flex items-center gap-2">
            <Button variant="outline" onClick={handleSaveBankDetails}>
              Save bank details
            </Button>
            <span className="text-xs text-slate-500">
              Current: {bankAccounts[0]?.upi_id || bankAccounts[0]?.account_number ? 'Available' : 'Not added'}
            </span>
          </div>
        </div>

        <div className="rounded-lg border bg-white p-4">
          <div className="mb-2 text-sm font-medium text-slate-700">Withdraw from wallet</div>
          <div className="grid gap-2 md:grid-cols-[180px_1fr_auto]">
            <input
              type="number"
              min={1}
              step={1}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              className="h-10 rounded-md border px-3 text-sm"
              placeholder="Amount in INR"
            />
            <input
              type="text"
              maxLength={500}
              value={withdrawNote}
              onChange={(e) => setWithdrawNote(e.target.value)}
              className="h-10 rounded-md border px-3 text-sm"
              placeholder="Optional note"
            />
            <Button onClick={handleWithdraw} disabled={withdrawing}>
              {withdrawing ? 'Withdrawing...' : 'Withdraw'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            You can request withdrawal up to available balance. Admin approval is required before debit happens.
          </p>
        </div>

        <div className="rounded-lg border bg-white p-4">
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
                      <td className="px-2 py-2 text-slate-600">{new Date(row.created_at).toLocaleString()}</td>
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

        {notice ? (
          <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            {notice}
          </div>
        ) : null}

        <div className="rounded-lg border bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-slate-700">Transaction Summary</div>
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
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
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
            <p className="text-sm text-slate-500">No wallet transactions yet.</p>
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
                        className={`px-2 py-2 text-right font-semibold ${row.direction === 'credit' ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {signedAmount(row)}
                      </td>
                      <td className="px-2 py-2 text-slate-700">{directionLabel(row.direction)}</td>
                      <td className="px-2 py-2 text-slate-700">Wallet</td>
                      <td className="px-2 py-2 text-slate-600">{row.orderNumber || row.orderId || '-'}</td>
                      <td className="px-2 py-2 text-xs text-slate-600">{row.id || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {selectedTransaction ? (
        <TransactionDetailModal row={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
      ) : null}
    </SpPageLayout>
  );
};

export default Wallet;

function TransactionDetailModal({ row, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-900">Transaction detail</h3>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="space-y-2 text-sm">
          <Detail label="When" value={new Date(row.created_at).toLocaleString()} />
          <Detail label="Type" value={row.transaction_type} />
          <Detail label="Paid By" value={row.paidBy?.label || '-'} />
          <Detail label="Paid To" value={row.paidTo?.label || '-'} />
          <Detail label="Order" value={row.orderNumber || row.orderId || '-'} />
          <Detail label="Direction" value={row.direction} />
          <Detail label="Amount" value={signedAmount(row)} />
          <Detail label="Gross" value={formatInr(row.grossAmount)} />
          <Detail label="Platform Fee" value={formatInr(row.platformFeeAmount)} />
          <Detail label="Supplier Net" value={formatInr(row.supplierPayoutAmount)} />
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-2 border-b pb-1">
      <div className="text-slate-500">{label}</div>
      <div className="text-right font-medium text-slate-900">{value || '-'}</div>
    </div>
  );
}
