import { z } from 'zod';

const productSpecsSchema = z.record(z.string(), z.any()).optional();

const poGroupItemSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  normalizedName: z.string().optional(),
  rawName: z.string().optional(),
  name: z.string().optional(),
  quantity: z.union([z.number(), z.string()]).optional().nullable(),
  unit: z.string().optional(),
  productId: z.string().uuid().optional().nullable(),
  supplierProductId: z.string().uuid().optional().nullable(),
  brand: z.string().optional(),
  brandName: z.string().optional(),
  brandModel: z.string().optional(),
  modelBrand: z.string().optional(),
  sku: z.string().optional(),
  skuNo: z.string().optional(),
  gsku: z.string().optional(),
  packSize: z.union([z.string(), z.number()]).optional(),
  pack_size: z.union([z.string(), z.number()]).optional(),
  specifications: productSpecsSchema
}).passthrough();

export const poGroupRequestSchema = z.object({
  selectedVendors: z.record(z.string(), z.union([z.string(), z.number(), z.null(), z.undefined()])),
  substitutions: z.array(
    z.object({
      originalItem: z.union([z.string(), z.number()]).optional(),
      suggestedItem: z.union([z.string(), z.number()]).optional()
    }).passthrough()
  ).optional().default([]),
  items: z.array(poGroupItemSchema).min(1)
});

const addressSchema = z.object({
  line1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  country: z.string().optional(),
  street: z.string().optional(),
  zipCode: z.string().optional()
});

export const poCreateRequestSchema = z.object({
  poGroups: z.array(
    z.object({
      vendorId: z.string().min(1),
      vendorName: z.string().optional(),
      items: z.array(poGroupItemSchema).min(1),
      total: z.union([z.number(), z.string()]).optional()
    })
  ).min(1),
  boqId: z.string().uuid().optional().nullable(),
  requiredDate: z.string().optional().nullable(),
  paymentMethod: z.enum(['cod', 'online', 'bank_transfer', 'credit']).optional(),
  deliveryDestination: z.enum(['shipping', 'billing']).optional(),
  shippingAddress: addressSchema.optional(),
  billingAddress: addressSchema.optional(),
  gstin: z.string().optional().nullable()
});

const poCartBoqGroupSchema = z.object({
  groupId: z.string().min(1),
  boqId: z.string().uuid().optional().nullable(),
  boqName: z.string().optional().nullable(),
  boqProject: z.record(z.string(), z.any()).optional().nullable(),
  selectedVendors: z
    .record(z.string(), z.union([z.string(), z.number(), z.null(), z.undefined()]))
    .optional()
    .default({}),
  substitutions: z.array(z.record(z.string(), z.any())).optional().default([]),
  items: z.array(poGroupItemSchema)
});

export const poCartSaveSchema = z
  .object({
    selectedVendors: z
      .record(z.string(), z.union([z.string(), z.number(), z.null(), z.undefined()]))
      .optional()
      .default({}),
    substitutions: z.array(z.record(z.string(), z.any())).optional().default([]),
    items: z.array(poGroupItemSchema).optional().default([]),
    boqGroups: z.array(poCartBoqGroupSchema).optional(),
    boqId: z.string().uuid().optional().nullable(),
    boqProject: z.record(z.string(), z.any()).optional().nullable(),
    requiredDate: z.string().optional().nullable(),
    paymentMethod: z.enum(['cod', 'online', 'bank_transfer', 'credit']).optional().nullable(),
    deliveryDestination: z.enum(['shipping', 'billing']).optional().nullable(),
    shippingAddress: addressSchema.optional(),
    billingAddress: addressSchema.optional(),
    gstin: z.string().optional().nullable()
  })
  .superRefine((val, ctx) => {
    const n = Array.isArray(val.items) ? val.items.length : 0;
    const g = Array.isArray(val.boqGroups) ? val.boqGroups.length : 0;
    if (n < 1 && g < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide at least one item or one BOQ group'
      });
    }
  });

export const poSelfServePatchSchema = z.object({
  expectedDeliveryDate: z.string().optional().nullable(),
  paymentMethod: z.enum(['cash', 'bank_transfer', 'cheque', 'online', 'credit', 'upi', 'card']).optional(),
  notes: z.string().max(4000).optional(),
  deliveryAddress: z.record(z.string(), z.any()).optional()
});

export const poCancelSchema = z.object({
  reason: z.string().max(1000).optional().nullable()
});

export const poRatingSchema = z.object({
  rating: z.union([z.number(), z.string()]),
  feedback: z.string().max(1000).optional().nullable()
});

