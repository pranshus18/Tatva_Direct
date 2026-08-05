import { buildCreditStatus } from '../../services/creditAccountService.js';
import { poCreditCheckBodySchema } from '../../contracts/creditContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../../utils/contractValidation.js';

export function registerPoCreditRoutes(ctx) {
  const { router, authenticateToken, isServiceProviderOrSupplier } = ctx;

  router.post('/credit-check', authenticateToken, isServiceProviderOrSupplier, async (req, res) => {
    try {
      const payload = parseWithSchema(poCreditCheckBodySchema, req.body || {});
      const results = [];
      for (const row of payload.checks) {
        const credit = await buildCreditStatus({
          supplierId: row.supplierId,
          buyerUserId: req.userId,
          orderAmount: Number(row.orderAmount) || 0
        });
        results.push({
          supplierId: row.supplierId,
          ...credit
        });
      }
      const allAllowed = results.every((r) => r.allowed);
      return res.json({ status: 'success', allAllowed, results });
    } catch (e) {
      if (String(e?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
      }
      console.error('[PO Credit] check error:', e);
      return res.status(500).json({ status: 'error', message: e.message || 'Failed to check credit' });
    }
  });
}
