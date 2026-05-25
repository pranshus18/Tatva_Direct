import { z } from 'zod';

export const supplierBcovLevelsUpsertSchema = z.object({
  variantKey: z.string().min(1),
  variantAsin: z.string().optional(),
  variantName: z.string().optional(),
  levels: z.array(z.record(z.string(), z.any()))
});

export const supplierBcovResolvePriceSchema = z.object({
  variantKey: z.string().min(1),
  variantAsin: z.string().optional(),
  supplierCov: z.union([z.number(), z.string()]).optional(),
  platformCov: z.union([z.number(), z.string()]).optional(),
  brandCov: z.union([z.number(), z.string()]).optional()
});

export const supplierUpstreamOrdersSchema = z.object({
  lines: z
    .array(
      z.object({
        mineSupplierProductId: z.string().uuid(),
        upstreamSupplierProductId: z.string().uuid(),
        quantity: z.union([z.number(), z.string()])
      })
    )
    .min(1)
});

export const supplierUpstreamCartSaveSchema = z.object({
  selectedMine: z.record(z.string(), z.union([z.number(), z.string()])),
  selectedUpstreamOffer: z.record(z.string(), z.union([z.string(), z.number()])),
  suggestions: z.array(z.record(z.string(), z.any())).optional().default([]),
  brandFilter: z.string().optional().default(''),
  searchTerm: z.string().optional().default('')
});

export const supplierInventoryAdjustSchema = z.object({
  supplier_product_id: z.string().uuid(),
  product_id: z.string().uuid(),
  quantity_change: z.union([z.number(), z.string()]),
  reason: z.string().optional()
});

export const supplierReturnStatusPatchSchema = z.object({
  status: z.enum(['approved', 'rejected', 'picked_up', 'received', 'refunded', 'replaced', 'closed']),
  supplierNotes: z.string().optional()
});

export const supplierOrderStatusPatchSchema = z.object({
  status: z.string().min(1),
  notes: z.string().optional(),
  shippingProvider: z.string().optional(),
  trackingNumber: z.string().optional(),
  trackingUrl: z.string().optional()
});

export const supplierNotificationReadSchema = z.object({});

export const supplierOutletCreateSchema = z.object({
  name: z.string().min(1),
  type: z.string().optional(),
  code: z.string().optional(),
  address: z.record(z.string(), z.any()).optional(),
  geo_location: z.object({ lat: z.number(), lng: z.number() }).optional().nullable(),
  phone: z.string().optional(),
  email: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional()
});

export const supplierOutletUpdateSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  code: z.string().optional(),
  address: z.record(z.string(), z.any()).optional(),
  geo_location: z.object({ lat: z.number(), lng: z.number() }).optional().nullable(),
  phone: z.string().optional(),
  email: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  is_active: z.boolean().optional()
});

export const supplierCategoryCreateSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().optional()
});

export const supplierUnitCreateSchema = z.object({
  name: z.string().min(1),
  displayName: z.string().optional()
});

export const supplierProductCreateSchema = z.object({}).passthrough();
export const supplierProductUpdateSchema = z.object({}).passthrough();

export const supplierProductAiEnhanceSchema = z.object({
  category: z.string().min(1),
  familyId: z.string().uuid().optional().nullable(),
  specifications: z.record(z.string(), z.any()).optional(),
  provider: z.string().optional(),
  name: z.string().optional(),
  brand: z.string().optional(),
  gtin: z.string().optional(),
  mpn: z.string().optional()
});

export const supplierProductExtractSpecificationsSchema = z.object({
  category: z.string().min(1),
  familyId: z.string().uuid().optional().nullable(),
  description: z.string().optional(),
  productName: z.string().optional(),
  provider: z.string().optional(),
  existingSpecifications: z.record(z.string(), z.any()).optional()
});

export const supplierProductAnalyzeImageSchema = z.object({
  images: z.array(z.any()).optional(),
  imageBase64: z.string().optional(),
  imageUrl: z.string().optional(),
  provider: z.string().optional()
});

export const supplierOutletRepairGeoSchema = z.object({});
export const supplierOutletDeleteSchema = z.object({});
export const supplierProductDeleteSchema = z.object({});

