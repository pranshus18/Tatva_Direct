import { z } from 'zod';

export const adminUpdateProductSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  price: z.union([z.number(), z.string()]).optional(),
  stock: z.union([z.number(), z.string()]).optional(),
  minOrderQuantity: z.union([z.number(), z.string()]).optional(),
  min_order_quantity: z.union([z.number(), z.string()]).optional(),
  unit: z.string().optional(),
  location: z.string().optional(),
  specifications: z.record(z.string(), z.any()).optional(),
  images: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  igst_rate: z.union([z.number(), z.string()]).optional().nullable(),
  cgst_rate: z.union([z.number(), z.string()]).optional().nullable(),
  sgst_rate: z.union([z.number(), z.string()]).optional().nullable(),
  igstRate: z.union([z.number(), z.string()]).optional().nullable(),
  cgstRate: z.union([z.number(), z.string()]).optional().nullable(),
  sgstRate: z.union([z.number(), z.string()]).optional().nullable(),
  hsnCode: z.union([z.string(), z.number()]).optional().nullable(),
  hsn_code: z.union([z.string(), z.number()]).optional().nullable(),
  supplier_id: z.string().uuid().optional(),
  supplier: z.any().optional()
}).passthrough();

export const adminProductRejectSchema = z.object({
  reason: z.string().optional()
});

export const adminApproveAllProductsSchema = z.object({});

export const adminBrandRejectSchema = z.object({
  reason: z.string().optional()
});

export const adminBrandRequestSchema = z.object({
  name: z.string().min(1)
});

export const adminSupplierChainRejectSchema = z.object({
  reason: z.string().optional()
});

export const adminUserStatusUpdateSchema = z.object({
  status: z.enum(['active', 'inactive'])
});

export const adminSpecTemplateCreateSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  family_id: z.string().uuid().optional().nullable(),
  fields: z.array(z.record(z.string(), z.any())).min(1)
});

export const adminProductRequestReviewSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'merged', 'needs_info', 'in_review']),
  notes: z.string().optional(),
  resolved_product_id: z.string().uuid().optional().nullable(),
  resolved_variant_id: z.string().uuid().optional().nullable()
});

export const adminAiEnhanceSchema = z.object({
  productName: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  /** Admin-only instructions for spec-key generation; not stored on the product. */
  prompt: z.string().optional(),
  provider: z.string().optional()
});

export const adminAiGstSchema = z.object({
  productName: z.string().min(1),
  category: z.string().optional(),
  description: z.string().optional(),
  hsnCode: z.union([z.string(), z.number()]).optional(),
  prompt: z.string().optional(),
  provider: z.string().optional()
});

export const adminProductApproveSchema = z.object({});
export const adminProductDeleteSchema = z.object({});
export const adminBrandApproveSchema = z.object({});
export const adminSupplierChainApproveSchema = z.object({});

export const adminSupplyChainDefinitionUpsertSchema = z.object({
  brandName: z.string().optional(),
  categoryName: z.string().optional(),
  stages: z.array(z.any()).optional(),
  summary: z.string().optional(),
  markAsAiSuggested: z.boolean().optional(),
  aiSuggestedAt: z.string().optional()
});

export const adminSupplyChainSuggestSchema = z.object({
  brandName: z.string().optional(),
  categoryName: z.string().optional(),
  productName: z.string().optional(),
  extraContext: z.string().optional()
});

