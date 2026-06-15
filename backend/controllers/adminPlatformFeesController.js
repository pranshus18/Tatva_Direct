import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { requireAdminPrivileges } from '../middleware/adminMiddleware.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import { supplyChainFeeRulesUpsertSchema } from '../contracts/walletContracts.js';
import {
  listSupplyChainFeeRules,
  upsertSupplyChainFeeRules
} from '../services/platformFeeService.js';

const adminPlatformFeesRouter = express.Router();

adminPlatformFeesRouter.get('/', authenticateToken, requireAdminPrivileges, async (_req, res) => {
  try {
    const rows = await listSupplyChainFeeRules();
    return res.json({ status: 'success', rules: rows });
  } catch (e) {
    console.error('[AdminPlatformFees] list error:', e);
    return res.status(500).json({ status: 'error', message: 'Failed to load platform fee rules' });
  }
});

adminPlatformFeesRouter.put('/', authenticateToken, requireAdminPrivileges, async (req, res) => {
  try {
    const payload = parseWithSchema(supplyChainFeeRulesUpsertSchema, req.body || {});
    const rows = await upsertSupplyChainFeeRules({
      rules: payload.rules,
      actorUserId: req.userId
    });
    return res.json({
      status: 'success',
      updatedCount: rows.length,
      rules: rows
    });
  } catch (e) {
    console.error('[AdminPlatformFees] upsert error:', e);
    if (String(e?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(e) });
    }
    return res.status(500).json({ status: 'error', message: e.message || 'Failed to update platform fee rules' });
  }
});

export { adminPlatformFeesRouter };
