import { PM_PLATFORM_FLAG } from '../config/pmAuth';
import { resolveApiPath } from '../config/api';

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function formatPmAddress(address) {
  if (!address) return '';
  return [
    address.building,
    address.buildingName,
    address.floor,
    address.street,
    address.locality,
    address.district,
    address.state,
    address.zip
  ]
    .filter(Boolean)
    .join(', ');
}

export function mapPmGstVerification(payload = {}) {
  const companyData = payload.companyData || {};
  const addresses = Array.isArray(companyData.addresses) ? companyData.addresses : [];
  const primaryAddress =
    addresses.find((entry) => String(entry?.type || '').toUpperCase() === 'PRIMARY') ||
    addresses[0] ||
    null;

  return {
    gstNo: String(payload.gstNo || '').trim().toUpperCase(),
    companyName:
      String(payload.companyName || companyData.tradeName || payload.legalName || '').trim(),
    legalName:
      String(payload.legalName || companyData.legalName || payload.companyName || '').trim(),
    companyType: String(payload.constitution || companyData.constitution || '').trim(),
    panNo: String(payload.pan || companyData.pan || '').trim().toUpperCase(),
    businessAddress: formatPmAddress(primaryAddress)
  };
}

export async function verifyPmGst(gstNo) {
  const normalizedGst = String(gstNo || '')
    .trim()
    .toUpperCase()
    .replace(/\s/g, '');

  if (normalizedGst.length !== 15) {
    throw new Error('Enter a valid 15-character GST number');
  }

  const response = await fetch(resolveApiPath('/api/auth/pm-verify-gst'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      gstNo: normalizedGst,
      flag: PM_PLATFORM_FLAG,
      platformFlag: PM_PLATFORM_FLAG
    })
  });

  const data = await parseJsonResponse(response);

  if (!response.ok || data.success === false) {
    throw new Error(data.message || 'GST verification failed');
  }

  return mapPmGstVerification(data.data || data);
}
