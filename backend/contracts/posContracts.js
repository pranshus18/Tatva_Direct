import { z } from 'zod';

const posItemSchema = z.object({
  product_id: z.string().uuid(),
  supplier_product_id: z.string().uuid().optional().nullable(),
  quantity: z.union([z.number(), z.string()]),
  unit_price: z.union([z.number(), z.string()])
});

export const offlineOrderSchema = z.object({
  items: z.array(posItemSchema).min(1),
  payment: z
    .object({
      status: z.string().optional(),
      method: z.string().optional(),
      reference: z.string().optional(),
      payment_reference: z.string().optional(),
      paidAt: z.string().optional()
    })
    .optional(),
  outletId: z.string().optional().nullable(),
  clientOrderId: z.string().optional().nullable(),
  customerName: z.string().trim().min(1, 'Customer name is required'),
  customerPhone: z.string().optional()
});

export const offlineReturnSchema = z.object({
  items: z
    .array(
      z.object({
        supplier_product_id: z.string().uuid().optional().nullable(),
        product_id: z.string().uuid().optional().nullable(),
        quantity: z.union([z.number(), z.string()])
      })
    )
    .min(1),
  referenceOrderId: z.string().uuid().optional().nullable(),
  outletId: z.string().optional().nullable()
});

