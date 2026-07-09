const SIGNUP_PLACEHOLDER_PINCODE = '000000';
const ADDRESS_FIELDS = ['line1', 'city', 'state', 'pincode', 'country'];

function normalizeAddress(address = {}) {
  return {
    line1: String(address?.line1 || address?.street || '').trim(),
    city: String(address?.city || '').trim(),
    state: String(address?.state || '').trim(),
    pincode: String(
      address?.pincode ||
        address?.zipCode ||
        address?.postalCode ||
        address?.postal_code ||
        ''
    ).trim(),
    country: String(address?.country || '').trim()
  };
}

function hasSignupPlaceholderCoreFields(address = {}) {
  const normalized = normalizeAddress(address);
  return (
    /^pending$/i.test(normalized.city) &&
    /^pending$/i.test(normalized.state) &&
    normalized.pincode === SIGNUP_PLACEHOLDER_PINCODE
  );
}

export function isSignupPlaceholderAddressField(field, value, address = {}, companyName = '') {
  const text = String(value || '').trim();
  if (!text) return false;

  const company = String(companyName || '').trim();
  const corePlaceholders = hasSignupPlaceholderCoreFields(address);

  switch (field) {
    case 'city':
      return /^pending$/i.test(text);
    case 'state':
      return /^pending$/i.test(text);
    case 'pincode':
      return text === SIGNUP_PLACEHOLDER_PINCODE;
    case 'line1':
      if (/^address pending$/i.test(text)) return true;
      return corePlaceholders && company && text.toLowerCase() === company.toLowerCase();
    case 'country':
      return corePlaceholders && text === 'India';
    default:
      return false;
  }
}

export function sanitizeSignupPlaceholderAddress(address = {}, { companyName = '' } = {}) {
  const normalized = normalizeAddress(address);
  const sanitized = { ...normalized };

  for (const field of ADDRESS_FIELDS) {
    if (isSignupPlaceholderAddressField(field, sanitized[field], normalized, companyName)) {
      sanitized[field] = '';
    }
  }

  return sanitized;
}
