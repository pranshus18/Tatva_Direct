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

const addressSchema = z.object({
  line1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  country: z.string().optional(),
  street: z.string().optional(),
  zipCode: z.string().optional(),
  postalCode: z.string().optional(),
  postal_code: z.string().optional()
});

export const poCheckoutReserveSchema = z.object({
  checkoutSessionId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        supplierProductId: z.string().uuid(),
        supplierId: z.string().uuid(),
        quantity: z.union([z.number(), z.string()]),
        productId: z.string().uuid().optional().nullable()
      })
    )
    .min(1)
});

export const poCheckoutReleaseSchema = z.object({
  checkoutSessionId: z.string().uuid().optional().nullable()
});

export const poGroupRequestSchema = z.object({
  selectedVendors: z.record(z.string(), z.union([z.string(), z.number(), z.null(), z.undefined()])),
  substitutions: z.array(
    z.object({
      originalItem: z.union([z.string(), z.number()]).optional(),
      suggestedItem: z.union([z.string(), z.number()]).optional()
    }).passthrough()
  ).optional().default([]),
  items: z.array(poGroupItemSchema).min(1),
  defaultShippingAddress: addressSchema.optional()
});

export const poCreateRequestSchema = z.object({
  checkoutSessionId: z.string().uuid(),
  poGroups: z.array(
    z.object({
      vendorId: z.coerce.string().min(1),
      vendorName: z.string().optional(),
      items: z.array(poGroupItemSchema).min(1),
      total: z.union([z.number(), z.string()]).optional(),
      pickupPincode: z.string().optional(),
      pickupAddressSummary: z.string().optional(),
      pickupOutletId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().optional().nullable()),
      pickupOutletName: z.string().optional().nullable(),
      pickupAddress: z
        .object({
          line1: z.string().optional(),
          city: z.string().optional(),
          state: z.string().optional(),
          country: z.string().optional(),
          pincode: z.string().optional()
        })
        .optional()
        .nullable(),
      transportGroupId: z.string().optional(),
      shippingAddressKey: z.string().optional(),
      shippingAddress: addressSchema.optional()
    })
  ).min(1),
  boqId: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().optional().nullable()),
  requiredDate: z.string().optional().nullable(),
  paymentMethod: z.preprocess(
    (v) => (String(v || '').toLowerCase().trim() === 'wallet' ? 'vault' : v),
    z.enum(['cod', 'online', 'bank_transfer', 'credit', 'vault']).optional()
  ),
  deliveryDestination: z.enum(['shipping', 'billing']).optional(),
  shippingAddress: addressSchema.optional(),
  billingAddress: addressSchema.optional(),
  gstin: z.string().optional().nullable(),
  /** Sum of selected logistics quotes (INR) — included in vault sufficiency check with product totals. */
  quotedTransportTotal: z.union([z.number(), z.string()]).optional().nullable()
});

const perOrderTransportRowSchema = z.object({
  orderId: z.string().uuid(),
  shippingProvider: z.string().min(1).max(120),
  /** Shiprocket / logistics `courier_company_id` from quote — triggers server-side booking. */
  courierCompanyId: z.coerce.number().int().positive().optional().nullable(),
  /** Borzo / trucking `vehicle_type_id` from quote — optional; Borzo can pick from weight_kg. */
  vehicleTypeId: z.coerce.number().int().positive().optional().nullable(),
  transportMode: z.enum(['trucking', 'courier', 'self_ship']).optional().nullable(),
  source: z.string().max(40).optional().nullable(),
  weightKg: z.coerce.number().positive().optional().nullable(),
  pickupLat: z.coerce.number().optional().nullable(),
  pickupLng: z.coerce.number().optional().nullable(),
  deliveryLat: z.coerce.number().optional().nullable(),
  deliveryLng: z.coerce.number().optional().nullable(),
  carrier: z.string().max(80).optional().nullable(),
  matter: z.string().max(500).optional().nullable(),
  trackingNumber: z.string().max(120).optional().nullable(),
  trackingUrl: z.preprocess(
    (v) => (v === '' || v === undefined ? null : v),
    z.string().url().optional().nullable()
  ),
  transportNotes: z.string().max(1000).optional().nullable(),
  /** Quoted courier charge (INR) from logistics — stored on the order for receipts/invoices. */
  quotedTransportAmount: z.union([z.number(), z.string()]).optional().nullable(),
  /** From quote provider — used with schedule-courier when order has expected_delivery_date. */
  transitDays: z.coerce.number().int().nonnegative().optional().nullable(),
  transportGroupId: z.string().max(240).optional().nullable(),
  pickupPincode: z.string().max(6).optional().nullable(),
  etd: z.string().max(120).optional().nullable()
});

export const poTransportConfirmSchema = z
  .object({
    orderIds: z.array(z.string().uuid()).min(1),
    shippingProvider: z.string().min(1).max(120).optional(),
    /** When confirming a single order without perOrderTransport — passed to logistics booking. */
    courierCompanyId: z.coerce.number().int().positive().optional().nullable(),
    vehicleTypeId: z.coerce.number().int().positive().optional().nullable(),
    transportMode: z.enum(['trucking', 'courier', 'self_ship']).optional().nullable(),
    source: z.string().max(40).optional().nullable(),
    weightKg: z.coerce.number().positive().optional().nullable(),
    pickupLat: z.coerce.number().optional().nullable(),
    pickupLng: z.coerce.number().optional().nullable(),
    deliveryLat: z.coerce.number().optional().nullable(),
    deliveryLng: z.coerce.number().optional().nullable(),
    carrier: z.string().max(80).optional().nullable(),
    matter: z.string().max(500).optional().nullable(),
    trackingNumber: z.string().max(120).optional().nullable(),
    trackingUrl: z.preprocess(
      (v) => (v === '' || v === undefined ? null : v),
      z.string().url().optional().nullable()
    ),
    transportNotes: z.string().max(1000).optional().nullable(),
    transitDays: z.coerce.number().int().nonnegative().optional().nullable(),
    transportGroupId: z.string().max(240).optional().nullable(),
    pickupPincode: z.string().max(6).optional().nullable(),
    etd: z.string().max(120).optional().nullable(),
    perOrderTransport: z.array(perOrderTransportRowSchema).optional(),
    /** When not using perOrderTransport and exactly one order — same as per-row quoted amount. */
    quotedTransportAmount: z.union([z.number(), z.string()]).optional().nullable()
  })
  .superRefine((data, ctx) => {
    const rows = data.perOrderTransport || [];
    const hasPer = rows.length > 0;
    const hasGlobal = String(data.shippingProvider || '').trim().length > 0;
    if (!hasPer && !hasGlobal) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide shippingProvider for all orders, or perOrderTransport with one entry per orderId.',
        path: ['shippingProvider']
      });
      return;
    }
    if (!hasPer) return;
    const idSet = new Set(data.orderIds);
    for (const row of rows) {
      if (!idSet.has(row.orderId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `perOrderTransport orderId ${row.orderId} is not in orderIds`,
          path: ['perOrderTransport']
        });
      }
    }
    for (const oid of data.orderIds) {
      if (!rows.some((r) => r.orderId === oid)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing perOrderTransport entry for order ${oid}`,
          path: ['perOrderTransport']
        });
      }
    }
    for (const row of rows) {
      const mode = String(row.transportMode || '').toLowerCase();
      if (mode === 'courier' && row.courierCompanyId == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Order ${row.orderId}: transportMode courier requires courierCompanyId`,
          path: ['perOrderTransport']
        });
      }
      if (mode === 'trucking') {
        const coords = [row.pickupLat, row.pickupLng, row.deliveryLat, row.deliveryLng];
        if (coords.some((v) => v == null || !Number.isFinite(Number(v)))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Order ${row.orderId}: transportMode trucking requires pickup and delivery coordinates`,
            path: ['perOrderTransport']
          });
        }
      }
      if (mode === 'self_ship') {
        // Self ship intentionally does not require courier/trucking identifiers.
        continue;
      }
    }
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
    paymentMethod: z.preprocess(
      (v) => (String(v || '').toLowerCase().trim() === 'wallet' ? 'vault' : v),
      z.enum(['cod', 'online', 'bank_transfer', 'credit', 'vault']).optional().nullable()
    ),
    deliveryDestination: z.enum(['shipping', 'billing']).optional().nullable(),
    shippingAddress: addressSchema.optional(),
    billingAddress: addressSchema.optional(),
    gstin: z.string().optional().nullable(),
    /** Voice / Create PO — persisted so Transport suggestion page can load quotes. */
    poGroups: z.array(z.record(z.string(), z.any())).optional().default([]),
    grandTotalAllPos: z.union([z.number(), z.string()]).optional().nullable(),
    transportSelection: z.record(z.string(), z.any()).optional().nullable()
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

export const poCartTransportPatchSchema = z.object({
  transportSelection: z.record(z.string(), z.any()).nullable().optional(),
  transportVendorIds: z.array(z.string()).optional(),
  clear: z.boolean().optional()
});

export const poSelfServePatchSchema = z.object({
  expectedDeliveryDate: z.string().optional().nullable(),
  paymentMethod: z.preprocess(
    (v) => (String(v || '').toLowerCase().trim() === 'wallet' ? 'vault' : v),
    z.enum(['cash', 'bank_transfer', 'online', 'credit', 'upi', 'card', 'vault']).optional()
  ),
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

