import { z } from 'zod';

const rankingItemSchema = z.object({
  id: z.union([z.string(), z.number()]),
  normalizedName: z.string().optional(),
  rawName: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  itemName: z.string().optional(),
  productId: z.string().uuid().optional().nullable(),
  brand: z.string().optional(),
  brandName: z.string().optional(),
  brandModel: z.string().optional(),
  specifications: z.record(z.string(), z.any()).optional(),
  availableSuppliers: z.any().optional()
});

export const vendorRankSchema = z.object({
  items: z.array(rankingItemSchema).min(1),
  boqId: z.string().uuid().optional().nullable(),
  _timestamp: z.any().optional(),
  _random: z.any().optional()
});

export const substitutionSuggestSchema = z.object({
  selectedVendors: z.record(z.string(), z.string()).optional(),
  items: z.array(rankingItemSchema).min(1)
});

