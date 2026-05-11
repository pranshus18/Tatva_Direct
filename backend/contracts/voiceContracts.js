import { z } from 'zod';

const uuidLike = z.string().min(1);

const addressSchema = z.object({
  line1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  pincode: z.string().optional(),
  country: z.string().optional()
});

export const voiceSessionRequestSchema = z.object({
  channel: z.enum(['web']).optional().default('web'),
  pageContext: z
    .object({
      page: z.literal('product_discovery'),
      searchQuery: z.string().optional(),
      selectedCategory: z.string().optional(),
      currentPage: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
      total: z.coerce.number().int().min(0).optional(),
      pageCount: z.coerce.number().int().min(1).optional(),
      recommendationMode: z.string().optional(),
      visibleProducts: z
        .array(
          z.object({
            id: z.union([z.string(), z.number()]).optional(),
            name: z.string().optional(),
            brand: z.string().optional(),
            category: z.string().optional(),
            unit: z.string().optional(),
            supplierCount: z.coerce.number().int().min(0).optional(),
            barcode: z.string().optional(),
            description: z.string().optional()
          })
        )
        .optional(),
      /** Set by Product Discovery after add-to-cart; helps resolve productName when listing scrolls. */
      lastCartAddFromDiscovery: z
        .object({
          productId: z.string().optional(),
          name: z.string().optional(),
          brand: z.string().optional(),
          at: z.coerce.number().optional()
        })
        .optional()
        .nullable()
    })
    .optional()
});

const searchProductsArgsSchema = z.object({
  query: z.string().optional().default(''),
  productName: z.string().optional(),
  name: z.string().optional(),
  term: z.string().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(20).optional().default(6),
  page: z.coerce.number().int().min(1).optional().default(1)
});

const addDiscoveryLineArgsSchema = z.object({
  productId: z.union([uuidLike, z.number()]).optional(),
  id: z.union([uuidLike, z.number()]).optional(),
  productName: z.string().optional(),
  quantity: z.coerce.number().int().min(1).max(10000).optional().default(1)
}).superRefine((value, ctx) => {
  if (!value.productId && !value.id && !value.productName) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide one of productId, id, or productName'
    });
  }
});

const getPoCartArgsSchema = z.object({});

const listSuppliersForCartArgsSchema = z.object({
  topPerItem: z.coerce.number().int().min(1).max(10).optional().default(3)
});

export const supplierSelectionItemSchema = z.object({
  itemId: z.union([z.string(), z.number()]),
  supplierName: z.string().optional(),
  vendorId: z.union([z.string(), z.number()]).optional(),
  optionIndex: z.number().int().min(1).max(10).optional()
}).superRefine((value, ctx) => {
  if (!value.supplierName && !value.vendorId && !value.optionIndex) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide one of supplierName, vendorId, or optionIndex'
    });
  }
});

const setSupplierSelectionsArgsSchema = z.object({
  selections: z.array(supplierSelectionItemSchema).min(1)
});

const updateCartItemQuantityArgsSchema = z.object({
  itemId: z.union([z.string(), z.number()]),
  quantity: z.coerce.number().int().min(1).max(10000)
});

const buildPoPreviewArgsSchema = z.object({});

const placePurchaseOrdersArgsSchema = z.object({
  confirmed: z.boolean(),
  requiredDate: z.string().min(1),
  paymentMethod: z.enum(['cod', 'online', 'bank_transfer', 'credit']).optional().default('cod'),
  deliveryDestination: z.enum(['shipping', 'billing']).optional().default('shipping'),
  shippingAddress: addressSchema,
  billingAddress: addressSchema,
  gstin: z.string().optional().nullable(),
  boqId: z.string().uuid().optional().nullable(),
  clientRequestId: z.string().min(4).max(128).optional()
});

const getCheckoutDefaultsArgsSchema = z.object({});

export const voiceToolArgsByName = {
  search_products: searchProductsArgsSchema,
  add_discovery_line: addDiscoveryLineArgsSchema,
  get_po_cart: getPoCartArgsSchema,
  list_suppliers_for_cart: listSuppliersForCartArgsSchema,
  set_supplier_selections: setSupplierSelectionsArgsSchema,
  update_cart_item_quantity: updateCartItemQuantityArgsSchema,
  build_po_preview: buildPoPreviewArgsSchema,
  place_purchase_orders: placePurchaseOrdersArgsSchema,
  get_checkout_defaults: getCheckoutDefaultsArgsSchema
};

const toolCallSchema = z.object({
  id: z.string().optional(),
  toolCallId: z.string().optional(),
  function: z
    .object({
      name: z.string(),
      arguments: z.union([z.string(), z.record(z.string(), z.any())]).optional()
    })
    .optional(),
  name: z.string().optional(),
  arguments: z.union([z.string(), z.record(z.string(), z.any())]).optional()
});

const vapiMessageSchema = z
  .object({
    type: z.string().optional().default('unknown'),
    call: z
      .object({
        id: z.string().optional(),
        metadata: z.record(z.string(), z.any()).optional()
      })
      .passthrough()
      .optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    toolCallList: z.array(toolCallSchema).optional(),
    toolCalls: z.array(toolCallSchema).optional(),
    toolWithToolCallList: z
      .array(
        z.object({
          toolCallList: z.array(toolCallSchema).optional()
        })
      )
      .optional()
  })
  .passthrough();

export const vapiServerMessageSchema = z
  .object({
    message: vapiMessageSchema.optional(),
    call: z.record(z.string(), z.any()).optional()
  })
  .passthrough();
