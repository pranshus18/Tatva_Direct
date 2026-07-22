import express from 'express';
import multer from 'multer';
import {
  requireAuthentication as authenticateToken,
  requireServiceProvider,
  requirePlatformVaultUser
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
  getOrCreateWallet,
  listWalletBankAccounts,
  listWalletWithdrawalRequests,
  getWalletBalance,
  payOrderFromWallet
} from '../services/walletService.js';
import { getRazorpayPublicConfig } from '../services/razorpayService.js';
import { httpStatusForUpstreamError } from '../utils/paymentNormalize.js';
import {
  addPmVaultOfflineMoney,
  completePmVaultTopup,
  ensurePmVaultAuth,
  getPmVaultWalletView,
  initiatePmVaultTopup,
  readPmCredentialsFromRequest,
  usesPlatformVault
} from '../services/pmVaultService.js';

function normalizeUserType(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function vaultPagePath(userType) {
  return normalizeUserType(userType) === 'supplier' ? '/supplier-wallet' : '/vault';
}

const walletRouter = express.Router();
const vaultOfflineUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function topupMinAmount() {
  return Number.parseFloat(process.env.WALLET_MIN_TOPUP_INR || '100') || 100;
}

function normalizeLimit(raw) {
  const parsed = Number.parseInt(String(raw || '50'), 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(parsed, 200));
}

function pmAuthErrorResponse(res, error) {
  if (error?.code === 'PM_AUTH_REQUIRED') {
    return res.status(401).json({ status: 'error', code: error.code, message: error.message });
  }
  return null;
}

walletRouter.get('/config', authenticateToken, requirePlatformVaultUser, (req, res) => {
  const platformVault = usesPlatformVault(req.user);
  const razorpay = getRazorpayPublicConfig();

  res.json({
    status: 'success',
    config: {
      razorpay: {
        ...razorpay,
        enabled: platformVault || razorpay.isConfigured,
        isConfigured: platformVault || razorpay.isConfigured
      },
      pmVault: {
        enabled: platformVault,
        source: platformVault ? 'pm_platform' : null
      },
      minTopupInr: topupMinAmount()
    }
  });
});

/** Header pill balance — service provider + supplier portals (PM vault when linked). */
walletRouter.get('/header-balance', authenticateToken, async (req, res) => {
  try {
    const userType = normalizeUserType(req.user?.user_type);
    const credentials = readPmCredentialsFromRequest(req);

    if (usesPlatformVault(req.user)) {
      try {
        const pmWallet = await getPmVaultWalletView(req.user, credentials);
        return res.json({
          status: 'success',
          visible: true,
          source: 'pm_vault',
          linked: true,
          balance: pmWallet.balance,
          vault: pmWallet.wallet,
          vaultPath: vaultPagePath(userType)
        });
      } catch (e) {
        if (e?.code === 'PM_AUTH_REQUIRED') {
          return res.json({
            status: 'success',
            visible: true,
            source: 'pm_vault',
            linked: false,
            balance: null,
            vaultPath: vaultPagePath(userType),
            message: e.message
          });
        }
        throw e;
      }
    }

    return res.json({ status: 'success', visible: false });
  } catch (e) {
    console.error('[Vault] header balance error:', e);
    const authResp = pmAuthErrorResponse(res, e);
    if (authResp) return authResp;
    const status = httpStatusForUpstreamError(e);
    return res.status(status).json({
      status: 'error',
      message: e.message || 'Failed to load vault balance'
    });
  }
});

walletRouter.get('/balance', authenticateToken, requirePlatformVaultUser, async (req, res) => {
  try {
    const credentials = readPmCredentialsFromRequest(req);
    const pmWallet = await getPmVaultWalletView(req.user, credentials);
    return res.json({
      status: 'success',
      vault: pmWallet.vault || pmWallet.wallet,
      balance: pmWallet.balance,
      holdingAmount: pmWallet.holdingAmount ?? 0,
      transactions: pmWallet.transactions || [],
      summary: pmWallet.summary,
      source: 'pm_vault'
    });
  } catch (e) {
    console.error('[Vault] balance error:', e);
    const authResp = pmAuthErrorResponse(res, e);
    if (authResp) return authResp;
    const status = httpStatusForUpstreamError(e);
    return res.status(status).json({ status: 'error', message: e.message || 'Failed to load vault balance' });
  }
});

walletRouter.get('/transactions', authenticateToken, requirePlatformVaultUser, async (req, res) => {
  try {
    const credentials = readPmCredentialsFromRequest(req);
    const pmWallet = await getPmVaultWalletView(req.user, credentials);
    return res.json({
      status: 'success',
      transactions: pmWallet.transactions || [],
      pageInfo: {
        hasMore: false,
        nextCursor: null
      },
      source: 'pm_vault'
    });
  } catch (e) {
    console.error('[Vault] transactions error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    const authResp = pmAuthErrorResponse(res, e);
    if (authResp) return authResp;
    const status = httpStatusForUpstreamError(e);
    return res.status(status).json({ status: 'error', message: e.message || 'Failed to load vault transactions' });
  }
});

walletRouter.get('/ledger-summary', authenticateToken, requirePlatformVaultUser, async (req, res) => {
  try {
    const credentials = readPmCredentialsFromRequest(req);
    const pmWallet = await getPmVaultWalletView(req.user, credentials);
    return res.json({
      status: 'success',
      summary: pmWallet.summary,
      source: 'pm_vault'
    });
  } catch (e) {
    console.error('[Vault] ledger summary error:', e);
    const authResp = pmAuthErrorResponse(res, e);
    if (authResp) return authResp;
    const status = httpStatusForUpstreamError(e);
    return res.status(status).json({ status: 'error', message: e.message || 'Failed to load vault ledger summary' });
  }
});

walletRouter.post('/topup/create', authenticateToken, requirePlatformVaultUser, async (req, res) => {
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
        message: `Minimum vault credit amount is INR ${minTopup}`
      });
    }

    const credentials = readPmCredentialsFromRequest(req);
    const { pmUserId, accessToken } = await ensurePmVaultAuth(req.user, credentials);
    const paymentIntent = await initiatePmVaultTopup({
      pmUserId,
      amountInRupees: amount,
      description: 'Vault top-up',
      accessToken
    });

    return res.json({
      status: 'success',
      vaultTopup: {
        id: paymentIntent.orderId,
        amount,
        status: 'pending',
        source: 'pm_vault'
      },
      paymentIntent: {
        provider: paymentIntent.provider,
        orderId: paymentIntent.orderId,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        keyId: paymentIntent.keyId
      },
      source: 'pm_vault'
    });
  } catch (e) {
    console.error('[Vault] topup create error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    const authResp = pmAuthErrorResponse(res, e);
    if (authResp) return authResp;
    const status = httpStatusForUpstreamError(e);
    return res.status(status).json({
      status: 'error',
      message: e.message || 'Failed to create vault credit'
    });
  }
});

walletRouter.post(
  '/offline/add-money',
  authenticateToken,
  requirePlatformVaultUser,
  vaultOfflineUpload.array('documents', 10),
  async (req, res) => {
    try {
      const amount = Number.parseFloat(String(req.body?.amount || '0'));
      const minTopup = topupMinAmount();
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ status: 'error', message: 'Amount must be greater than zero' });
      }
      if (amount < minTopup) {
        return res.status(400).json({
          status: 'error',
          message: `Minimum vault credit amount is INR ${minTopup}`
        });
      }

      const credentials = readPmCredentialsFromRequest(req);
      const { pmUserId, accessToken } = await ensurePmVaultAuth(req.user, credentials);
      const result = await addPmVaultOfflineMoney({
        pmUserId,
        accessToken,
        amountInRupees: amount,
        subPaymentMethod: req.body?.subPaymentMethod,
        receiptNumber: req.body?.receiptNumber,
        chequeNumber: req.body?.chequeNumber,
        utrNumber: req.body?.utrNumber,
        details: req.body?.details,
        documents: req.files || []
      });
      const pmWallet = await getPmVaultWalletView(req.user, credentials);

      return res.json({
        status: 'success',
        source: 'pm_vault',
        offline: true,
        result,
        vault: pmWallet.vault || pmWallet.wallet,
        balance: pmWallet.balance
      });
    } catch (e) {
      console.error('[Vault] offline add-money error:', e);
      const authResp = pmAuthErrorResponse(res, e);
      if (authResp) return authResp;
      const status = httpStatusForUpstreamError(e);
      return res.status(status).json({
        status: 'error',
        code: e.code || 'PM_VAULT_OFFLINE_FAILED',
        message: e.message || 'Failed to add offline vault payment'
      });
    }
  }
);

walletRouter.post('/topup/confirm', authenticateToken, requirePlatformVaultUser, async (req, res) => {
  try {
    const payload = parseWithSchema(walletTopupConfirmSchema, req.body || {});
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = payload;
    const credentials = readPmCredentialsFromRequest(req);
    const { accessToken } = await ensurePmVaultAuth(req.user, credentials);

    const completion = await completePmVaultTopup({
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      accessToken
    });
    const pmWallet = await getPmVaultWalletView(req.user, credentials);

    return res.json({
      status: 'success',
      vaultTopup: {
        id: razorpayOrderId,
        status: 'completed',
        razorpayOrderId,
        razorpayPaymentId,
        source: 'pm_vault',
        completion
      },
      vault: pmWallet.wallet,
      balance: pmWallet.balance,
      source: 'pm_vault'
    });
  } catch (e) {
    console.error('[Vault] topup confirm error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    const authResp = pmAuthErrorResponse(res, e);
    if (authResp) return authResp;
    const status = httpStatusForUpstreamError(e);
    return res.status(status).json({ status: 'error', message: e.message || 'Failed to confirm vault credit' });
  }
});

walletRouter.post('/orders/:id/pay', authenticateToken, requireServiceProvider, async (req, res) => {
  try {
    const payload = parseWithSchema(walletPayOrderSchema, req.body || {});
    const credentials = readPmCredentialsFromRequest(req);
    const result = await payOrderFromWallet({
      orderId: req.params.id,
      actorUserId: req.userId,
      actorRole: req.user?.user_type || null,
      requestId: req.requestId || null,
      ipAddress: req.ip || null,
      idempotencyKey: payload.idempotencyKey || null,
      pmCredentials: credentials
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
    console.error('[Vault] order pay error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    const authResp = pmAuthErrorResponse(res, e);
    if (authResp) return authResp;
    if (e?.code === 'ORDER_NOT_FOUND') {
      return res.status(404).json({ status: 'error', message: e.message });
    }
    if (e?.code === 'ORDER_FORBIDDEN') {
      return res.status(403).json({ status: 'error', message: e.message });
    }
    if (e?.code === 'ORDER_ALREADY_PAID') {
      return res.status(400).json({ status: 'error', message: e.message });
    }
    if (e?.code === 'INSUFFICIENT_WALLET_BALANCE' || e?.code === 'INSUFFICIENT_VAULT_BALANCE') {
      return res.status(400).json({
        status: 'error',
        code: 'INSUFFICIENT_VAULT_BALANCE',
        message: e.message || 'Insufficient vault balance'
      });
    }
    if (e?.code === 'PM_VAULT_PAY_NOT_CONFIGURED' || e?.code === 'PM_VAULT_REQUEST_FAILED') {
      return res.status(502).json({
        status: 'error',
        code: e.code,
        message: e.message || 'PM vault payment failed'
      });
    }
    if (e?.code === 'WALLET_BALANCE_CONFLICT') {
      return res.status(409).json({ status: 'error', code: e.code, message: e.message });
    }
    return res.status(500).json({ status: 'error', message: e.message || 'Failed to pay order from vault' });
  }
});

walletRouter.get('/withdrawals', authenticateToken, requireServiceProvider, async (req, res) => {
  if (usesPlatformVault(req.user)) {
    return res.json({
      status: 'success',
      withdrawals: [],
      pageInfo: { nextCursor: null },
      message: 'Withdrawals are managed on the PM platform vault, not in Tatva Direct.'
    });
  }
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
    console.error('[Vault] withdrawals list error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    return res.status(500).json({ status: 'error', message: 'Failed to load withdrawals' });
  }
});

walletRouter.get('/withdraw/bank-accounts', authenticateToken, requireServiceProvider, async (req, res) => {
  if (usesPlatformVault(req.user)) {
    return res.json({
      status: 'success',
      bankAccounts: [],
      message: 'Bank accounts for vault withdrawals are managed on the PM platform.'
    });
  }
  try {
    const rows = await listWalletBankAccounts({ userId: req.userId });
    return res.json({ status: 'success', bankAccounts: rows });
  } catch (e) {
    console.error('[Vault] list bank accounts error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to load bank accounts' });
  }
});

walletRouter.post('/withdraw/bank-accounts', authenticateToken, requireServiceProvider, async (req, res) => {
  if (usesPlatformVault(req.user)) {
    return res.status(400).json({
      status: 'error',
      code: 'PM_VAULT_MANAGED',
      message: 'Vault bank details are managed on the PM platform, not in Tatva Direct.'
    });
  }
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
    console.error('[Vault] create bank account error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    return res.status(400).json({ status: 'error', message: e.message || 'Failed to save bank details' });
  }
});

walletRouter.post('/withdraw', authenticateToken, requireServiceProvider, async (req, res) => {
  if (usesPlatformVault(req.user)) {
    return res.status(400).json({
      status: 'error',
      code: 'PM_VAULT_MANAGED',
      message: 'Vault withdrawals are managed on the PM platform, not via Tatva Direct wallet tables.'
    });
  }
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
    console.error('[Vault] withdrawal error:', e);
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
    return res.status(500).json({ status: 'error', message: e.message || 'Failed to withdraw from vault' });
  }
});

export { walletRouter };
