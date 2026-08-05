import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import multer from 'multer';
import { supabase } from '../config/supabase.js';
import logger from '../utils/logger.js';
import {
  loginSchema,
  logoutSchema,
  pmOtpLoginSchema,
  pmSignupSchema,
  switchPortalSchema,
  completeSupplierRegistrationSchema,
  vendorLeadRegistrationSchema,
  updatePasswordSchema
} from '../contracts/authContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import {
  getEffectiveRegisteredRoles,
  getRegisteredRoles,
  hasEffectiveRegisteredRole,
  hasRegisteredRole,
  isSupplierRegistrationComplete,
  mergeRegisteredRoles,
  normalizePortalRole
} from '../utils/portalRoles.js';
import { submitPmVendorLeadForSupplierUpgrade } from '../services/pmVendorLeadService.js';
import {
  getPmAuthFromUser,
  persistPmAuthAndSyncCustomerProfile,
  syncPmCustomerProfileForUser
} from '../services/pmUserService.js';
import {
  PM_PLATFORM_FLAG,
  PM_SEND_OTP_URL,
  PM_VERIFY_GST_URL,
  PM_VERIFY_OTP_URL,
  buildPmPlatformHeaders,
  withPmPlatformFlagBody,
  withPmPlatformFlagQuery
} from '../config/pmApi.js';

const router = express.Router();
const vendorLeadUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});
const console = {
  log: (...args) => logger.debug(...args),
  warn: (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args)
};

// JWT utility functions
const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user.id);
  const registeredRoles = getEffectiveRegisteredRoles(user);
  const pmAuth = getPmAuthFromUser(user);

  const payload = {
    status: 'success',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      userType: user.user_type,
      company: user.company,
      phone: user.phone,
      isActive: user.is_active,
      emailVerified: user.email_verified,
      lastLogin: user.last_login,
      createdAt: user.created_at,
      profileIncomplete: user.profile?.profileIncomplete === true,
      supplierProfileIncomplete: user.profile?.supplierProfileIncomplete === true,
      registeredRoles,
      activePortal: user.user_type,
      supplierRegistered: isSupplierRegistrationComplete(user),
      serviceProviderRegistered: hasRegisteredRole(user, 'service_provider')
    }
  };

  if (pmAuth?.accessToken) {
    payload.pmVault = {
      pmUserId: pmAuth.pmUserId || null,
      accessToken: pmAuth.accessToken,
      refreshToken: pmAuth.refreshToken || null
    };
  }

  res.status(statusCode).json(payload);
};

// Helper function to hash password
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(12);
  return await bcrypt.hash(password, salt);
};

// Helper function to compare password
const comparePassword = async (candidatePassword, hashedPassword) => {
  return await bcrypt.compare(candidatePassword, hashedPassword);
};

function normalizeIndianMobile(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

async function findUserByPhone(phoneNumber) {
  const normalizedPhone = normalizeIndianMobile(phoneNumber);
  if (!normalizedPhone || normalizedPhone.length !== 10) return null;

  const phoneVariants = [
    normalizedPhone,
    `+91${normalizedPhone}`,
    `91${normalizedPhone}`
  ];

  for (const variant of phoneVariants) {
    const { data: user } = await supabase
      .from('users')
      .select('*')
      .eq('phone', variant)
      .maybeSingle();
    if (user) return user;
  }

  const { data: candidates } = await supabase
    .from('users')
    .select('*')
    .not('phone', 'is', null)
    .ilike('phone', `%${normalizedPhone}%`)
    .limit(20);

  return (
    (candidates || []).find(
      (user) => normalizeIndianMobile(user.phone) === normalizedPhone
    ) || null
  );
}

function buildPmPlaceholderEmail(normalizedPhone) {
  return `pm+${normalizedPhone}@phone.tatvadirect.local`;
}

function isPmPlaceholderEmail(email) {
  return /@phone\.tatvadirect\.local$/i.test(String(email || '').trim());
}

async function syncPmCustomerOnLogin(user, pmProfile, phoneNumber, pmAccessToken = null, pmRefreshToken = null) {
  return persistPmAuthAndSyncCustomerProfile(user, {
    pmProfile,
    pmAccessToken,
    pmRefreshToken,
    phoneNumber
  });
}

async function syncPmPortalFlagForUser(user) {
  if (!normalizeIndianMobile(user?.phone)) return user;
  try {
    return await syncPmCustomerProfileForUser(user, { pushPortalFlagAlways: true });
  } catch (error) {
    console.warn('[PM] portal flag sync failed:', error?.message || error);
    return user;
  }
}

async function createPmServiceProviderUser(normalizedPhone) {
  const hashedPassword = await hashPassword(crypto.randomBytes(32).toString('hex'));

  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      name: 'User',
      email: buildPmPlaceholderEmail(normalizedPhone),
      password: hashedPassword,
      user_type: 'service_provider',
      company: '',
      phone: normalizedPhone,
      address: buildSignupAddress('service_provider', ''),
      profile: {
        profileIncomplete: true,
        registeredRoles: ['service_provider']
      },
      is_active: true,
      email_verified: false
    })
    .select()
    .single();

  if (error) {
    throw error;
  }

  return newUser;
}

async function ensureServiceProviderPortalOnLogin(user, pmProfile = null, options = {}) {
  const { forceActivePortal = false } = options;
  const mergedRoles = mergeRegisteredRoles(user, ['service_provider']);
  const nextProfile = {
    ...(user.profile || {}),
    registeredRoles: mergedRoles
  };

  const updates = {
    profile: nextProfile
  };

  const pmName = String(pmProfile?.fullName || pmProfile?.name || '').trim();
  if (pmName && (!String(user.name || '').trim() || user.name === 'User')) {
    updates.name = pmName;
  }

  const hadServiceProvider = hasRegisteredRole(user, 'service_provider');
  if (forceActivePortal) {
    updates.user_type = 'service_provider';
  } else if (!hadServiceProvider) {
    updates.user_type = 'service_provider';
  }

  const rolesChanged =
    JSON.stringify([...getRegisteredRoles(user)].sort()) !==
    JSON.stringify([...mergedRoles].sort());
  const portalChanged = updates.user_type && updates.user_type !== user.user_type;
  const nameChanged = Boolean(updates.name && updates.name !== user.name);

  if (!rolesChanged && !portalChanged && !nameChanged) {
    return user;
  }

  const { data: updatedUser, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', user.id)
    .select()
    .single();

  if (error || !updatedUser) {
    console.error('ensureServiceProviderPortalOnLogin error:', error);
    return user;
  }

  return updatedUser;
}

async function cleanupIncompleteSupplierRole(user) {
  if (!hasRegisteredRole(user, 'supplier') || isSupplierRegistrationComplete(user)) {
    return user;
  }

  const nextRoles = getRegisteredRoles(user).filter((role) => role !== 'supplier');
  const nextProfile = {
    ...(user.profile || {}),
    registeredRoles: nextRoles.length > 0 ? nextRoles : ['service_provider']
  };

  const { data: updatedUser, error } = await supabase
    .from('users')
    .update({ profile: nextProfile })
    .eq('id', user.id)
    .select()
    .single();

  if (error || !updatedUser) {
    console.error('cleanupIncompleteSupplierRole error:', error);
    return user;
  }

  return updatedUser;
}

function buildSupplierProfileFromRegistration(user, registration, pmResponse = null) {
  const currentProfile = user.profile || {};
  const businessAddress = String(registration.businessAddress || '').trim();

  const branch = {
    id: crypto.randomUUID(),
    name: 'Main Branch',
    address: businessAddress,
    city: '',
    state: '',
    zipCode: '',
    pincode: '',
    country: 'India'
  };

  return {
    ...currentProfile,
    registeredRoles: mergeRegisteredRoles(user, ['service_provider', 'supplier']),
    supplierProfileIncomplete: false,
    supplierRegisteredAt: new Date().toISOString(),
    gstin: registration.gstNo,
    businessType: registration.companyType,
    designation: registration.designation,
    additionalGstNumbers: registration.additionalGstNumbers || [],
    bankDetails: {
      bankName: registration.bankName,
      accountNumber: registration.accountNumber,
      ifscCode: registration.ifscCode,
      accountHolderName: registration.accountHolderName || '',
      accountType: registration.accountType || '',
      branch: registration.branch || ''
    },
    panNo: registration.panNo || '',
    pmVendorLead: pmResponse?.data || pmResponse || null,
    branches: [branch]
  };
}

async function switchUserPortal(userId, portal) {
  const normalizedPortal = normalizePortalRole(portal);
  const { data: user, error: fetchError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (fetchError || !user) {
    return { error: { status: 404, message: 'User not found' } };
  }

  if (!hasEffectiveRegisteredRole(user, normalizedPortal)) {
    return {
      error: {
        status: 403,
        message:
          normalizedPortal === 'supplier'
            ? 'Complete supplier registration before opening the supplier portal.'
            : 'Service provider access is not enabled for this account.'
      }
    };
  }

  const { data: updatedUser, error: updateError } = await supabase
    .from('users')
    .update({ user_type: normalizedPortal })
    .eq('id', userId)
    .select()
    .single();

  if (updateError || !updatedUser) {
    return { error: { status: 500, message: 'Could not switch portal' } };
  }

  return { user: updatedUser };
}

async function finalizeSupplierRegistration(user, registration, pmResponse, res) {
  const normalizedEmail = registration.email;
  const verifiedPhone = normalizeIndianMobile(user.phone);
  const submittedPhone = normalizeIndianMobile(registration.phoneNumber);

  if (!verifiedPhone || verifiedPhone.length !== 10) {
    return res.status(400).json({
      status: 'error',
      message: 'Your Service Provider account must have a verified phone number before supplier registration.'
    });
  }

  if (submittedPhone && submittedPhone !== verifiedPhone) {
    return res.status(400).json({
      status: 'error',
      message: 'Supplier registration must use the same phone number as your Service Provider account.'
    });
  }

  registration.phoneNumber = verifiedPhone;

  if (isPmPlaceholderEmail(normalizedEmail)) {
    return res.status(400).json({
      status: 'error',
      message: 'Enter a valid business email address for supplier registration.'
    });
  }

  const { data: existingEmailUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', normalizedEmail)
    .maybeSingle();

  if (existingEmailUser && existingEmailUser.id !== user.id) {
    return res.status(400).json({
      status: 'error',
      message: 'This email is already registered to another account.'
    });
  }

  const nextProfile = buildSupplierProfileFromRegistration(user, registration, pmResponse);
  const nextAddress = {
    line1: registration.businessAddress.slice(0, 500),
    city: 'Pending',
    state: 'Pending',
    pincode: '000000',
    country: 'India'
  };

  const { data: updatedUser, error: updateError } = await supabase
    .from('users')
    .update({
      name: user.name || registration.companyName,
      email: normalizedEmail,
      company: registration.companyName,
      phone: registration.phoneNumber,
      user_type: 'supplier',
      profile: nextProfile,
      address: nextAddress
    })
    .eq('id', user.id)
    .select()
    .single();

  if (updateError || !updatedUser) {
    console.error('Register supplier error:', updateError);
    return res.status(400).json({
      status: 'error',
      message: updateError?.message || 'Could not register supplier portal access'
    });
  }

  const syncedUser = await syncPmPortalFlagForUser(updatedUser);
  return createSendToken(syncedUser, 200, res);
}

function buildSignupAddress(userType, companyName = '') {
  if (!['supplier', 'service_provider'].includes(String(userType || '').trim().toLowerCase())) {
    return null;
  }
  const fallbackLine1 = String(companyName || '').trim() || 'Address pending';
  // Signup does not collect full address fields yet; keep placeholder values
  // so DB check constraint passes and user can complete real address in profile.
  return {
    line1: fallbackLine1,
    city: 'Pending',
    state: 'Pending',
    pincode: '000000',
    country: 'India'
  };
}

// Register new user (signup) — disabled; use phone OTP + pm-signup instead
router.post('/signup', async (_req, res) => {
  return res.status(403).json({
    status: 'error',
    code: 'PASSWORD_SIGNUP_DISABLED',
    message:
      'Email/password registration is disabled. Service providers and suppliers must sign in with phone OTP.'
  });
});

/**
 * Proxy PM send-otp through Tatva to avoid browser CORS against devopsapi.withtatva.ai.
 * Frontend should call POST /api/auth/pm-send-otp (not PM directly).
 */
router.post('/pm-send-otp', async (req, res) => {
  try {
    const normalizedPhone = normalizeIndianMobile(req.body?.phoneNumber);
    if (!normalizedPhone || normalizedPhone.length !== 10) {
      return res.status(400).json({
        status: 'error',
        message: 'Enter a valid 10-digit phone number'
      });
    }

    const url = withPmPlatformFlagQuery(PM_SEND_OTP_URL);
    const response = await fetch(url, {
      method: 'POST',
      headers: buildPmPlatformHeaders({ json: true }),
      body: JSON.stringify(
        withPmPlatformFlagBody({
          phoneNumber: normalizedPhone
        })
      )
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok || data.success === false) {
      return res.status(response.status >= 400 ? response.status : 502).json({
        status: 'error',
        success: false,
        message: data.message || 'Failed to send OTP'
      });
    }

    return res.json({
      status: 'success',
      success: true,
      phoneNumber: normalizedPhone,
      ...data
    });
  } catch (error) {
    console.error('PM send-otp proxy error:', error);
    return res.status(502).json({
      status: 'error',
      success: false,
      message:
        error?.cause?.code === 'ENOTFOUND'
          ? 'Could not reach PM auth service. Check network/DNS.'
          : error.message || 'Failed to send OTP'
    });
  }
});

/**
 * Proxy PM verify-otp through Tatva to avoid browser CORS.
 * Frontend should call POST /api/auth/pm-verify-otp (not PM directly).
 */
router.post('/pm-verify-otp', async (req, res) => {
  try {
    const normalizedPhone = normalizeIndianMobile(req.body?.phoneNumber);
    const normalizedOtp = String(req.body?.otp || '').replace(/\D/g, '');

    if (!normalizedPhone || normalizedPhone.length !== 10) {
      return res.status(400).json({
        status: 'error',
        message: 'Enter a valid 10-digit phone number'
      });
    }
    if (!normalizedOtp || normalizedOtp.length < 4) {
      return res.status(400).json({
        status: 'error',
        message: 'Enter the OTP sent to your phone'
      });
    }

    const url = withPmPlatformFlagQuery(PM_VERIFY_OTP_URL);
    const response = await fetch(url, {
      method: 'POST',
      headers: buildPmPlatformHeaders({ json: true }),
      body: JSON.stringify(
        withPmPlatformFlagBody({
          phoneNumber: normalizedPhone,
          otp: normalizedOtp
        })
      )
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok || data.success === false) {
      return res.status(response.status >= 400 ? response.status : 502).json({
        status: 'error',
        success: false,
        message: data.message || 'Invalid or expired OTP'
      });
    }

    return res.json({
      status: 'success',
      success: true,
      phoneNumber: normalizedPhone,
      ...data
    });
  } catch (error) {
    console.error('PM verify-otp proxy error:', error);
    return res.status(502).json({
      status: 'error',
      success: false,
      message:
        error?.cause?.code === 'ENOTFOUND'
          ? 'Could not reach PM auth service. Check network/DNS.'
          : error.message || 'Failed to verify OTP'
    });
  }
});

/**
 * Proxy PM verify-gst through Tatva to avoid browser CORS against devopsapi.withtatva.ai.
 * Frontend should call POST /api/auth/pm-verify-gst (not PM directly).
 */
router.post('/pm-verify-gst', async (req, res) => {
  try {
    const normalizedGst = String(req.body?.gstNo || '')
      .trim()
      .toUpperCase()
      .replace(/\s/g, '');

    if (!normalizedGst || normalizedGst.length !== 15) {
      return res.status(400).json({
        status: 'error',
        success: false,
        message: 'Enter a valid 15-character GST number'
      });
    }

    const url = withPmPlatformFlagQuery(PM_VERIFY_GST_URL);
    const response = await fetch(url, {
      method: 'POST',
      headers: buildPmPlatformHeaders({ json: true }),
      body: JSON.stringify(
        withPmPlatformFlagBody({
          gstNo: normalizedGst
        })
      )
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok || data.success === false) {
      return res.status(response.status >= 400 ? response.status : 502).json({
        status: 'error',
        success: false,
        message: data.message || 'GST verification failed'
      });
    }

    return res.json({
      status: 'success',
      success: true,
      ...data
    });
  } catch (error) {
    console.error('PM verify-gst proxy error:', error);
    return res.status(502).json({
      status: 'error',
      success: false,
      message:
        error?.cause?.code === 'ENOTFOUND'
          ? 'Could not reach PM auth service. Check network/DNS.'
          : error.message || 'GST verification failed'
    });
  }
});

// PM OTP login — phone verified on PM platform; issue Tatva session if user exists
router.post('/pm-otp-login', async (req, res) => {
  try {
    const payload = parseWithSchema(pmOtpLoginSchema, req.body || {});
    const normalizedPhone = normalizeIndianMobile(payload.phoneNumber);

    if (!normalizedPhone || normalizedPhone.length !== 10) {
      return res.status(400).json({
        status: 'error',
        message: 'Enter a valid 10-digit phone number'
      });
    }

    let user = await findUserByPhone(normalizedPhone);
    let isNewUser = false;

    if (!user) {
      try {
        user = await createPmServiceProviderUser(normalizedPhone);
        isNewUser = true;
      } catch (createError) {
        console.error('PM auto-provision error:', createError);
        user = await findUserByPhone(normalizedPhone);
        if (!user) {
          return res.status(500).json({
            status: 'error',
            message: 'Could not create your account. Please try again.'
          });
        }
      }
    }

    user = await ensureServiceProviderPortalOnLogin(user, payload.pmProfile || null, {
      forceActivePortal: true
    });

    user = await cleanupIncompleteSupplierRole(user);

    user = await syncPmCustomerOnLogin(
      user,
      payload.pmProfile || null,
      normalizedPhone,
      payload.pmAccessToken || null,
      payload.pmRefreshToken || null
    );

    if (!user.is_active) {
      return res.status(401).json({
        status: 'error',
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    createSendToken(user, isNewUser ? 201 : 200, res);
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('PM OTP login error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error completing phone sign-in'
    });
  }
});

// PM OTP signup — create Tatva account after PM phone verification (no password)
router.post('/pm-signup', async (req, res) => {
  try {
    const payload = parseWithSchema(pmSignupSchema, req.body || {});
    const {
      name,
      email,
      userType,
      company,
      phoneNumber
    } = payload;

    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedName = String(name || '').trim();
    const normalizedUserType = String(userType || '').trim().toLowerCase();
    const normalizedPhone = normalizeIndianMobile(phoneNumber);

    if (normalizedUserType !== 'service_provider') {
      return res.status(400).json({
        status: 'error',
        message:
          'New accounts must start as a service provider. Register as a supplier from your profile after sign-in.'
      });
    }

    if (!normalizedPhone || normalizedPhone.length !== 10) {
      return res.status(400).json({
        status: 'error',
        message: 'Enter a valid 10-digit phone number'
      });
    }

    const { data: existingEmailUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingEmailUser) {
      return res.status(400).json({
        status: 'error',
        message: 'User with this email already exists'
      });
    }

    const existingPhoneUser = await findUserByPhone(normalizedPhone);
    if (existingPhoneUser) {
      return res.status(400).json({
        status: 'error',
        message: 'This phone number is already registered. Please sign in with OTP.'
      });
    }

    const hashedPassword = await hashPassword(crypto.randomBytes(32).toString('hex'));

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        name: normalizedName,
        email: normalizedEmail,
        password: hashedPassword,
        user_type: normalizedUserType,
        company,
        phone: normalizedPhone,
        address: buildSignupAddress(normalizedUserType, company),
        profile: { registeredRoles: [normalizedUserType] },
        is_active: true,
        email_verified: false
      })
      .select()
      .single();

    if (error) {
      console.error('PM signup error:', error);
      const isProduction = process.env.NODE_ENV === 'production';
      return res.status(400).json({
        status: 'error',
        message: isProduction ? 'Error creating user account' : (error.message || 'Error creating user account'),
        ...(isProduction ? {} : { error: error.code || 'UNKNOWN_ERROR' })
      });
    }

    let user = newUser;
    if (payload.pmAccessToken || payload.pmRefreshToken || payload.pmProfile) {
      user = await syncPmCustomerOnLogin(
        newUser,
        payload.pmProfile || null,
        normalizedPhone,
        payload.pmAccessToken || null,
        payload.pmRefreshToken || null
      );
    }

    createSendToken(user, 201, res);
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('PM signup error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error creating user account'
    });
  }
});

// Restore PM vault session tokens for the logged-in service provider (same device).
router.get('/pm-vault-session', authenticateToken, async (req, res) => {
  try {
    const pmAuth = getPmAuthFromUser(req.user);
    if (!pmAuth?.accessToken) {
      return res.status(404).json({
        status: 'error',
        code: 'PM_AUTH_REQUIRED',
        message:
          'Vault session not linked. Sign out and sign in again with phone OTP to view your shared vault.'
      });
    }

    return res.json({
      status: 'success',
      pmVault: {
        pmUserId: pmAuth.pmUserId || null,
        accessToken: pmAuth.accessToken,
        refreshToken: pmAuth.refreshToken || null
      }
    });
  } catch (error) {
    console.error('PM vault session error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Could not restore vault session'
    });
  }
});

// Portal status for the logged-in user
router.get('/portal-status', authenticateToken, async (req, res) => {
  try {
    let { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    if (!hasRegisteredRole(user, 'service_provider') && normalizeIndianMobile(user.phone)) {
      user = await ensureServiceProviderPortalOnLogin(user);
    }

    user = await cleanupIncompleteSupplierRole(user);

    if (hasRegisteredRole(user, 'service_provider') && normalizeIndianMobile(user.phone)) {
      user = await syncPmCustomerProfileForUser(user);
    }

    const registeredRoles = getEffectiveRegisteredRoles(user);
    return res.status(200).json({
      status: 'success',
      activePortal: user.user_type,
      registeredRoles,
      supplierRegistered: isSupplierRegistrationComplete(user),
      serviceProviderRegistered: hasRegisteredRole(user, 'service_provider'),
      needsSupplierRegistration:
        hasRegisteredRole(user, 'service_provider') && !isSupplierRegistrationComplete(user)
    });
  } catch (error) {
    console.error('Portal status error:', error);
    return res.status(500).json({ status: 'error', message: 'Could not load portal status' });
  }
});

// Service provider registers (or switches) to supplier portal
router.post(
  '/register-supplier',
  authenticateToken,
  vendorLeadUpload.fields([
    { name: 'gstCertificate', maxCount: 1 },
    { name: 'panCardFile', maxCount: 1 },
    { name: 'cancelledChequeFile', maxCount: 1 }
  ]),
  async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    if (!hasRegisteredRole(user, 'service_provider')) {
      return res.status(403).json({
        status: 'error',
        message: 'Only service provider accounts can register as a supplier.'
      });
    }

    if (hasRegisteredRole(user, 'supplier') && isSupplierRegistrationComplete(user)) {
      const switched = await switchUserPortal(req.userId, 'supplier');
      if (switched.error) {
        return res.status(switched.error.status).json({
          status: 'error',
          message: switched.error.message
        });
      }
      const syncedUser = await syncPmPortalFlagForUser(switched.user);
      return createSendToken(syncedUser, 200, res);
    }

    let additionalGstNumbers = [];
    try {
      if (typeof req.body.additionalGstNumbers === 'string') {
        additionalGstNumbers = JSON.parse(req.body.additionalGstNumbers);
      } else if (Array.isArray(req.body.additionalGstNumbers)) {
        additionalGstNumbers = req.body.additionalGstNumbers;
      }
    } catch {
      additionalGstNumbers = [];
    }

    const registration = parseWithSchema(vendorLeadRegistrationSchema, {
      phoneNumber: normalizeIndianMobile(req.body.phoneNumber),
      email: String(req.body.email || '').trim().toLowerCase(),
      gstNo: String(req.body.gstNo || '').trim().toUpperCase(),
      companyName: String(req.body.companyName || '').trim(),
      legalName: String(req.body.legalName || req.body.companyName || '').trim() || undefined,
      companyType: String(req.body.companyType || '').trim(),
      designation: String(req.body.designation || '').trim(),
      bankName: String(req.body.bankName || '').trim(),
      accountNumber: String(req.body.accountNumber || '').trim(),
      ifscCode: String(req.body.ifscCode || '').trim().toUpperCase(),
      businessAddress: String(req.body.businessAddress || '').trim(),
      additionalGstNumbers: additionalGstNumbers
        .map((gst) => String(gst || '').trim().toUpperCase())
        .filter(Boolean),
      panNo: String(req.body.panNo || '').trim().toUpperCase() || undefined,
      accountHolderName: String(req.body.accountHolderName || '').trim() || undefined,
      accountType: String(req.body.accountType || '').trim().toLowerCase() || undefined,
      branch: String(req.body.branch || '').trim() || undefined
    });

    const verifiedPhone = normalizeIndianMobile(user.phone);
    if (!verifiedPhone || verifiedPhone.length !== 10) {
      return res.status(400).json({
        status: 'error',
        message: 'Your Service Provider account must have a verified phone number before supplier registration.'
      });
    }
    registration.phoneNumber = verifiedPhone;

    if (!req.files?.gstCertificate?.[0]) {
      return res.status(400).json({ status: 'error', message: 'GST Certificate is required' });
    }
    if (!req.files?.panCardFile?.[0]) {
      return res.status(400).json({ status: 'error', message: 'PAN Card is required' });
    }
    if (!req.files?.cancelledChequeFile?.[0]) {
      return res.status(400).json({ status: 'error', message: 'Cancelled Cheque is required' });
    }

    const normalizedEmail = registration.email;
    if (isPmPlaceholderEmail(normalizedEmail)) {
      return res.status(400).json({
        status: 'error',
        message: 'Enter a valid business email address for supplier registration.'
      });
    }

    const { data: existingEmailUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingEmailUser && existingEmailUser.id !== user.id) {
      return res.status(400).json({
        status: 'error',
        message: 'This email is already registered to another account.'
      });
    }

    let pmResponse;
    try {
      // PM "vendor" phone = service provider login identity. If that phone already
      // exists in PM, continue Tatva supplier registration with the same number.
      pmResponse = await submitPmVendorLeadForSupplierUpgrade({
        fields: registration,
        files: req.files,
        accessToken: user.profile?.pmCustomerAuth?.accessToken || null,
        user
      });
    } catch (pmError) {
      console.error('PM vendor-leads error:', pmError);
      return res.status(pmError.status || 400).json({
        status: 'error',
        message: pmError.message || 'PM vendor registration failed'
      });
    }

    return finalizeSupplierRegistration(user, registration, pmResponse, res);
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Register supplier error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Could not register supplier portal access'
    });
  }
});

// Complete Tatva supplier setup after PM vendor-leads succeeds on the frontend
router.post('/complete-supplier-registration', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();

    if (error || !user) {
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    if (!hasRegisteredRole(user, 'service_provider')) {
      return res.status(403).json({
        status: 'error',
        message: 'Only service provider accounts can register as a supplier.'
      });
    }

    if (hasRegisteredRole(user, 'supplier') && isSupplierRegistrationComplete(user)) {
      const switched = await switchUserPortal(req.userId, 'supplier');
      if (switched.error) {
        return res.status(switched.error.status).json({
          status: 'error',
          message: switched.error.message
        });
      }
      const syncedUser = await syncPmPortalFlagForUser(switched.user);
      return createSendToken(syncedUser, 200, res);
    }

    const payload = parseWithSchema(completeSupplierRegistrationSchema, req.body || {});
    // Prefer PM vendor-leads payload when present; otherwise reuse SP phone identity.
    const pmVendorLead =
      payload.pmVendorLead ||
      (payload.phoneNumber
        ? {
            phoneNumber: payload.phoneNumber,
            email: payload.email,
            gstNo: payload.gstNo,
            companyName: payload.companyName,
            source: 'tatva_supplier_registration'
          }
        : null);

    if (!pmVendorLead) {
      return res.status(400).json({
        status: 'error',
        message: 'Supplier registration details are required.'
      });
    }

    return finalizeSupplierRegistration(user, payload, pmVendorLead, res);
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Complete supplier registration error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Could not complete supplier registration'
    });
  }
});

// Switch between registered portals without re-registering
router.post('/switch-portal', authenticateToken, async (req, res) => {
  try {
    const payload = parseWithSchema(switchPortalSchema, req.body || {});
    const switched = await switchUserPortal(req.userId, payload.portal);

    if (switched.error) {
      return res.status(switched.error.status).json({
        status: 'error',
        message: switched.error.message
      });
    }

    const syncedUser = await syncPmPortalFlagForUser(switched.user);
    createSendToken(syncedUser, 200, res);
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Switch portal error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Could not switch portal'
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const payload = parseWithSchema(loginSchema, req.body || {});
    const { email, password } = payload;

    // Check for admin email from environment variables
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
    const initialAdminPassword = process.env.ADMIN_PASSWORD;
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('Login attempt for email:', email.toLowerCase());
    }

    // If this is the admin email, handle admin login
    if (email.toLowerCase() === adminEmail.toLowerCase()) {
      let { data: adminUser, error: adminError } = await supabase
        .from('users')
        .select('*')
        .eq('email', adminEmail.toLowerCase())
        .single();
      
      // If admin user doesn't exist and we have initial password from env, create it
      if (!adminUser && initialAdminPassword) {
        try {
          const hashedPassword = await hashPassword(initialAdminPassword);
          const { data: newAdmin, error: createError } = await supabase
            .from('users')
            .insert({
              name: process.env.ADMIN_NAME || 'Admin User',
              email: adminEmail.toLowerCase(),
              password: hashedPassword,
              user_type: 'admin',
              company: process.env.ADMIN_COMPANY || 'Tatva Direct',
              email_verified: true,
              is_active: true
            })
            .select()
            .single();
          
          if (createError) {
            console.error('Error creating admin user:', createError);
            return res.status(500).json({
              status: 'error',
              message: 'Error creating admin account. Please check server logs.'
            });
          }
          
          adminUser = newAdmin;
        } catch (createError) {
          console.error('Error creating admin user:', createError);
          return res.status(500).json({
            status: 'error',
            message: 'Error creating admin account. Please check server logs.'
          });
        }
      }
      
      // If admin user exists, verify password
      if (adminUser) {
        // Ensure user type is admin
        if (adminUser.user_type !== 'admin') {
          await supabase
            .from('users')
            .update({ user_type: 'admin' })
            .eq('id', adminUser.id);
          adminUser.user_type = 'admin';
        }
        
        // Verify password
        const isPasswordCorrect = await comparePassword(password, adminUser.password);
        
        // If password doesn't match and we have initial password from env, 
        // allow reset if the provided password matches the env password
        if (!isPasswordCorrect && initialAdminPassword && password === initialAdminPassword) {
          const hashedPassword = await hashPassword(initialAdminPassword);
          const { data: updatedAdmin, error: updateError } = await supabase
            .from('users')
            .update({ password: hashedPassword })
            .eq('id', adminUser.id)
            .select()
            .single();
          
          if (updateError) {
            console.error('Error updating admin password:', updateError);
            return res.status(500).json({
              status: 'error',
              message: 'Error updating admin password'
            });
          }
          
          adminUser = updatedAdmin;
        } else if (!isPasswordCorrect) {
          return res.status(401).json({
            status: 'error',
            message: 'Incorrect email or password. Please check your credentials.'
          });
        }
        
        // Final password verification
        const finalPasswordCheck = await comparePassword(password, adminUser.password);
        if (!finalPasswordCheck) {
          return res.status(401).json({
            status: 'error',
            message: 'Incorrect email or password. Please check your credentials.'
          });
        }
        
        // Check if user is active
        if (!adminUser.is_active) {
          return res.status(401).json({
            status: 'error',
            message: 'Your account has been deactivated. Please contact support.'
          });
        }
        
        console.log('Admin login successful');
        return createSendToken(adminUser, 200, res);
      } else {
        // Admin email but no admin user and no initial password set
        console.log('Admin user not found and no password in env');
        return res.status(401).json({
          status: 'error',
          message: 'Admin account not configured. Please set ADMIN_PASSWORD in environment variables.'
        });
      }
    }

    return res.status(403).json({
      status: 'error',
      code: 'PASSWORD_LOGIN_DISABLED',
      message:
        'Email/password sign-in is only available for admin accounts. Service providers and suppliers must use phone OTP sign-in.'
    });
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Login error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error during login'
    });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();
    
    if (error || !user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
    
    // Remove password from response
    delete user.password;
    
    res.status(200).json({
      status: 'success',
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error fetching user data'
    });
  }
});

// Get current user (alternative endpoint)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();
    
    if (error || !user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
    
    // Remove password from response
    delete user.password;
    
    res.status(200).json({
      status: 'success',
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error fetching user data'
    });
  }
});

// Update password
router.patch('/update-password', authenticateToken, async (req, res) => {
  try {
    const payload = parseWithSchema(updatePasswordSchema, req.body || {});
    const { currentPassword, newPassword } = payload;

    // 1) Get user from collection
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // 2) Check if current password is correct
    const isPasswordCorrect = await comparePassword(currentPassword, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({
        status: 'error',
        message: 'Your current password is incorrect'
      });
    }

    // 3) Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // 4) Update password
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({ 
        password: hashedPassword,
        password_changed_at: new Date().toISOString()
      })
      .eq('id', req.userId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        status: 'error',
        message: 'Error updating password'
      });
    }

    // 5) Log user in, send JWT
    createSendToken(updatedUser, 200, res);
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update password error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error updating password'
    });
  }
});

// Logout (client-side token removal)
router.post('/logout', (req, res) => {
  try {
    parseWithSchema(logoutSchema, req.body || {});
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
  }
  res.status(200).json({
    status: 'success',
    message: 'Logged out successfully'
  });
});

export { router as authRouter };
