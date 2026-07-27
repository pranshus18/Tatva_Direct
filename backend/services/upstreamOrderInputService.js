import {
  isAddressComplete,
  normalizeAddress,
  resolveB2bPaymentFromBody
} from '../controllers/po/shared/poHelpers.js';
import { deriveShippingAddressesFromProfile } from '../controllers/profile/profileHelpers.js';

/** Supplier profile branches are the canonical shipping addresses. */
export function branchRecordToAddressInput(branch) {
  if (!branch || typeof branch !== 'object') return {};
  return {
    line1: branch.address || branch.line1,
    city: branch.city,
    state: branch.state,
    pincode: branch.pincode || branch.zipCode,
    country: branch.country || 'India'
  };
}

export function isSupplierBranchAddressComplete(branch) {
  return isAddressComplete(normalizeAddress(branchRecordToAddressInput(branch)));
}

/**
 * Maps the first complete profile branch to users.address JSONB (line1, pincode, …).
 * Required by DB check constraint users_supplier_sp_address_required_chk.
 */
export function primaryBranchToUsersAddress(branches) {
  const list = Array.isArray(branches) ? branches : [];
  const primary = list.find((branch) => isSupplierBranchAddressComplete(branch));
  if (!primary) return null;
  return normalizeAddress(branchRecordToAddressInput(primary));
}

export function resolveShippingAddressFromProfileBook(profileRow, shippingAddressId) {
  const id = String(shippingAddressId || '').trim();
  if (!id) return null;

  const saved = deriveShippingAddressesFromProfile(profileRow || {});
  const match = saved.find((entry) => String(entry.id) === id);
  if (!match) return null;

  const normalized = normalizeAddress(match);
  return isAddressComplete(normalized) ? normalized : null;
}

export function resolvePrimarySupplierShippingAddress({
  shippingAddress,
  shippingAddressId,
  profileRow
} = {}) {
  const fromBody = normalizeAddress(shippingAddress || {});
  if (isAddressComplete(fromBody)) return fromBody;

  const fromProfileBook = resolveShippingAddressFromProfileBook(profileRow, shippingAddressId);
  if (fromProfileBook) return fromProfileBook;

  const branches = Array.isArray(profileRow?.profile?.branches) ? profileRow.profile.branches : [];
  for (const branch of branches) {
    const normalized = normalizeAddress(branchRecordToAddressInput(branch));
    if (isAddressComplete(normalized)) return normalized;
  }

  return normalizeAddress(profileRow?.address || {});
}

export function normalizeRequiredDateForUpstream(requiredDate, now = new Date()) {
  const raw = String(requiredDate || '').trim();
  if (!raw) {
    return { expectedDeliveryDate: null, error: null };
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return {
      expectedDeliveryDate: null,
      error: 'Invalid requiredDate. Please provide a valid date.'
    };
  }

  const requiredDayUtc = new Date(parsed);
  requiredDayUtc.setUTCHours(0, 0, 0, 0);
  const todayUtc = new Date(now);
  todayUtc.setUTCHours(0, 0, 0, 0);

  if (requiredDayUtc.getTime() < todayUtc.getTime()) {
    return {
      expectedDeliveryDate: null,
      error: 'Expected dispatch date cannot be in the past.'
    };
  }

  return { expectedDeliveryDate: parsed.toISOString(), error: null };
}

export function resolveUpstreamPaymentSelection(paymentMethod) {
  return resolveB2bPaymentFromBody({ paymentMethod });
}

