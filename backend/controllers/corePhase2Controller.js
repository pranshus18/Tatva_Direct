import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { supabase } from '../config/supabase.js';
import { isFeatureEnabled } from '../utils/featureFlags.js';
import logger from '../utils/logger.js';
import {
  catalogCompletenessRefreshSchema,
  duplicateMergeSchema,
  inventoryReservationConsumeSchema,
  inventoryReservationExpireSchema,
  inventoryReservationReleaseSchema,
  inventoryReservationSchema,
  orderTransitionSchema,
  returnPolicyDecisionSchema,
  vendorScorecardsRefreshSchema
} from '../contracts/phase2Contracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import {
  buildNormalizationTriageQueue,
  computeBaselineKpis,
  expireReservations,
  getWarehouseAllocation,
  refreshProductCompleteness,
  refreshVendorScorecards,
  reserveInventory,
  settleReservation,
  transitionOrderState,
  upsertReturnPolicyDecision,
  evaluateReturnPolicy
} from '../services/phase2CoreService.js';

const router = express.Router();
const isEnabled = (name, fallback = false) => isFeatureEnabled(name, fallback);

router.get('/baseline-kpis', authenticateToken, async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;
    const data = await computeBaselineKpis({ fromDate, toDate });
    return res.json({ status: 'success', data });
  } catch (error) {
    logger.error('[Phase2] baseline-kpis error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to compute KPIs' });
  }
});

router.post('/catalog/completeness/refresh', authenticateToken, async (req, res) => {
  try {
    const payload = parseWithSchema(catalogCompletenessRefreshSchema, req.body || {});
    const { productIds } = payload;
    const result = await refreshProductCompleteness({ productIds });
    return res.json({ status: 'success', ...result });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.error('[Phase2] refresh completeness error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to refresh completeness' });
  }
});

router.get('/catalog/duplicates', authenticateToken, async (req, res) => {
  try {
    const threshold = Number(req.query.threshold || 70);
    const { data: rows, error } = await supabase
      .from('products')
      .select('id, name, category, duplicate_of_product_id, duplicate_confidence')
      .gte('duplicate_confidence', threshold)
      .order('duplicate_confidence', { ascending: false })
      .limit(300);
    if (error) throw error;
    return res.json({ status: 'success', duplicates: rows || [] });
  } catch (error) {
    logger.error('[Phase2] duplicate list error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to fetch duplicate queue' });
  }
});

router.get('/catalog/triage', authenticateToken, async (req, res) => {
  try {
    const threshold = Number(req.query.threshold || 70);
    const limit = Number(req.query.limit || 200);
    const queue = await buildNormalizationTriageQueue({ threshold, limit });
    return res.json({ status: 'success', queue });
  } catch (error) {
    logger.error('[Phase2] triage queue error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to fetch triage queue' });
  }
});

router.post('/catalog/duplicates/merge', authenticateToken, async (req, res) => {
  try {
    const payload = parseWithSchema(duplicateMergeSchema, req.body || {});
    const { sourceProductId, targetProductId, confidence = null } = payload;
    if (sourceProductId === targetProductId) {
      return res.status(400).json({ status: 'error', message: 'sourceProductId and targetProductId cannot be the same' });
    }
    const { data: updated, error } = await supabase
      .from('products')
      .update({
        duplicate_of_product_id: targetProductId,
        duplicate_confidence: confidence,
        normalization_last_reviewed_at: new Date().toISOString()
      })
      .eq('id', sourceProductId)
      .select('*')
      .single();
    if (error) throw error;
    return res.json({ status: 'success', merged: updated });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.error('[Phase2] duplicate merge error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to merge duplicate product' });
  }
});

router.post('/inventory/reservations', authenticateToken, async (req, res) => {
  try {
    if (!isEnabled('PHASE2_RESERVATION_ENABLED')) {
      return res.status(403).json({ status: 'error', message: 'Reservation feature is disabled' });
    }
    const payload = parseWithSchema(inventoryReservationSchema, req.body || {});
    const { supplierProductId, supplierId, quantity, orderId, orderItemId, idempotencyKey, expiresInMinutes, metadata } =
      payload;
    const reservation = await reserveInventory({
      supplierProductId,
      supplierId,
      quantity,
      orderId,
      orderItemId,
      idempotencyKey,
      expiresInMinutes,
      actorUserId: req.userId,
      metadata: metadata || {}
    });
    return res.json({ status: 'success', reservation });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.warn('[Phase2] reserve inventory error:', error);
    return res.status(400).json({ status: 'error', message: error.message || 'Failed to reserve inventory' });
  }
});

router.post('/inventory/reservations/:id/consume', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(inventoryReservationConsumeSchema, req.body || {});
    if (!isEnabled('PHASE2_RESERVATION_ENABLED')) {
      return res.status(403).json({ status: 'error', message: 'Reservation feature is disabled' });
    }
    const reservation = await settleReservation({
      reservationId: req.params.id,
      mode: 'consume',
      actorUserId: req.userId
    });
    return res.json({ status: 'success', reservation });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.warn('[Phase2] consume reservation error:', error);
    return res.status(400).json({ status: 'error', message: error.message || 'Failed to consume reservation' });
  }
});

router.post('/inventory/reservations/:id/release', authenticateToken, async (req, res) => {
  try {
    parseWithSchema(inventoryReservationReleaseSchema, req.body || {});
    if (!isEnabled('PHASE2_RESERVATION_ENABLED')) {
      return res.status(403).json({ status: 'error', message: 'Reservation feature is disabled' });
    }
    const reservation = await settleReservation({
      reservationId: req.params.id,
      mode: 'release',
      actorUserId: req.userId
    });
    return res.json({ status: 'success', reservation });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.warn('[Phase2] release reservation error:', error);
    return res.status(400).json({ status: 'error', message: error.message || 'Failed to release reservation' });
  }
});

router.post('/inventory/reservations/expire', authenticateToken, async (_req, res) => {
  try {
    parseWithSchema(inventoryReservationExpireSchema, _req.body || {});
    const result = await expireReservations();
    return res.json({ status: 'success', ...result });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.error('[Phase2] expire reservations error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to expire reservations' });
  }
});

router.get('/inventory/allocation/:supplierProductId', authenticateToken, async (req, res) => {
  try {
    const quantity = Number(req.query.quantity || 1);
    const plan = await getWarehouseAllocation({
      supplierProductId: req.params.supplierProductId,
      quantity
    });
    return res.json({ status: 'success', plan });
  } catch (error) {
    logger.warn('[Phase2] allocation error:', error);
    return res.status(400).json({ status: 'error', message: error.message || 'Failed to compute warehouse allocation' });
  }
});

router.post('/orders/:id/transition', authenticateToken, async (req, res) => {
  try {
    if (!isEnabled('PHASE2_STATE_MACHINE_ENABLED')) {
      return res.status(403).json({ status: 'error', message: 'Order state machine is disabled' });
    }
    const payload = parseWithSchema(orderTransitionSchema, req.body || {});
    const { nextState, notes } = payload;
    const order = await transitionOrderState({
      orderId: req.params.id,
      nextState,
      actorUserId: req.userId,
      notes
    });
    return res.json({ status: 'success', order });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.warn('[Phase2] order transition error:', error);
    return res.status(400).json({ status: 'error', message: error.message || 'Failed order transition' });
  }
});

router.post('/returns/:id/policy-decision', authenticateToken, async (req, res) => {
  try {
    if (!isEnabled('PHASE2_RETURNS_POLICY_ENABLED')) {
      return res.status(403).json({ status: 'error', message: 'Returns policy engine is disabled' });
    }
    const payload = parseWithSchema(returnPolicyDecisionSchema, req.body || {});
    const {
      orderCreatedAt,
      categoryPolicyDays = 7,
      vendorPolicyDays = 7,
      disposition = 'pending',
      restockedQuantity = 0
    } = payload;

    const policy = evaluateReturnPolicy({ orderCreatedAt, categoryPolicyDays, vendorPolicyDays });
    if (!policy.allowed) {
      return res.status(400).json({
        status: 'error',
        message: `Return policy window exceeded (${policy.ageDays}d > ${policy.policyWindowDays}d)`,
        policy
      });
    }

    const updated = await upsertReturnPolicyDecision({
      returnId: req.params.id,
      disposition,
      restockedQuantity,
      policySnapshot: policy,
      actorUserId: req.userId
    });
    return res.json({ status: 'success', returnRequest: updated, policy });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.warn('[Phase2] return policy decision error:', error);
    return res.status(400).json({ status: 'error', message: error.message || 'Failed to apply return policy' });
  }
});

router.post('/analytics/vendor-scorecards/refresh', authenticateToken, async (req, res) => {
  try {
    if (!isEnabled('PHASE2_VENDOR_SCORECARD_ENABLED')) {
      return res.status(403).json({ status: 'error', message: 'Vendor scorecard is disabled' });
    }
    const payload = parseWithSchema(vendorScorecardsRefreshSchema, req.body || {});
    const { weekStart, weekEnd } = payload;
    const result = await refreshVendorScorecards({ weekStart, weekEnd });
    return res.json({ status: 'success', ...result });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    logger.error('[Phase2] refresh scorecards error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to refresh vendor scorecards' });
  }
});

router.get('/analytics/vendor-scorecards', authenticateToken, async (req, res) => {
  try {
    const { supplierId, limit = 100 } = req.query;
    let query = supabase
      .from('vendor_scorecards')
      .select('*')
      .order('week_start', { ascending: false })
      .limit(Number(limit) || 100);
    if (supplierId) query = query.eq('supplier_id', supplierId);
    const { data, error } = await query;
    if (error) throw error;
    return res.json({ status: 'success', scorecards: data || [] });
  } catch (error) {
    logger.error('[Phase2] get scorecards error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to fetch vendor scorecards' });
  }
});

export { router as corePhase2Router };
