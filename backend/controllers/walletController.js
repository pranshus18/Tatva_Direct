import express from 'express';
import { supabase } from '../config/supabase.js';
import {
  requireAuthentication as authenticateToken,
  requireServiceProvider
} from '../middleware/authMiddleware.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import {
  walletPayOrderSchema,
  walletBankAccountSchema,
  walletWithdrawalListSchema,
  walletTopupConfirmSchema,
  walletTopupCreateSchema,
  walletTransactionsListSchema,
  walletWithdrawSchema
} from '../contracts/walletContracts.js';
import {
  createWalletBankAccount,
  createWalletWithdrawalRequest,
  creditWallet,
  completeWalletTopup,
  createWalletTopupRecord,
  getOrCreateWallet,
  listWalletBankAccounts,
  listWalletWithdrawalRequests,
  getWalletBalance,
  listWalletTransactions,
  payOrderFromWallet
} from '../services/walletService.js';
import { enrichWalletTransactions } from '../services/walletHistoryService.js';
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  getRazorpayPublicConfig,
  isRazorpayConfigured,
  verifyRazorpayPaymentSignature
} from '../services/razorpayService.js';
import { httpStatusForUpstreamError } from '../utils/paymentNormalize.js';

const walletRouter = express.Router();

function topupMinAmount() {
  return Number.parseFloat(process.env.WALLET_MIN_TOPUP_INR || '100') || 100;
}

function normalizeLimit(raw) {
  const parsed = Number.parseInt(String(raw || '50'), 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(parsed, 200));
}

walletRouter.get('/config', authenticateToken, (_req, res) => {
  res.json({
    status: 'success',
    config: {
      razorpay: getRazorpayPublicConfig(),
      minTopupInr: topupMinAmount()
    }
  });
});

walletRouter.get('/balance', authenticateToken, requireServiceProvider, async (req, res) => {
  try {
    const result = await getWalletBalance({
      userId: req.userId,
      walletType: 'customer'
    });
    return res.json({
      status: 'success',
      wallet: result.wallet,
      balance: result.balance
    });
  } catch (e) {
    console.error('[Wallet] balance error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to load wallet balance' });
  }
});

walletRouter.get('/transactions', authenticateToken, requireServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(walletTransactionsListSchema, req.query || {});
    const wallet = await getOrCreateWallet({ userId: req.userId, walletType: 'customer' });
    const { rows, pageInfo } = await listWalletTransactions({
      walletId: wallet.id,
      limit: normalizeLimit(payload.limit),
      cursor: payload.cursor || null,
      from: payload.from || null,
      to: payload.to || null,
      search: payload.search || null
    });
    const history = await enrichWalletTransactions({ wallet, transactions: rows });
    return res.json({
      status: 'success',
      transactions: history,
      pageInfo
    });
  } catch (e) {
    console.error('[Wallet] transactions error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    return res.status(500).json({ status: 'error', message: 'Failed to load wallet transactions' });
  }
});

walletRouter.post('/topup/create', authenticateToken, requireServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(walletTopupCreateSchema, req.body || {});
    const amount = Number.parseFloat(String(payload.amount || '0'));
    const minTopup = topupMinAmount();
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Amount must be greater than zero' });
    }
    if (amount < minTopup) {
      return res.status(400).json({
        status: 'error',
        message: `Minimum top-up amount is INR ${minTopup}`
      });
    }

    const customerWallet = await getOrCreateWallet({
      userId: req.userId,
      walletType: 'customer'
    });

    if (!isRazorpayConfigured()) {
      if (process.env.NODE_ENV !== 'production') {
        const topup = await createWalletTopupRecord({
          walletId: customerWallet.id,
          userId: req.userId,
          amount,
          idempotencyKey: payload.idempotencyKey || null,
          razorpayOrderId: `DEV-TOPUP-${Date.now()}`,
          metadata: {
            createdByRoute: 'POST /api/wallet/topup/create',
            devBypass: true
          }
        });

        await creditWallet({
          walletId: customerWallet.id,
          amount,
          transactionType: 'topup',
          referenceType: 'wallet_topup',
          referenceId: topup.id,
          description: 'Wallet top-up (development bypass without Razorpay)',
          metadata: { provider: 'dev_bypass' },
          idempotencyKey: `wallet-topup-dev-credit:${topup.id}`,
          createdBy: req.userId
        });

        const completedAt = new Date().toISOString();
        await supabase
          .from('wallet_topups')
          .update({
            status: 'completed',
            completed_at: completedAt,
            updated_at: completedAt,
            metadata: {
              ...((topup && typeof topup.metadata === 'object' && topup.metadata) || {}),
              devBypass: true
            }
          })
          .eq('id', topup.id);
        await getOrCreateWallet({ userId: req.userId, walletType: 'customer' });
        const balance = await getWalletBalance({ userId: req.userId, walletType: 'customer' });

        return res.json({
          status: 'success',
          walletTopup: {
            id: topup.id,
            amount: topup.amount,
            status: 'completed',
            devBypass: true
          },
          paymentIntent: {
            provider: 'dev_bypass',
            requiresCheckout: false
          },
          wallet: balance.wallet,
          balance: balance.balance,
          completedAt
        });
      }
      return res.status(503).json({
        status: 'error',
        code: 'RAZORPAY_NOT_CONFIGURED',
        message: 'Wallet top-up is temporarily unavailable.'
      });
    }

    const rpOrder = await createRazorpayOrder({
      amountInRupees: amount,
      receipt: `WTOP-${Date.now()}`,
      notes: {
        purpose: 'wallet_topup',
        userId: req.userId,
        walletId: customerWallet.id
      }
    });

    const topup = await createWalletTopupRecord({
      walletId: customerWallet.id,
      userId: req.userId,
      amount,
      idempotencyKey: payload.idempotencyKey || null,
      razorpayOrderId: rpOrder.id,
      metadata: {
        createdByRoute: 'POST /api/wallet/topup/create'
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
    console.error('[Wallet] topup create error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    const status = httpStatusForUpstreamError(e);
    return res.status(status).json({
      status: 'error',
      message: e.message || 'Failed to create wallet top-up'
    });
  }
});

walletRouter.post('/topup/confirm', authenticateToken, requireServiceProvider, async (req, res) => {
  try {
    if (!isRazorpayConfigured()) {
      return res.status(503).json({
        status: 'error',
        code: 'RAZORPAY_NOT_CONFIGURED',
        message: 'Wallet top-up verification is unavailable.'
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
      return res.status(400).json({ status: 'error', message: 'Payment does not match top-up order' });
    }
    if (payment.status !== 'captured') {
      return res.status(400).json({ status: 'error', message: 'Top-up payment is not captured yet' });
    }

    const topup = await completeWalletTopup({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      actorUserId: req.userId,
      expectedUserId: req.userId
    });

    const balance = await getWalletBalance({ userId: req.userId, walletType: 'customer' });
    return res.json({
      status: 'success',
      walletTopup: topup,
      wallet: balance.wallet,
      balance: balance.balance
    });
  } catch (e) {
    console.error('[Wallet] topup confirm error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    if (e?.code === 'WALLET_TOPUP_NOT_FOUND') {
      return res.status(404).json({ status: 'error', message: e.message });
    }
    if (e?.code === 'WALLET_TOPUP_FORBIDDEN') {
      return res.status(403).json({ status: 'error', message: e.message });
    }
    return res.status(500).json({ status: 'error', message: e.message || 'Failed to confirm top-up' });
  }
});

walletRouter.post('/orders/:id/pay', authenticateToken, requireServiceProvider, async (req, res) => {
  try {
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
    console.error('[Wallet] order pay error:', e);
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
    return res.status(500).json({ status: 'error', message: e.message || 'Failed to pay order from wallet' });
  }
});

walletRouter.get('/withdrawals', authenticateToken, requireServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(walletWithdrawalListSchema, req.query || {});
    const wallet = await getOrCreateWallet({ userId: req.userId, walletType: 'customer' });
    const result = await listWalletWithdrawalRequests({
      walletId: wallet.id,
      status: payload.status || null,
      limit: normalizeLimit(payload.limit),
      cursor: payload.cursor || null
    });
    return res.json({ status: 'success', withdrawals: result.rows, pageInfo: result.pageInfo });
  } catch (e) {
    console.error('[Wallet] withdrawals list error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    return res.status(500).json({ status: 'error', message: 'Failed to load withdrawals' });
  }
});

walletRouter.get('/withdraw/bank-accounts', authenticateToken, requireServiceProvider, async (req, res) => {
  try {
    const rows = await listWalletBankAccounts({ userId: req.userId });
    return res.json({ status: 'success', bankAccounts: rows });
  } catch (e) {
    console.error('[Wallet] list bank accounts error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to load bank accounts' });
  }
});

walletRouter.post('/withdraw/bank-accounts', authenticateToken, requireServiceProvider, async (req, res) => {
  try {
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
    console.error('[Wallet] create bank account error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    return res.status(400).json({ status: 'error', message: e.message || 'Failed to save bank details' });
  }
});

walletRouter.post('/withdraw', authenticateToken, requireServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(walletWithdrawSchema, req.body || {});
    const amount = Number.parseFloat(String(payload.amount || '0'));
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ status: 'error', message: 'Amount must be greater than zero' });
    }
    const wallet = await getOrCreateWallet({ userId: req.userId, walletType: 'customer' });
    const request = await createWalletWithdrawalRequest({
      walletId: wallet.id,
      userId: req.userId,
      amount,
      idempotencyKey: payload.idempotencyKey || null,
      note: payload.note || '',
      bankAccountId: payload.bankAccountId || null
    });
    const balance = await getWalletBalance({ userId: req.userId, walletType: 'customer' });
    return res.json({
      status: 'success',
      message: 'Withdrawal request submitted for admin approval',
      withdrawal: request,
      wallet: balance.wallet,
      balance: balance.balance
    });
  } catch (e) {
    console.error('[Wallet] withdrawal error:', e);
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

export { walletRouter };
