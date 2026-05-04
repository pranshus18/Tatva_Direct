import { z } from 'zod';

export const paymentCreateSchema = z.object({
  idempotencyKey: z.string().max(200).optional().nullable()
});

export const paymentConfirmSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
  method: z.enum(['upi', 'card', 'online', 'netbanking', 'bank_transfer', 'cash', 'credit', 'cheque']).optional()
});

export const bankTransferMarkSchema = z.object({
  bankReference: z.string().min(1),
  paidAt: z.string().optional().nullable(),
  amount: z.union([z.number(), z.string()]).optional().nullable()
});

export const creditLineApproveSchema = z.object({
  creditLineDays: z.union([z.number(), z.string()]).optional()
});

export const bankTransferRequestSchema = z.object({
  amount: z.union([z.number(), z.string()]).optional().nullable(),
  note: z.string().max(1000).optional()
});

export const reconciliationRunSchema = z.object({
  fromDate: z.string().optional().nullable(),
  toDate: z.string().optional().nullable()
});

export const reconciliationIssueResolveSchema = z.object({
  status: z.string().optional(),
  notes: z.string().optional()
});

export const riskSignalReviewSchema = z.object({
  status: z.string().optional()
});

