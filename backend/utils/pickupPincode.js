/**
 * Resolve supplier ship-from PIN and structured address from `users.address`,
 * optional `users.profile.branches`, or an `outlets` row (warehouse / store).
 */

/** True for signup / profile placeholders — used by logistics to re-fetch supplier address from DB. */
export function isPlaceholderStreetLine(value) {
  const t = String(value || '')
    .trim()
    .toLowerCase();
  if (!t || t.length < 2) return true;
  return /temporary|temp\.?\s*addr|placeholder|to be (filled|updated)|\btbd\b|^n\/?a$|^test\b|unknown\s*addr|^t\.?b\.?d\.?$|^address\s+pending$|^pending$/.test(
    t
  );
}

/**
 * Prefer a real street line over signup placeholders often stored in `line1`.
 */
function primaryStreetLine(addr = {}) {
  const line1 = String(addr.line1 || '').trim();
  const street = String(
    addr.street ||
      (typeof addr.address === 'string' ? addr.address : '') ||
      addr.address_line1 ||
      addr.area ||
      ''
  ).trim();
  if (street && (!line1 || isPlaceholderStreetLine(line1))) return street;
  return line1 || street;
}

/** Normalize structured address so UI/API use street when `line1` is a signup placeholder. */
export function applyPrimaryStreetLine(addr) {
  if (!addr || typeof addr !== 'object') return addr;
  return { ...addr, line1: primaryStreetLine(addr) };
}

function digitsPin6FromAddressFields(addr = {}) {
  const candidates = [
    addr.pincode,
    addr.zipCode,
    addr.postalCode,
    addr.postal_code,
    addr.zip
  ];
  for (const c of candidates) {
    const d = String(c ?? '')
      .replace(/\D/g, '')
      .slice(0, 6);
    if (d.length === 6) return d;
  }
  return '';
}

function lineFromAddr(addr = {}) {
  const line1 = primaryStreetLine(addr);
  const city = String(addr.city || '').trim();
  const state = String(addr.state || addr.region || '').trim();
  const country = String(addr.country || '').trim();
  return { line1, city, state, country };
}

function buildPickupAddress(line1, city, state, country, pinDigits) {
  return {
    line1: line1 || '',
    city: city || '',
    state: state || '',
    country: country || '',
    pincode: pinDigits || ''
  };
}

function mergeSupplierBranchAddress(addr, branch) {
  const b = branch && typeof branch === 'object' ? branch : {};
  return {
    ...addr,
    ...b,
    line1:
      b.line1 ||
      (typeof b.address === 'string' ? b.address : '') ||
      addr.line1 ||
      addr.street ||
      '',
    street: b.street || addr.street,
    city: b.city || addr.city,
    state: b.state || addr.state,
    country: b.country || addr.country
  };
}

/**
 * Ship-from meta for a supplier `users` row (profile + branches fallback).
 * @returns {{ pincode: string, summary: string, pickupAddress: object, outletId: null, outletName: null }}
 */
export function getSupplierPickupMeta(row = {}) {
  const addr = row.address && typeof row.address === 'object' ? row.address : {};
  const profile = row.profile && typeof row.profile === 'object' ? row.profile : {};
  const branches = Array.isArray(profile.branches) ? profile.branches : [];

  let pin = digitsPin6FromAddressFields(addr);
  let { line1, city, state, country } = lineFromAddr(addr);

  // Many suppliers keep a valid PIN on `users.address` but the real street lives in
  // `profile.branches[].address` (Profile "Branch Locations"). The legacy path only
  // consulted branches when PIN was missing, so signup placeholders like
  // "Temporary Address" never got replaced.
  if (!pin) {
    for (const b of branches) {
      if (!b || typeof b !== 'object') continue;
      const merged = mergeSupplierBranchAddress(addr, b);
      const p = digitsPin6FromAddressFields(merged);
      if (p) {
        pin = p;
        ({ line1, city, state, country } = lineFromAddr(merged));
        break;
      }
    }
  }

  if (isPlaceholderStreetLine(line1)) {
    for (const b of branches) {
      if (!b || typeof b !== 'object') continue;
      const merged = mergeSupplierBranchAddress(addr, b);
      const candidateLine = primaryStreetLine(merged);
      if (!isPlaceholderStreetLine(candidateLine)) {
        ({ line1, city, state, country } = lineFromAddr(merged));
        // Do not use merged.pincode here — it keeps the signup row PIN and hides the
        // branch warehouse PIN when the branch has its own zipCode.
        const prevPin = pin;
        const branchOnlyPin = digitsPin6FromAddressFields({
          pincode: b.pincode || b.zipCode,
          zipCode: b.zipCode,
          postalCode: b.postalCode,
          postal_code: b.postal_code,
          zip: b.zip
        });
        pin = branchOnlyPin || prevPin;
        break;
      }
    }
  }

  const parts = [line1, city, state].filter(Boolean);
  const summary = pin
    ? `${parts.join(', ')}${parts.length ? ' · ' : ''}PIN ${pin}`
    : parts.length
      ? `${parts.join(', ')} · PIN not set in supplier profile`
      : 'Supplier warehouse address / PIN not set';

  const pickupAddress = buildPickupAddress(line1, city, state, country, pin);

  return {
    pincode: pin,
    summary,
    pickupAddress,
    outletId: null,
    outletName: null
  };
}

/**
 * Ship-from meta for an `outlets` row (linked from supplier_products.outlet_id).
 * @returns {{ pincode: string, summary: string, pickupAddress: object, outletId: string|null, outletName: string|null }}
 */
export function getOutletPickupMeta(outlet = {}) {
  const addr = outlet.address && typeof outlet.address === 'object' ? outlet.address : {};
  const line1 = primaryStreetLine(addr);
  const city = String(addr.city || '').trim();
  const state = String(addr.state || '').trim();
  const country = String(addr.country || '').trim();
  const pin = digitsPin6FromAddressFields(addr);
  const outletName = String(outlet.name || '').trim() || 'Outlet';
  const parts = [line1, city, state].filter(Boolean);
  const summary = pin
    ? `${outletName}: ${parts.join(', ')}${parts.length ? ' · ' : ''}PIN ${pin}`
    : `${outletName}: set outlet address / PIN in supplier outlets`;

  return {
    pincode: pin,
    summary,
    pickupAddress: buildPickupAddress(line1, city, state, country, pin),
    outletId: outlet.id || null,
    outletName: outlet.name || null
  };
}
