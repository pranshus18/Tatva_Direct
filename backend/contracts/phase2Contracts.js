import { z } from 'zod';
import { LIFECYCLE_STATES } from '../utils/orderLifecycle.js';

export const catalogCompletenessRefreshSchema = z.object({
  productIds: z.array(z.string().uuid()).optional().default([])
});

export const duplicateMergeSchema = z.object({
  sourceProductId: z.string().uuid(),
  targetProductId: z.string().uuid(),
  confidence: z.union([z.number(), z.string()]).optional().nullable()
});

export const inventoryReservationSchema = z.object({
  supplierProductId: z.string().uuid(),
  supplierId: z.string().uuid(),
  quantity: z.union([z.number(), z.string()]),
  orderId: z.string().uuid().optional().nullable(),
  orderItemId: z.string().uuid().optional().nullable(),
  idempotencyKey: z.string().max(200).optional().nullable(),
  expiresInMinutes: z.union([z.number(), z.string()]).optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

export const orderTransitionSchema = z.object({
  nextState: z.enum(LIFECYCLE_STATES),
  notes: z.string().max(1000).optional()
});

export const returnPolicyDecisionSchema = z.object({
  orderCreatedAt: z.string(),
  categoryPolicyDays: z.union([z.number(), z.string()]).optional(),
  vendorPolicyDays: z.union([z.number(), z.string()]).optional(),
  disposition: z.enum(['pending', 'restock', 'discard', 'replace']).optional(),
  restockedQuantity: z.union([z.number(), z.string()]).optional()
});

export const vendorScorecardsRefreshSchema = z.object({
  weekStart: z.string(),
  weekEnd: z.string()
});

export const inventoryReservationConsumeSchema = z.object({});
export const inventoryReservationReleaseSchema = z.object({});
export const inventoryReservationExpireSchema = z.object({});

