import {
  PM_VENDOR_LEADS_URL,
  PM_VENDOR_LEAD_FLAG,
  PM_VENDOR_LEAD_VENDOR_FLAG
} from '../config/pmApi.js';

function appendIfPresent(form, key, value) {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (!text) return;
  form.append(key, text);
}

function appendFile(form, key, file) {
  if (!file?.buffer?.length) return;
  const blob = new Blob([file.buffer], { type: file.mimetype || 'application/octet-stream' });
  form.append(key, blob, file.originalname || `${key}.pdf`);
}

export async function submitPmVendorLead({ fields, files, accessToken = null }) {
  const form = new FormData();

  appendIfPresent(form, 'phoneNumber', fields.phoneNumber);
  appendIfPresent(form, 'email', fields.email);
  appendIfPresent(form, 'gstNo', fields.gstNo);
  appendIfPresent(form, 'companyName', fields.companyName);
  appendIfPresent(form, 'legalName', fields.legalName);
  appendIfPresent(form, 'companyType', fields.companyType);
  appendIfPresent(form, 'designation', fields.designation);
  appendIfPresent(form, 'bankName', fields.bankName);
  appendIfPresent(form, 'accountNumber', fields.accountNumber);
  appendIfPresent(form, 'ifscCode', fields.ifscCode);
  appendIfPresent(form, 'businessAddress', fields.businessAddress);
  appendIfPresent(form, 'panNo', fields.panNo);
  appendIfPresent(form, 'accountHolderName', fields.accountHolderName);
  appendIfPresent(form, 'accountType', fields.accountType ? String(fields.accountType).trim().toLowerCase() : '');
  appendIfPresent(form, 'branch', fields.branch);
  appendIfPresent(form, 'vendorFlag', fields.vendorFlag || PM_VENDOR_LEAD_VENDOR_FLAG);
  appendIfPresent(form, 'flag', fields.flag || PM_VENDOR_LEAD_FLAG);

  const additionalGstNumbers = Array.isArray(fields.additionalGstNumbers)
    ? fields.additionalGstNumbers
    : [];

  additionalGstNumbers.forEach((gst) => {
    appendIfPresent(form, 'additionalGstNumbers', gst);
  });

  appendFile(form, 'gstCertificate', files?.gstCertificate?.[0]);
  appendFile(form, 'panCardFile', files?.panCardFile?.[0]);
  appendFile(form, 'cancelledChequeFile', files?.cancelledChequeFile?.[0]);

  const headers = {};
  const token = String(accessToken || '').trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(PM_VENDOR_LEADS_URL, {
    method: 'POST',
    headers,
    body: form
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok || data.success === false) {
    const message =
      data.message ||
      (Array.isArray(data.errors) && data.errors.map((e) => e.message).filter(Boolean).join(', ')) ||
      'PM vendor registration failed';
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}
