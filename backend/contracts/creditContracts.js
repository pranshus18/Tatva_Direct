import { z } from 'zod';

export const creditAccountUpsertSchema = z
  .object({
    buyerUserId: z.string().uuid().optional().nullable(),
    customerId: z.string().uuid().optional().nullable(),
    customerPhone: z.string().max(20).optional().nullable(),
    creditLimit: z.union([z.number(), z.string()]),
    paylaterThreshold: z.union([z.number(), z.string()]).optional().nullable(),
    creditPeriodDays: z.union([z.number(), z.string()]).optional().nullable(),
    isEnabled: z.boolean().optional(),
    notes: z.string().max(500).optional().nullable()
  })
  .refine(
    (v) => Boolean(v.buyerUserId || v.customerId || String(v.customerPhone || '').trim()),
    { message: 'buyerUserId, customerId, or customerPhone is required' }
  );

export const creditCheckQuerySchema = z.object({
  buyerUserId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  customerName: z.string().max(200).optional(),
  customerPhone: z.string().max(20).optional(),
  orderAmount: z.union([z.number(), z.string()]).optional()
});

export const poCreditCheckBodySchema = z.object({
  checks: z
    .array(
      z.object({
        supplierId: z.string().uuid(),
        orderAmount: z.union([z.number(), z.string()])
      })
    )
    .min(1)
});

export const creditSettleSchema = z
  .object({
    buyerUserId: z.string().uuid().optional().nullable(),
    customerId: z.string().uuid().optional().nullable(),
    customerPhone: z.string().max(20).optional().nullable(),
    customerName: z.string().max(200).optional().nullable()
  })
  .refine(
    (v) => Boolean(v.buyerUserId || v.customerId || String(v.customerPhone || '').trim()),
    { message: 'buyerUserId, customerId, or customerPhone is required' }
  );
