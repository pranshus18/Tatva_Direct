import { PM_PLATFORM_FLAG } from '../config/pmAuth';
import { resolveApiPath } from '../config/api';
import { parseStructuredShippingAddress } from '../utils/parseStructuredShippingAddress';

async function parseJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function cleanPart(value) {
  return String(value || '').trim();
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

/** Map a GST/PM address object into street / city / state / PIN — never dump the whole string into line1. */
export function mapPmGstAddress(address) {
  if (!address || typeof address !== 'object') {
    return parseStructuredShippingAddress({});
  }

  const locality = cleanPart(address.locality);
  const district = cleanPart(address.district);
  const city = district || locality || cleanPart(address.city);
  const streetLine = [
    address.building,
    address.buildingName,
    address.floor,
    address.street,
    locality && locality !== city ? locality : ''
  ]
    .map(cleanPart)
    .filter(Boolean)
    .join(', ');
  const concatenated = streetLine || formatPmAddress(address) || cleanPart(address.formatted_address || address.line1);

  return parseStructuredShippingAddress({
    line1: concatenated,
    city,
    state: address.state,
    pincode: address.zip || address.pincode || address.postalCode,
    country: address.country || 'India'
  });
}

export function mapPmGstVerification(payload = {}) {
  const companyData = payload.companyData || {};
  const addresses = Array.isArray(companyData.addresses) ? companyData.addresses : [];
  const primaryAddress =
    addresses.find((entry) => String(entry?.type || '').toUpperCase() === 'PRIMARY') ||
    addresses[0] ||
    null;
  const structuredAddress = mapPmGstAddress(primaryAddress);

  return {
    gstNo: String(payload.gstNo || '').trim().toUpperCase(),
    companyName:
      String(payload.companyName || companyData.tradeName || payload.legalName || '').trim(),
    legalName:
      String(payload.legalName || companyData.legalName || payload.companyName || '').trim(),
    companyType: String(payload.constitution || companyData.constitution || '').trim(),
    panNo: String(payload.pan || companyData.pan || '').trim().toUpperCase(),
    businessAddress: formatPmAddress(primaryAddress) || structuredAddress.line1,
    address: structuredAddress
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
