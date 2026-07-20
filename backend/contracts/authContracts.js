import { z } from 'zod';

export const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  userType: z.enum(['supplier', 'service_provider']),
  company: z.string().optional(),
  phone: z.string().optional()
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const updatePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6)
});

export const logoutSchema = z.object({});

export const pmOtpLoginSchema = z.object({
  phoneNumber: z.string().min(10),
  pmProfile: z
    .object({
      pmUserId: z.string().optional(),
      fullName: z.string().optional(),
      name: z.string().optional(),
      userName: z.string().optional(),
      email: z.string().optional(),
      phoneNumber: z.string().optional(),
      status: z.string().optional(),
      isEmailVerified: z.boolean().optional(),
      isVendor: z.boolean().optional(),
      flag: z.string().optional(),
      role: z.string().optional()
    })
    .optional(),
  pmAccessToken: z.string().optional(),
  pmRefreshToken: z.string().optional()
});

export const pmSignupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  userType: z.enum(['supplier', 'service_provider']),
  company: z.string().optional(),
  phoneNumber: z.string().min(10),
  pmAccessToken: z.string().optional(),
  pmRefreshToken: z.string().optional(),
  pmProfile: pmOtpLoginSchema.shape.pmProfile
});

export const switchPortalSchema = z.object({
  portal: z.enum(['supplier', 'service_provider'])
});

export const vendorLeadRegistrationSchema = z.object({
  phoneNumber: z.string().min(10),
  email: z.string().email(),
  gstNo: z.string().min(15).max(15),
  companyName: z.string().min(1),
  legalName: z.string().optional(),
  companyType: z.string().min(1),
  designation: z.string().min(1),
  bankName: z.string().min(1),
  accountNumber: z.string().min(1),
  ifscCode: z.string().min(1),
  businessAddress: z.string().min(1),
  additionalGstNumbers: z.array(z.string()).optional(),
  panNo: z.string().optional(),
  accountHolderName: z.string().optional(),
  accountType: z.string().optional(),
  branch: z.string().optional()
});

export const completeSupplierRegistrationSchema = vendorLeadRegistrationSchema.extend({
  pmVendorLead: z.record(z.string(), z.any()).optional().nullable()
});

