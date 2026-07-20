import {
  PM_VENDOR_LEADS_URL,
  PM_VENDOR_LEAD_FLAG,
  PM_VENDOR_LEAD_VENDOR_FLAG
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

  const credentials = getPmCustomerCredentials();
  const pmAccessToken = options.pmAccessToken || credentials.accessToken;
  const headers = {};
  if (pmAccessToken) {
    headers.Authorization = `Bearer ${pmAccessToken}`;
  }

  const response = await fetch(PM_VENDOR_LEADS_URL, {
    method: 'POST',
    headers,
    body: pmFormData
  });

  const data = await parseJsonResponse(response);

  if (!response.ok || data.success === false) {
    const message =
      data.message ||
      (Array.isArray(data.errors) && data.errors.map((entry) => entry.message).filter(Boolean).join(', ')) ||
      'PM vendor registration failed';
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
