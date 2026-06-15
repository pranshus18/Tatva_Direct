import {
  approveWalletWithdrawalRequest,
  getOrCreateWallet,
  listWalletTransactions,
  listWalletWithdrawalRequests,
  rejectWalletWithdrawalRequest
} from '../../services/walletService.js';
import { enrichWalletTransactions } from '../../services/walletHistoryService.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import {
  walletWithdrawalListSchema,
  walletWithdrawActionSchema
} from '../../contracts/walletContracts.js';

function normalizeLimit(raw, fallback = 20) {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, parsed));
}

async function loadAllWalletTransactionsForWalletIds(supabase, walletIds) {
  if (!walletIds.length) return [];
  const pageSize = 1000;
  const allRows = [];
  let offset = 0;
  while (offset < 50000) {
    const { data, error } = await supabase
      .from('wallet_transactions')
      .select('wallet_id,transaction_type,direction,amount')
      .in('wallet_id', walletIds)
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    allRows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return allRows;
}

export function registerAdminWalletRoutes({ router, authenticateToken, isAdmin, supabase }) {
  router.get('/wallet/overview', authenticateToken, isAdmin, async (req, res) => {
    try {
      const [escrowWallet, revenueWallet] = await Promise.all([
        getOrCreateWallet({ userId: null, walletType: 'platform_escrow' }),
        getOrCreateWallet({ userId: null, walletType: 'platform_revenue' })
      ]);

      const [payoutAggResult, topupAggResult] = await Promise.all([
        supabase
          .from('supplier_payouts')
          .select('status,net_amount,platform_fee_amount')
          .order('created_at', { ascending: false })
          .limit(500),
        supabase
          .from('wallet_topups')
          .select('status,amount,created_at')
          .order('created_at', { ascending: false })
          .limit(500)
      ]);

      if (payoutAggResult.error) throw payoutAggResult.error;
      if (topupAggResult.error) throw topupAggResult.error;

      const payouts = payoutAggResult.data || [];
      const topups = topupAggResult.data || [];
      const pendingPayouts = payouts.filter((p) => p.status === 'pending');
      const completedTopups = topups.filter((t) => t.status === 'completed');

      return res.json({
        status: 'success',
        overview: {
          platformEscrowBalance: Number(escrowWallet.balance || 0),
          platformRevenueBalance: Number(revenueWallet.balance || 0),
          payoutCountPending: pendingPayouts.length,
          payoutAmountPending: pendingPayouts.reduce((sum, row) => sum + Number(row.net_amount || 0), 0),
          lifetimePlatformFeeBooked: payouts.reduce(
            (sum, row) => sum + Number(row.platform_fee_amount || 0),
            0
          ),
          topupCountCompleted: completedTopups.length,
          topupAmountCompleted: completedTopups.reduce((sum, row) => sum + Number(row.amount || 0), 0)
        }
      });
    } catch (e) {
      console.error('[AdminWallet] overview error:', e);
      return res.status(500).json({ status: 'error', message: 'Failed to load wallet overview' });
    }
  });

  router.get('/wallet/transactions', authenticateToken, isAdmin, async (req, res) => {
    try {
      const walletType = String(req.query?.walletType || 'platform_escrow').trim();
      if (!['platform_escrow', 'platform_revenue'].includes(walletType)) {
        return res.status(400).json({
          status: 'error',
          message: 'walletType must be platform_escrow or platform_revenue'
        });
      }
      const wallet = await getOrCreateWallet({ userId: null, walletType });
      const { rows, pageInfo } = await listWalletTransactions({
        walletId: wallet.id,
        limit: normalizeLimit(req.query?.limit, 50),
        cursor: req.query?.cursor || null,
        from: req.query?.from || null,
        to: req.query?.to || null,
        search: req.query?.search || null
      });
      const history = await enrichWalletTransactions({ wallet, transactions: rows });
      return res.json({ status: 'success', walletType, transactions: history, pageInfo });
    } catch (e) {
      console.error('[AdminWallet] tx error:', e);
      return res.status(500).json({ status: 'error', message: 'Failed to load wallet transactions' });
    }
  });

  router.get('/wallet/users-summary', authenticateToken, isAdmin, async (req, res) => {
    try {
      const walletType = String(req.query?.walletType || 'customer').trim().toLowerCase();
      if (!['customer', 'supplier'].includes(walletType)) {
        return res.status(400).json({
          status: 'error',
          message: 'walletType must be customer or supplier'
        });
      }
      const limit = normalizeLimit(req.query?.limit, 100);
      const searchNeedle = String(req.query?.search || '').trim().toLowerCase();

      let walletQuery = supabase
        .from('wallets')
        .select('id,user_id,wallet_type,balance,created_at')
        .eq('wallet_type', walletType)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(limit);

      const { data: walletRows, error: walletError } = await walletQuery;
      if (walletError) throw walletError;
      const wallets = walletRows || [];
      if (!wallets.length) {
        return res.json({ status: 'success', users: [] });
      }

      const userIds = [...new Set(wallets.map((row) => row.user_id).filter(Boolean))];
      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id,name,company,email,user_type')
        .in('id', userIds);
      if (usersError) throw usersError;
      const usersById = new Map((users || []).map((row) => [row.id, row]));

      const walletIds = wallets.map((row) => row.id);
      const txRows = await loadAllWalletTransactionsForWalletIds(supabase, walletIds);

      const txByWallet = new Map();
      for (const row of txRows || []) {
        if (!txByWallet.has(row.wallet_id)) txByWallet.set(row.wallet_id, []);
        txByWallet.get(row.wallet_id).push(row);
      }

      const rows = wallets
        .map((wallet) => {
          const user = usersById.get(wallet.user_id) || null;
          const txs = txByWallet.get(wallet.id) || [];
          const totalCredit = txs
            .filter((t) => t.direction === 'credit')
            .reduce((sum, t) => sum + Number(t.amount || 0), 0);
          const totalDebit = txs
            .filter((t) => t.direction === 'debit')
            .reduce((sum, t) => sum + Number(t.amount || 0), 0);
          const totalOrderSpend = txs
            .filter((t) => t.direction === 'debit' && t.transaction_type === 'order_payment')
            .reduce((sum, t) => sum + Number(t.amount || 0), 0);
          const totalTopup = txs
            .filter((t) => t.direction === 'credit' && t.transaction_type === 'topup')
            .reduce((sum, t) => sum + Number(t.amount || 0), 0);
          const name = String(user?.name || '').trim();
          const company = String(user?.company || '').trim();
          const label = name && company ? `${name} ${company}` : `${name} ${company}`.trim();
          return {
            userId: wallet.user_id,
            walletId: wallet.id,
            name: user?.name || null,
            company: user?.company || null,
            email: user?.email || null,
            userType: user?.user_type || walletType,
            walletType: wallet.wallet_type,
            currentBalance: Number(wallet.balance || 0),
            totalCredit,
            totalDebit,
            totalTopup,
            totalOrderSpend
          };
        })
        .filter((row) => {
          if (!searchNeedle) return true;
          const hay = [row.name, row.company, row.email, row.userType].filter(Boolean).join(' ').toLowerCase();
          return hay.includes(searchNeedle);
        });

      return res.json({ status: 'success', users: rows });
    } catch (e) {
      console.error('[AdminWallet] users summary error:', e);
      return res.status(500).json({ status: 'error', message: 'Failed to load user wallet summary' });
    }
  });

  router.get('/wallet/withdrawals', authenticateToken, isAdmin, async (req, res) => {
    try {
      const payload = parseWithSchema(walletWithdrawalListSchema, req.query || {});
      const { rows, pageInfo } = await listWalletWithdrawalRequests({
        status: payload.status || null,
        limit: normalizeLimit(payload.limit, 50),
        cursor: payload.cursor || null
      });
      const userIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
      const bankAccountIds = [...new Set(rows.map((row) => row.bank_account_id).filter(Boolean))];
      const { data: users, error: usersError } = userIds.length
        ? await supabase.from('users').select('id,name,company,email,user_type').in('id', userIds)
        : { data: [], error: null };
      if (usersError) throw usersError;
      const usersById = new Map((users || []).map((row) => [row.id, row]));
      const { data: bankAccounts, error: bankError } = bankAccountIds.length
        ? await supabase
            .from('wallet_bank_accounts')
            .select('id,account_holder_name,bank_name,account_number,ifsc_code,upi_id')
            .in('id', bankAccountIds)
        : { data: [], error: null };
      if (bankError) throw bankError;
      const banksById = new Map((bankAccounts || []).map((row) => [row.id, row]));
      const enrichedRows = rows.map((row) => {
        const user = usersById.get(row.user_id) || null;
        const bank = banksById.get(row.bank_account_id) || null;
        const accountNumberMasked = bank?.account_number
          ? `****${String(bank.account_number).slice(-4)}`
          : row?.metadata?.bankAccountSnapshot?.accountNumberMasked || null;
        return {
          ...row,
          user: user
            ? {
                id: user.id,
                name: user.name || null,
                company: user.company || null,
                email: user.email || null,
                userType: user.user_type || null
              }
            : null,
          bankAccount: {
            id: bank?.id || row.bank_account_id || null,
            accountHolderName:
              bank?.account_holder_name || row?.metadata?.bankAccountSnapshot?.accountHolderName || null,
            bankName: bank?.bank_name || row?.metadata?.bankAccountSnapshot?.bankName || null,
            accountNumberMasked,
            ifscCode: bank?.ifsc_code || row?.metadata?.bankAccountSnapshot?.ifscCode || null,
            upiId: bank?.upi_id || row?.metadata?.bankAccountSnapshot?.upiId || null
          }
        };
      });
      return res.json({ status: 'success', withdrawals: enrichedRows, pageInfo });
    } catch (e) {
      console.error('[AdminWallet] list withdrawals error:', e);
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      return res.status(500).json({ status: 'error', message: 'Failed to load withdrawal requests' });
    }
  });

  router.post('/wallet/withdrawals/:id/approve', authenticateToken, isAdmin, async (req, res) => {
    try {
      const payload = parseWithSchema(walletWithdrawActionSchema, req.body || {});
      const row = await approveWalletWithdrawalRequest({
        withdrawalId: req.params.id,
        actorUserId: req.userId,
        payoutReference: payload.payoutReference || null,
        note: payload.note || ''
      });
      return res.json({ status: 'success', withdrawal: row });
    } catch (e) {
      console.error('[AdminWallet] approve withdrawal error:', e);
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      if (e?.code === 'WITHDRAWAL_NOT_FOUND') {
        return res.status(404).json({ status: 'error', code: e.code, message: e.message });
      }
      if (e?.code === 'WITHDRAWAL_ALREADY_PROCESSED' || e?.code === 'INSUFFICIENT_WALLET_BALANCE') {
        return res.status(400).json({ status: 'error', code: e.code, message: e.message });
      }
      return res.status(500).json({ status: 'error', message: e.message || 'Failed to approve withdrawal' });
    }
  });

  router.post('/wallet/withdrawals/:id/reject', authenticateToken, isAdmin, async (req, res) => {
    try {
      const payload = parseWithSchema(walletWithdrawActionSchema, req.body || {});
      const row = await rejectWalletWithdrawalRequest({
        withdrawalId: req.params.id,
        actorUserId: req.userId,
        note: payload.note || ''
      });
      return res.json({ status: 'success', withdrawal: row });
    } catch (e) {
      console.error('[AdminWallet] reject withdrawal error:', e);
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      if (e?.code === 'WITHDRAWAL_NOT_FOUND') {
        return res.status(404).json({ status: 'error', code: e.code, message: e.message });
      }
      if (e?.code === 'WITHDRAWAL_ALREADY_PROCESSED') {
        return res.status(400).json({ status: 'error', code: e.code, message: e.message });
      }
      return res.status(500).json({ status: 'error', message: e.message || 'Failed to reject withdrawal' });
    }
  });
}
