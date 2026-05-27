import {
  buildCreditStatus,
  listCreditAccountsForSupplier,
  maybeNotifySupplierCreditAlert,
  settleCreditCycle,
  upsertCreditAccount
} from '../../services/creditAccountService.js';
import {
  creditAccountUpsertSchema,
  creditCheckQuerySchema,
  creditSettleSchema
} from '../../contracts/creditContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';
import { supabase } from '../../config/supabase.js';

export function registerSupplierCreditRoutes(ctx) {
  const { router, authenticateToken } = ctx;

  router.get('/credit-accounts', authenticateToken, async (req, res) => {
    try {
      const accounts = await listCreditAccountsForSupplier(req.userId);
      return res.json({ status: 'success', accounts });
    } catch (e) {
      console.error('[Supplier Credit] list error:', e);
      return res.status(500).json({ status: 'error', message: e.message || 'Failed to load credit accounts' });
    }
  });

  router.get('/credit-accounts/check', authenticateToken, async (req, res) => {
    try {
      const query = parseWithSchema(creditCheckQuerySchema, req.query || {});
      const orderAmount = query.orderAmount != null ? Number(query.orderAmount) : 0;
      const credit = await buildCreditStatus({
        supplierId: req.userId,
        buyerUserId: query.buyerUserId || null,
        customerId: query.customerId || null,
        customerName: query.customerName || null,
        customerPhone: query.customerPhone || null,
        orderAmount
      });
      return res.json({ status: 'success', credit });
    } catch (e) {
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      console.error('[Supplier Credit] check error:', e);
      return res.status(500).json({ status: 'error', message: e.message || 'Failed to check credit' });
    }
  });

  router.put('/credit-accounts', authenticateToken, async (req, res) => {
    try {
      const payload = parseWithSchema(creditAccountUpsertSchema, req.body || {});
      const account = await upsertCreditAccount({
        supplierId: req.userId,
        buyerUserId: payload.buyerUserId || null,
        customerId: payload.customerId || null,
        customerPhone: payload.customerPhone || null,
        creditLimit: payload.creditLimit,
        paylaterThreshold: payload.paylaterThreshold,
        creditPeriodDays: payload.creditPeriodDays ?? 30,
        isEnabled: payload.isEnabled,
        notes: payload.notes
      });
      const credit = await buildCreditStatus({
        supplierId: req.userId,
        buyerUserId: account.buyer_user_id,
        customerId: account.customer_id,
        customerPhone: account.customer_phone,
        orderAmount: 0
      });

      try {
        let partyName = account.customer_phone || 'Customer';
        if (account.buyer_user_id) {
          const { data: buyer } = await supabase
            .from('users')
            .select('name, company')
            .eq('id', account.buyer_user_id)
            .maybeSingle();
          partyName = buyer?.name || buyer?.company || partyName;
        }
        await maybeNotifySupplierCreditAlert({
          supplierId: req.userId,
          buyerUserId: account.buyer_user_id,
          customerId: account.customer_id,
          customerPhone: account.customer_phone,
          partyName
        });
      } catch (notifyErr) {
        console.error('[Supplier Credit] alert on save (non-fatal):', notifyErr);
      }

      return res.json({ status: 'success', account, credit });
    } catch (e) {
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      console.error('[Supplier Credit] upsert error:', e);
      return res.status(500).json({ status: 'error', message: e.message || 'Failed to save credit account' });
    }
  });

  router.post('/credit-accounts/settle', authenticateToken, async (req, res) => {
    try {
      const payload = parseWithSchema(creditSettleSchema, req.body || {});
      const result = await settleCreditCycle({
        supplierId: req.userId,
        buyerUserId: payload.buyerUserId || null,
        customerId: payload.customerId || null,
        customerPhone: payload.customerPhone || null,
        customerName: payload.customerName || null
      });
      return res.json({ status: 'success', ...result });
    } catch (e) {
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      console.error('[Supplier Credit] settle error:', e);
      return res.status(500).json({ status: 'error', message: e.message || 'Failed to settle credit cycle' });
    }
  });
}
