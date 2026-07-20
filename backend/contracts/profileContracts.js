import { z } from 'zod';

export const profileUpdateSchema = z.object({
  companyName: z.string().optional(),
  contactPerson: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  description: z.string().optional(),
  userType: z.enum(['service_provider', 'supplier', 'admin']).optional(),
  address: z.record(z.string(), z.any()).optional(),
  shippingAddresses: z.array(z.record(z.string(), z.any())).optional(),
  projects: z.array(z.record(z.string(), z.any())).optional(),
  businessType: z.string().optional(),
  categories: z.array(z.string()).optional(),
  gstin: z.string().optional(),
  mainGstin: z.string().optional(),
  ownershipDetails: z.any().optional(),
  skus: z.any().optional(),
  skuList: z.any().optional(),
  authorizationCertificateUrl: z.string().optional(),
  branches: z.array(z.record(z.string(), z.any())).optional(),
  supplierRole: z.string().optional(),
  brands: z.any().optional(),
  companyInfoEntries: z.array(z.record(z.string(), z.any())).optional(),
  saveAsDraft: z.boolean().optional(),
  saveBrandApprovalOnly: z.boolean().optional(),
  saveSupplyChainEntryId: z.string().optional(),
  pmCustomerAccount: z
    .object({
      fullName: z.string().optional(),
      userName: z.string().optional(),
      email: z.string().email().optional(),
      phoneNumber: z.string().optional()
    })
    .optional()
});

const profileShippingAddressFieldsSchema = z.object({
  label: z.string().max(120).optional().nullable(),
  line1: z.string().min(1),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(1),
  country: z.string().min(1),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  geoLocation: z
    .object({
      lat: z.number(),
      lng: z.number()
    })
    .optional()
    .nullable()
});

export const profileShippingAddressCreateSchema = profileShippingAddressFieldsSchema;

export const profileUploadCertificateBodySchema = z.object({
  entryId: z.string().optional(),
  url: z.string().optional(),
  documentType: z.enum(['brand_approval', 'role_authorization']).optional()
});

