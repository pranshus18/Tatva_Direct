/** Flatten profile / cart shipping address records for display and forms. */
export function getShippingAddressFields(entry = {}) {
  const nested = entry?.address && typeof entry.address === 'object' ? entry.address : {};
  return {
    label: String(entry?.displayName || entry?.label || entry?.name || '').trim(),
    line1: String(entry?.line1 || nested?.line1 || entry?.street || nested?.street || '').trim(),
    city: String(entry?.city || nested?.city || '').trim(),
    state: String(entry?.state || nested?.state || '').trim(),
    pincode: String(
      entry?.pincode || nested?.pincode || entry?.zipCode || nested?.zipCode || ''
    ).trim(),
    country: String(entry?.country || nested?.country || 'India').trim() || 'India'
  };
}

export function formatShippingAddressLabel(entry, index = 0) {
  const fields = getShippingAddressFields(entry);
  if (fields.label) return fields.label;
  const preview = [fields.line1, fields.city].filter(Boolean).join(', ');
  if (preview) return preview;
  return `Address ${index + 1}`;
}

/** Single-line address for banners and geocoding hints. */
export function formatShippingAddressPreview(entry = {}) {
  const fields = getShippingAddressFields(entry);
  return [fields.line1, fields.city, fields.state, fields.pincode, fields.country]
    .filter(Boolean)
    .join(', ');
}

export function normalizeShippingAddressBookEntry(entry = {}) {
  const id = String(entry?.id || '').trim();
  const fields = getShippingAddressFields(entry);
  return {
    id,
    label: String(entry?.label || entry?.name || '').trim(),
    displayName: String(entry?.displayName || '').trim() || formatShippingAddressLabel(entry),
    address: {
      line1: fields.line1,
      city: fields.city,
      state: fields.state,
      pincode: fields.pincode,
      country: fields.country
    }
  };
}
