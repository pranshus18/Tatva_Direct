import { z } from 'zod';

export const boqNormalizeBodySchema = z.object({
  siteLocation: z.string().optional(),
  site_location: z.string().optional(),
  requiredDate: z.string().optional(),
  required_date: z.string().optional(),
  siteLatitude: z.union([z.string(), z.number()]).optional(),
  site_lat: z.union([z.string(), z.number()]).optional(),
  siteLongitude: z.union([z.string(), z.number()]).optional(),
  site_lng: z.union([z.string(), z.number()]).optional()
});

export const boqRequestProductSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  unit: z.string().min(1),
  description: z.string().optional(),
  brand: z.string().optional(),
  boqId: z.string().uuid().optional().nullable(),
  boqItemId: z.union([z.string(), z.number()]).optional().nullable()
});

export const boqDeleteSchema = z.object({});

