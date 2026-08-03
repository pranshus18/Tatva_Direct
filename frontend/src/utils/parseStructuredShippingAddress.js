const PINCODE_RE = /^\d{6}$/;
const COUNTRY_ALIASES = new Set(['india', 'in', 'bharat']);

function cleanPart(value) {
  return String(value || '').trim();
}

/**
 * Split a comma-separated street line into line1 / city / state / pincode / country
 * when those fields were stored together (legacy branch migration, pasted addresses).
 */
export function parseStructuredShippingAddress(address = {}) {
  const existing = {
    line1: cleanPart(address.line1 || address.street || address.address),
    city: cleanPart(address.city),
    state: cleanPart(address.state),
    pincode: cleanPart(address.pincode || address.zipCode || address.postalCode),
    country: cleanPart(address.country) || 'India'
  };

  if (existing.city && existing.state && existing.pincode) {
    return existing;
  }

  const source = existing.line1;
  if (!source.includes(',')) {
    return existing;
  }

  let parts = source
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    return existing;
  }

  let pincode = existing.pincode;
  let country = existing.country;
  let state = existing.state;
  let city = existing.city;

  if (parts.length > 0 && COUNTRY_ALIASES.has(parts[parts.length - 1].toLowerCase())) {
    country = 'India';
    parts = parts.slice(0, -1);
  }

  if (!pincode) {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      if (PINCODE_RE.test(parts[index])) {
        pincode = parts[index];
        parts = [...parts.slice(0, index), ...parts.slice(index + 1)];
        break;
      }
    }
  }

  if (!state && !city && parts.length >= 3) {
    state = parts[parts.length - 1];
    city = parts[parts.length - 2];
    parts = parts.slice(0, -2);
  } else if (!state && parts.length >= 2) {
    state = parts[parts.length - 1];
    parts = parts.slice(0, -1);
  }

  if (!city && parts.length >= 1) {
    city = parts[parts.length - 1];
    parts = parts.slice(0, -1);
  }

  const line1 = parts.join(', ').trim() || source;

  return {
    line1,
    city: city || existing.city,
    state: state || existing.state,
    pincode: pincode || existing.pincode,
    country: country || 'India'
  };
}

export function mergeParsedShippingAddress(address = {}) {
  const parsed = parseStructuredShippingAddress(address);
  return {
    ...address,
    line1: parsed.line1,
    city: parsed.city,
    state: parsed.state,
    pincode: parsed.pincode,
    country: parsed.country
  };
}
