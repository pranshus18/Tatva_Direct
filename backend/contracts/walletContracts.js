import { z } from 'zod';

export const walletTopupCreateSchema = z.object({
  amount: z.union([z.number(), z.string()]),
  idempotencyKey: z.string().max(150).optional().nullable()
});

export const walletTopupConfirmSchema = z.object({
  walletTopupId: z.string().uuid().optional().nullable(),
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1)
});

export const walletTransactionsListSchema = z.object({
  limit: z.union([z.number(), z.string()]).optional().nullable(),
  cursor: z.string().optional().nullable(),
  from: z.string().optional().nullable(),
  to: z.string().optional().nullable(),
  search: z.string().max(140).optional().nullable()
});

export const walletPayOrderSchema = z.object({
  idempotencyKey: z.string().max(150).optional().nullable()
});

export const walletWithdrawSchema = z.object({
  amount: z.union([z.number(), z.string()]),
  idempotencyKey: z.string().max(150).optional().nullable(),
  note: z.string().max(500).optional().nullable(),
  bankAccountId: z.string().uuid().optional().nullable()
});

export const walletBankAccountSchema = z.object({
  accountHolderName: z.string().max(120).optional().nullable(),
  bankName: z.string().max(120).optional().nullable(),
  accountNumber: z.string().max(40).optional().nullable(),
  ifscCode: z
    .string()
    .max(20)
    .optional()
    .nullable()
    .transform((value) => (value ? String(value).toUpperCase() : value)),
  upiId: z.string().max(120).optional().nullable(),
  notes: z.string().max(500).optional().nullable()
});

export const walletWithdrawActionSchema = z.object({
  note: z.string().max(500).optional().nullable(),
  payoutReference: z.string().max(120).optional().nullable()
});

export const walletWithdrawalListSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'failed', 'cancelled']).optional().nullable(),
  limit: z.union([z.number(), z.string()]).optional().nullable(),
  cursor: z.string().optional().nullable()
});

export const supplyChainFeeRuleSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  brandName: z.string().max(140).optional().nullable(),
  supplyChainRole: z.enum([
    'manufacturer',
    'stockist',
    'regional_distributor',
    'local_distributor',
    'dealer',
    'retailer'
  ]),
  feeType: z.enum(['percentage', 'fixed']),
  feeValue: z.union([z.number(), z.string()]),
  isActive: z.boolean().optional(),
  notes: z.string().max(1000).optional().nullable(),
  effectiveFrom: z.string().optional().nullable(),
  effectiveTo: z.string().optional().nullable()
});

export const supplyChainFeeRulesUpsertSchema = z.object({
  rules: z.array(supplyChainFeeRuleSchema).min(1).max(200)
});
