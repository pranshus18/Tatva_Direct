import {
  PM_VENDOR_LEADS_URL,
  PM_VENDOR_LEAD_FLAG,
  PM_VENDOR_LEAD_VENDOR_FLAG,
  buildPmPlatformHeaders,
  withPmPlatformFlagQuery
} from '../config/pmAuth';
import { getPmCustomerCredentials } from '../utils/pmAuthSession';

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function appendIfMissing(formData, key, value) {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (!text) return;
  if (formData.has(key)) return;
  formData.append(key, text);
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

/** PM vendor phone uniqueness = SP login identity, not a block on supplier signup. */
export function isExistingPmServiceProviderPhoneConflict(message) {
  const text = String(message || '').toLowerCase();
  if (!text.includes('phone')) return false;
  return (
    text.includes('only be used once') ||
    text.includes('onboarding request') ||
    text.includes('vendor onboarding') ||
    (text.includes('already exists') && text.includes('phone'))
  );
}

export function buildSupplierLeadFromExistingServiceProvider({
  formData,
  verifiedPhone = ''
}) {
  const phoneNumber =
    normalizePhone(verifiedPhone) || normalizePhone(formData.get('phoneNumber'));

  return {
    success: true,
    reusedExistingPmServiceProvider: true,
    data: {
      phoneNumber,
      email: String(formData.get('email') || '').trim().toLowerCase(),
      gstNo: String(formData.get('gstNo') || '').trim().toUpperCase(),
      companyName: String(formData.get('companyName') || '').trim(),
      source: 'existing_service_provider_phone'
    }
  };
}

export async function submitPmVendorLead(formData, options = {}) {
  const pmFormData = new FormData();
  const verifiedPhone = normalizePhone(options.verifiedPhone || formData.get('phoneNumber'));

  for (const [key, value] of formData.entries()) {
    if (key === 'phoneNumber') continue;
    if (value instanceof File) {
      pmFormData.append(key, value, value.name);
    } else {
      pmFormData.append(key, value);
    }
  }

  if (verifiedPhone.length === 10) {
    pmFormData.set('phoneNumber', verifiedPhone);
  }

  appendIfMissing(pmFormData, 'vendorFlag', PM_VENDOR_LEAD_VENDOR_FLAG);
  appendIfMissing(pmFormData, 'flag', PM_VENDOR_LEAD_FLAG);
  appendIfMissing(pmFormData, 'platformFlag', PM_VENDOR_LEAD_FLAG);

  const credentials = getPmCustomerCredentials();
  const pmAccessToken = options.pmAccessToken || credentials.accessToken;

  const response = await fetch(withPmPlatformFlagQuery(PM_VENDOR_LEADS_URL), {
    method: 'POST',
    headers: buildPmPlatformHeaders({ accessToken: pmAccessToken }),
    body: pmFormData
  });

  const data = await parseJsonResponse(response);

  if (!response.ok || data.success === false) {
    const message =
      data.message ||
      (Array.isArray(data.errors) && data.errors.map((entry) => entry.message).filter(Boolean).join(', ')) ||
      'PM vendor registration failed';

    // Same phone already used for Service Provider login in PM — continue supplier signup.
    if (options.allowExistingServiceProviderPhone !== false && isExistingPmServiceProviderPhoneConflict(message)) {
      return buildSupplierLeadFromExistingServiceProvider({
        formData,
        verifiedPhone
      });
    }

    throw new Error(message);
  }

  return data;
}

export function buildRegistrationPayloadFromFormData(
  formData,
  pmVendorLeadResponse = null,
  verifiedPhone = ''
) {
  let additionalGstNumbers = [];
  try {
    const raw = formData.get('additionalGstNumbers');
    additionalGstNumbers = raw ? JSON.parse(String(raw)) : [];
  } catch {
    additionalGstNumbers = [];
  }

  const phoneNumber =
    normalizePhone(verifiedPhone) || normalizePhone(formData.get('phoneNumber'));

  return {
    phoneNumber,
    email: String(formData.get('email') || '').trim().toLowerCase(),
    gstNo: String(formData.get('gstNo') || '').trim().toUpperCase(),
    companyName: String(formData.get('companyName') || '').trim(),
    legalName: String(formData.get('legalName') || formData.get('companyName') || '').trim() || undefined,
    companyType: String(formData.get('companyType') || '').trim(),
    designation: String(formData.get('designation') || '').trim(),
    bankName: String(formData.get('bankName') || '').trim(),
    accountNumber: String(formData.get('accountNumber') || '').trim(),
    ifscCode: String(formData.get('ifscCode') || '').trim().toUpperCase(),
    businessAddress: String(formData.get('businessAddress') || '').trim(),
    additionalGstNumbers: additionalGstNumbers
      .map((gst) => String(gst || '').trim().toUpperCase())
      .filter(Boolean),
    panNo: String(formData.get('panNo') || '').trim().toUpperCase() || undefined,
    accountHolderName: String(formData.get('accountHolderName') || '').trim() || undefined,
    accountType: String(formData.get('accountType') || '').trim().toLowerCase() || undefined,
    branch: String(formData.get('branch') || '').trim() || undefined,
    pmVendorLead: pmVendorLeadResponse?.data || pmVendorLeadResponse || null
  };
}
