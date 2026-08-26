const PINCODE_RE = /^\d{6}$/;
const COUNTRY_ALIASES = new Set(['india', 'in', 'bharat']);
const PLACEHOLDER_CITY_STATE = /^(pending|n\/a|na|-)$/i;

function cleanPart(value) {
  return String(value || '').trim();
}

function usableCityOrState(value) {
  const text = cleanPart(value);
  if (!text || PLACEHOLDER_CITY_STATE.test(text)) return '';
  return text;
}

function usablePincode(value) {
  const text = cleanPart(value);
  if (!text || text === '000000' || !PINCODE_RE.test(text)) return '';
  return text;
}

function line1LooksFullyConcatenated(line1, city, state, pincode) {
  const source = cleanPart(line1);
  if (!source.includes(',')) return false;
  if (pincode && source.includes(pincode)) return true;
  const lower = source.toLowerCase();
  if (state && city && lower.includes(state.toLowerCase()) && lower.includes(city.toLowerCase())) {
    return true;
  }
  return false;
}

/** @see frontend/src/utils/parseStructuredShippingAddress.js */
export function parseStructuredShippingAddress(address = {}) {
  const existing = {
    line1: cleanPart(address.line1 || address.street || address.formatted_address || address.building || address.address),
    city: usableCityOrState(address.city || address.locality || address.district),
    state: usableCityOrState(address.state),
    pincode: usablePincode(address.pincode || address.zipCode || address.postalCode || address.zip),
    country: cleanPart(address.country) || 'India'
  };

  const shouldSplitLine1 = line1LooksFullyConcatenated(
    existing.line1,
    existing.city,
    existing.state,
    existing.pincode
  );
  if (existing.city && existing.state && existing.pincode && !shouldSplitLine1) {
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

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (PINCODE_RE.test(parts[index])) {
      if (!pincode) pincode = parts[index];
      parts = [...parts.slice(0, index), ...parts.slice(index + 1)];
      break;
    }
  }

  if (parts.length >= 1) {
    const last = parts[parts.length - 1];
    if (!state || last.toLowerCase() === state.toLowerCase()) {
      if (!state) state = last;
      parts = parts.slice(0, -1);
    }
  }

  if (parts.length >= 1) {
    const last = parts[parts.length - 1];
    if (!city || last.toLowerCase() === city.toLowerCase()) {
      if (!city) city = last;
      parts = parts.slice(0, -1);
    }
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
