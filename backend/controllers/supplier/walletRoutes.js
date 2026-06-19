import {
  createWalletTopupRecord,
  createWalletBankAccount,
  createWalletWithdrawalRequest,
  completeWalletTopup,
  getWalletBalance,
  getOrCreateWallet,
  listWalletBankAccounts,
  listWalletWithdrawalRequests,
  listWalletTransactions,
  payOrderFromWallet,
  summarizeWalletLedger
} from '../../services/walletService.js';
import { enrichWalletTransactions } from '../../services/walletHistoryService.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import {
  walletBankAccountSchema,
  walletPayOrderSchema,
  walletTopupConfirmSchema,
  walletTopupCreateSchema,
  walletWithdrawalListSchema,
  walletWithdrawSchema
} from '../../contracts/walletContracts.js';
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  getRazorpayPublicConfig,
  isRazorpayConfigured,
  verifyRazorpayPaymentSignature
} from '../../services/razorpayService.js';
import { httpStatusForUpstreamError } from '../../utils/paymentNormalize.js';

function normalizeLimit(raw, fallback = 20) {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(200, parsed));
}

function isSupplierUser(req) {
  return String(req.user?.user_type || '').toLowerCase() === 'supplier';
}

function topupMinAmount() {
  return Number.parseFloat(process.env.WALLET_MIN_TOPUP_INR || '100') || 100;
}

export function registerSupplierWalletRoutes(ctx) {
  const { router, authenticateToken, supabase } = ctx;

  router.get('/wallet/balance', authenticateToken, async (req, res) => {
    try {
      if (!isSupplierUser(req)) {
        return res.status(403).json({ status: 'error', message: 'Supplier access required' });
      }
      const wallet = await getOrCreateWallet({ userId: req.userId, walletType: 'supplier' });
      return res.json({
        status: 'success',
        wallet,
        balance: Number(wallet.balance || 0)
      });
    } catch (e) {
      console.error('[SupplierWallet] balance error:', e);
      return res.status(500).json({ status: 'error', message: 'Failed to load supplier wallet balance' });
    }
  });

  router.get('/wallet/transactions', authenticateToken, async (req, res) => {
    try {
      if (!isSupplierUser(req)) {
        return res.status(403).json({ status: 'error', message: 'Supplier access required' });
      }
      const wallet = await getOrCreateWallet({ userId: req.userId, walletType: 'supplier' });
      const { rows, pageInfo } = await listWalletTransactions({
        walletId: wallet.id,
        limit: normalizeLimit(req.query?.limit, 30),
        cursor: req.query?.cursor || null,
        from: req.query?.from || null,
        to: req.query?.to || null,
        search: req.query?.search || null
      });
      const history = await enrichWalletTransactions({ wallet, transactions: rows });
      return res.json({ status: 'success', transactions: history, pageInfo });
    } catch (e) {
      console.error('[SupplierWallet] tx error:', e);
      return res.status(500).json({ status: 'error', message: 'Failed to load supplier wallet transactions' });
    }
  });

  router.get('/wallet/ledger-summary', authenticateToken, async (req, res) => {
    try {
      if (!isSupplierUser(req)) {
        return res.status(403).json({ status: 'error', message: 'Supplier access required' });
      }
      const wallet = await getOrCreateWallet({ userId: req.userId, walletType: 'supplier' });
      const summary = await summarizeWalletLedger({ walletId: wallet.id });
      return res.json({ status: 'success', summary });
    } catch (e) {
      console.error('[SupplierWallet] ledger summary error:', e);
      return res.status(500).json({ status: 'error', message: 'Failed to load supplier wallet ledger summary' });
    }
  });

  router.get('/wallet/config', authenticateToken, async (req, res) => {
    if (!isSupplierUser(req)) {
      return res.status(403).json({ status: 'error', message: 'Supplier access required' });
    }
    return res.json({
      status: 'success',
      config: {
        razorpay: getRazorpayPublicConfig(),
        minTopupInr: topupMinAmount()
      }
    });
  });

  router.post('/wallet/topup/create', authenticateToken, async (req, res) => {
    try {
      if (!isSupplierUser(req)) {
        return res.status(403).json({ status: 'error', message: 'Supplier access required' });
      }
      const payload = parseWithSchema(walletTopupCreateSchema, req.body || {});
      const amount = Number.parseFloat(String(payload.amount || '0'));
      const minTopup = topupMinAmount();
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ status: 'error', message: 'Amount must be greater than zero' });
      }
      if (amount < minTopup) {
        return res.status(400).json({
          status: 'error',
          message: `Minimum wallet credit amount is INR ${minTopup}`
        });
      }

      const supplierWallet = await getOrCreateWallet({
        userId: req.userId,
        walletType: 'supplier'
      });

      if (!isRazorpayConfigured()) {
        return res.status(503).json({
          status: 'error',
          code: 'RAZORPAY_NOT_CONFIGURED',
          message: 'Online payment gateway is not configured. Wallet credit cannot be completed.'
        });
      }

      const rpOrder = await createRazorpayOrder({
        amountInRupees: amount,
        receipt: `SUP-WTOP-${Date.now()}`,
        notes: {
          purpose: 'wallet_topup',
          userId: req.userId,
          walletId: supplierWallet.id,
          walletType: 'supplier'
        }
      });

      const topup = await createWalletTopupRecord({
        walletId: supplierWallet.id,
        userId: req.userId,
        amount,
        idempotencyKey: payload.idempotencyKey || null,
        razorpayOrderId: rpOrder.id,
        metadata: {
          createdByRoute: 'POST /api/supplier/wallet/topup/create',
          walletType: 'supplier'
        }
      });

      return res.json({
        status: 'success',
        walletTopup: {
          id: topup.id,
          amount: topup.amount,
          status: topup.status
        },
        paymentIntent: {
          provider: 'razorpay',
          orderId: rpOrder.id,
          amount: rpOrder.amount,
          currency: rpOrder.currency,
          keyId: getRazorpayPublicConfig().keyId
        }
      });
    } catch (e) {
      console.error('[SupplierWallet] topup create error:', e);
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      const status = httpStatusForUpstreamError(e);
      return res.status(status).json({
        status: 'error',
        message: e.message || 'Failed to create supplier wallet credit'
      });
    }
  });

  router.post('/wallet/topup/confirm', authenticateToken, async (req, res) => {
    try {
      if (!isSupplierUser(req)) {
        return res.status(403).json({ status: 'error', message: 'Supplier access required' });
      }
      if (!isRazorpayConfigured()) {
        return res.status(503).json({
          status: 'error',
          code: 'RAZORPAY_NOT_CONFIGURED',
          message: 'Wallet credit verification is unavailable.'
        });
      }
      const payload = parseWithSchema(walletTopupConfirmSchema, req.body || {});
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = payload;
      const isValid = verifyRazorpayPaymentSignature({
        orderId: razorpayOrderId,
        paymentId: razorpayPaymentId,
        signature: razorpaySignature
      });
      if (!isValid) {
        return res.status(400).json({ status: 'error', message: 'Invalid payment signature' });
      }

      const payment = await fetchRazorpayPayment(razorpayPaymentId);
      if (!payment || payment.order_id !== razorpayOrderId) {
        return res.status(400).json({ status: 'error', message: 'Payment does not match wallet credit order' });
      }
      if (payment.status !== 'captured') {
        return res.status(400).json({ status: 'error', message: 'Wallet credit payment is not captured yet' });
      }

      const topup = await completeWalletTopup({
        razorpayOrderId,
        razorpayPaymentId,
        razorpaySignature,
        actorUserId: req.userId,
        expectedUserId: req.userId
      });
      const balance = await getWalletBalance({ userId: req.userId, walletType: 'supplier' });
      return res.json({
        status: 'success',
        walletTopup: topup,
        wallet: balance.wallet,
        balance: balance.balance
      });
    } catch (e) {
      console.error('[SupplierWallet] topup confirm error:', e);
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      if (e?.code === 'WALLET_TOPUP_NOT_FOUND') {
        return res.status(404).json({ status: 'error', message: e.message });
      }
      if (e?.code === 'WALLET_TOPUP_FORBIDDEN') {
        return res.status(403).json({ status: 'error', message: e.message });
      }
      return res.status(500).json({ status: 'error', message: e.message || 'Failed to confirm supplier wallet credit' });
    }
  });

  router.post('/wallet/orders/:id/pay', authenticateToken, async (req, res) => {
    try {
      if (!isSupplierUser(req)) {
        return res.status(403).json({ status: 'error', message: 'Supplier access required' });
      }
      const payload = parseWithSchema(walletPayOrderSchema, req.body || {});
      const result = await payOrderFromWallet({
        orderId: req.params.id,
        actorUserId: req.userId,
        actorRole: req.user?.user_type || null,
        requestId: req.requestId || null,
        ipAddress: req.ip || null,
        idempotencyKey: payload.idempotencyKey || null
      });
      return res.json({
        status: 'success',
        order: result.order,
        platformFeeAmount: result.platformFeeAmount,
        supplierPayoutAmount: result.supplierPayoutAmount,
        feeBreakdown: result.feeBreakdown,
        receiptDelivery: result.receiptDelivery || null,
        invoiceSummary: result.invoiceSummary || null
      });
    } catch (e) {
      console.error('[SupplierWallet] order pay error:', e);
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      if (e?.code === 'ORDER_NOT_FOUND') {
        return res.status(404).json({ status: 'error', message: e.message });
      }
      if (e?.code === 'ORDER_FORBIDDEN') {
        return res.status(403).json({ status: 'error', message: e.message });
      }
      if (e?.code === 'ORDER_ALREADY_PAID') {
        return res.status(400).json({ status: 'error', message: e.message });
      }
      if (e?.code === 'INSUFFICIENT_WALLET_BALANCE') {
        return res.status(400).json({ status: 'error', code: e.code, message: e.message });
      }
      if (e?.code === 'WALLET_BALANCE_CONFLICT') {
        return res.status(409).json({ status: 'error', code: e.code, message: e.message });
      }
      if (
        e?.code === 'PLATFORM_FEE_RULE_MISSING' ||
        e?.code === 'PLATFORM_FEE_ROLE_MISSING' ||
        e?.code === 'PLATFORM_FEE_BRAND_MISSING' ||
        e?.code === 'PLATFORM_FEE_ORDER_ITEMS_MISSING'
      ) {
        return res.status(400).json({ status: 'error', code: e.code, message: e.message });
      }
      return res.status(500).json({ status: 'error', message: e.message || 'Failed to pay order from wallet' });
    }
  });

  router.get('/wallet/payouts', authenticateToken, async (req, res) => {
    try {
      if (!isSupplierUser(req)) {
        return res.status(403).json({ status: 'error', message: 'Supplier access required' });
      }
      const pageLimit = normalizeLimit(req.query?.limit, 50);
      const searchNeedle = String(req.query?.search || '').trim().toLowerCase();
      let query = supabase
        .from('supplier_payouts')
        .select('id,order_id,supplier_id,gross_amount,platform_fee_amount,net_amount,status,released_at,paid_out_at,created_at,metadata')
        .eq('supplier_id', req.userId)
        .order('created_at', { ascending: false })
        .limit(searchNeedle ? 500 : pageLimit + 1);
      const status = String(req.query?.status || '').trim().toLowerCase();
      if (status) query = query.eq('status', status);
      const cursor = String(req.query?.cursor || '').trim();
      if (cursor) query = query.lt('created_at', cursor);
      const from = String(req.query?.from || '').trim();
      if (from) query = query.gte('created_at', from);
      const to = String(req.query?.to || '').trim();
      if (to) query = query.lte('created_at', to);
      const { data, error } = await query;
      if (error) throw error;
      const payouts = data || [];
      const orderIds = [...new Set(payouts.map((row) => row.order_id).filter(Boolean))];
      const { data: orderRows, error: orderError } = orderIds.length
        ? await supabase
            .from('orders')
            .select('id,order_number,service_provider_id,supplier_id,payment_status')
            .in('id', orderIds)
        : { data: [], error: null };
      if (orderError) throw orderError;
      const ordersById = new Map((orderRows || []).map((row) => [row.id, row]));
      const userIds = [
        ...new Set((orderRows || []).flatMap((row) => [row.service_provider_id, row.supplier_id]).filter(Boolean))
      ];
      const { data: users, error: userError } = userIds.length
        ? await supabase.from('users').select('id,name,company,user_type').in('id', userIds)
        : { data: [], error: null };
      if (userError) throw userError;
      const usersById = new Map((users || []).map((row) => [row.id, row]));
      const toLabel = (user) => {
        if (!user) return 'Unknown';
        const name = String(user.name || '').trim();
        const company = String(user.company || '').trim();
        if (name && company) return `${name} (${company})`;
        return name || company || user.id;
      };
      const enrichedPayouts = payouts.map((row) => {
        const order = ordersById.get(row.order_id) || null;
        const supplier = order?.supplier_id ? usersById.get(order.supplier_id) : usersById.get(row.supplier_id);
        const serviceProvider = order?.service_provider_id ? usersById.get(order.service_provider_id) : null;
        return {
          ...row,
          orderNumber: order?.order_number || null,
          paymentStatus: order?.payment_status || null,
          paidBy: {
            id: order?.service_provider_id || null,
            label: toLabel(serviceProvider),
            type: 'service_provider'
          },
          paidTo: {
            id: row.supplier_id || null,
            label: toLabel(supplier),
            type: 'supplier'
          }
        };
      });
      const summary = payouts.reduce(
        (acc, row) => {
          const net = Number(row.net_amount || 0);
          const fee = Number(row.platform_fee_amount || 0);
          acc.totalNet += net;
          acc.totalFee += fee;
          if (row.status === 'pending') acc.pendingNet += net;
          if (row.status === 'released') acc.releasedNet += net;
          return acc;
        },
        { totalNet: 0, totalFee: 0, pendingNet: 0, releasedNet: 0 }
      );
      const searchableRows = searchNeedle
        ? enrichedPayouts.filter((row) => {
            const hay = [
              row.orderNumber,
              row.order_id,
              row.status,
              row.paidBy?.label,
              row.paidTo?.label
            ]
              .filter(Boolean)
              .join(' ')
              .toLowerCase();
            return hay.includes(searchNeedle);
          })
        : enrichedPayouts;
      const filteredHasMore = searchableRows.length > pageLimit;
      const searchedRows = filteredHasMore ? searchableRows.slice(0, pageLimit) : searchableRows;
      return res.json({
        status: 'success',
        payouts: searchedRows,
        summary,
        pageInfo: {
          limit: pageLimit,
          nextCursor: filteredHasMore ? searchedRows[searchedRows.length - 1]?.created_at || null : null,
          hasMore: filteredHasMore
        }
      });
    } catch (e) {
      console.error('[SupplierWallet] payouts error:', e);
      return res.status(500).json({ status: 'error', message: 'Failed to load supplier payouts' });
    }
  });

  router.get('/wallet/withdrawals', authenticateToken, async (req, res) => {
    try {
      if (!isSupplierUser(req)) {
        return res.status(403).json({ status: 'error', message: 'Supplier access required' });
      }
      const payload = parseWithSchema(walletWithdrawalListSchema, req.query || {});
      const wallet = await getOrCreateWallet({ userId: req.userId, walletType: 'supplier' });
      const result = await listWalletWithdrawalRequests({
        walletId: wallet.id,
        status: payload.status || null,
        limit: normalizeLimit(payload.limit, 30),
        cursor: payload.cursor || null
      });
      return res.json({ status: 'success', withdrawals: result.rows, pageInfo: result.pageInfo });
    } catch (e) {
      console.error('[SupplierWallet] withdrawals list error:', e);
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      return res.status(500).json({ status: 'error', message: 'Failed to load withdrawals' });
    }
  });

  router.get('/wallet/withdraw/bank-accounts', authenticateToken, async (req, res) => {
    try {
      if (!isSupplierUser(req)) {
        return res.status(403).json({ status: 'error', message: 'Supplier access required' });
      }
      const rows = await listWalletBankAccounts({ userId: req.userId });
      return res.json({ status: 'success', bankAccounts: rows });
    } catch (e) {
      console.error('[SupplierWallet] list bank accounts error:', e);
      return res.status(500).json({ status: 'error', message: 'Failed to load bank accounts' });
    }
  });

  router.post('/wallet/withdraw/bank-accounts', authenticateToken, async (req, res) => {
    try {
      if (!isSupplierUser(req)) {
        return res.status(403).json({ status: 'error', message: 'Supplier access required' });
      }
      const payload = parseWithSchema(walletBankAccountSchema, req.body || {});
      const bankAccount = await createWalletBankAccount({
        userId: req.userId,
        accountHolderName: payload.accountHolderName || '',
        bankName: payload.bankName || '',
        accountNumber: payload.accountNumber || '',
        ifscCode: payload.ifscCode || '',
        upiId: payload.upiId || '',
        notes: payload.notes || '',
        isDefault: true
      });
      return res.json({ status: 'success', bankAccount });
    } catch (e) {
      console.error('[SupplierWallet] create bank account error:', e);
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      return res.status(400).json({ status: 'error', message: e.message || 'Failed to save bank details' });
    }
  });

  router.post('/wallet/withdraw', authenticateToken, async (req, res) => {
    try {
      if (!isSupplierUser(req)) {
        return res.status(403).json({ status: 'error', message: 'Supplier access required' });
      }
      const payload = parseWithSchema(walletWithdrawSchema, req.body || {});
      const amount = Number.parseFloat(String(payload.amount || '0'));
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ status: 'error', message: 'Amount must be greater than zero' });
      }
      const wallet = await getOrCreateWallet({ userId: req.userId, walletType: 'supplier' });
      const request = await createWalletWithdrawalRequest({
        walletId: wallet.id,
        userId: req.userId,
        amount,
        idempotencyKey: payload.idempotencyKey || null,
        note: payload.note || '',
        bankAccountId: payload.bankAccountId || null
      });
      const latestWallet = await getOrCreateWallet({ userId: req.userId, walletType: 'supplier' });
      return res.json({
        status: 'success',
        message: 'Withdrawal request submitted for admin approval',
        withdrawal: request,
        wallet: latestWallet,
        balance: Number(latestWallet.balance || 0)
      });
    } catch (e) {
      console.error('[SupplierWallet] withdrawal error:', e);
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      if (e?.code === 'INSUFFICIENT_WALLET_BALANCE') {
        return res.status(400).json({ status: 'error', code: e.code, message: e.message });
      }
      if (e?.code === 'BANK_DETAILS_REQUIRED') {
        return res.status(400).json({ status: 'error', code: e.code, message: e.message });
      }
      if (e?.code === 'WALLET_BALANCE_CONFLICT') {
        return res.status(409).json({ status: 'error', code: e.code, message: e.message });
      }
      return res.status(500).json({ status: 'error', message: e.message || 'Failed to withdraw from wallet' });
    }
  });
}
