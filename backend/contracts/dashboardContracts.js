import { z } from 'zod';

export const createReturnRequestSchema = z.object({
  orderItemId: z.string().uuid(),
  quantity: z.union([z.number(), z.string()]),
  reason: z.string().min(1),
  trackingId: z.string().optional().nullable()
});

export const acknowledgeReturnClosureSchema = z.object({});

export const updateOrderPaymentSchema = z.object({
  paymentStatus: z.enum(['pending', 'partial', 'paid', 'refunded']),
  paymentMethod: z.string().optional(),
  paymentReference: z.string().optional(),
  paidAt: z.string().optional()
});

export const deleteOrderRequestSchema = z.object({});

