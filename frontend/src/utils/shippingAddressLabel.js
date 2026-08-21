/** Flatten profile / cart shipping address records for display and forms. */
export function getShippingAddressFields(entry = {}) {
  const nested = entry?.address && typeof entry.address === 'object' ? entry.address : {};
  const buildingLine = [entry?.building, entry?.buildingName, entry?.floor, entry?.street || nested?.street]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(', ');
  return {
    label: String(entry?.displayName || entry?.label || entry?.name || entry?.subType || '').trim(),
    line1: String(
      entry?.line1 ||
        nested?.line1 ||
        buildingLine ||
        entry?.street ||
        nested?.street ||
        ''
    ).trim(),
    city: String(entry?.locality || nested?.locality || entry?.city || nested?.city || '').trim(),
    state: String(entry?.state || nested?.state || '').trim(),
    pincode: String(
      entry?.pincode ||
        nested?.pincode ||
        entry?.zip ||
        nested?.zip ||
        entry?.zipCode ||
        nested?.zipCode ||
        ''
    ).trim(),
    country: String(entry?.country || nested?.country || 'India').trim() || 'India'
  };
}

export function formatShippingAddressLabel(entry, index = 0) {
  const fields = getShippingAddressFields(entry);
  const preview = formatShippingAddressPreview(entry);
  if (fields.label && preview) {
    const label = fields.label.trim();
    const labelNorm = label.toLowerCase();
    const cityNorm = fields.city.toLowerCase();
    // Label is only a city nickname — show the full address instead of "Bengaluru" / "Pune, Pune".
    if (labelNorm === cityNorm || labelNorm === preview.toLowerCase()) {
      return preview;
    }
    return `${label} — ${preview}`;
  }
  if (preview) return preview;
  if (fields.label) return fields.label;
  return `Address ${index + 1}`;
}

/** Single-line address for banners and geocoding hints. */
export function formatShippingAddressPreview(entry = {}) {
  const nested = entry?.address && typeof entry.address === 'object' ? entry.address : {};
  const formatted = String(entry?.formatted_address || nested?.formatted_address || '').trim();
  if (formatted) return formatted;
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
    displayName: formatShippingAddressLabel(entry),
    address: {
      line1: fields.line1,
      city: fields.city,
      state: fields.state,
      pincode: fields.pincode,
      country: fields.country
    }
  };
}
