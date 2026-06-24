/** Align field names with backend normalizeAddress (poHelpers). */
export function normalizeShippingAddress(address = {}) {
  return {
    line1: String(address?.line1 || address?.street || '').trim(),
    city: String(address?.city || '').trim(),
    state: String(address?.state || '').trim(),
    pincode: String(
      address?.pincode || address?.zipCode || address?.postalCode || address?.postal_code || ''
    ).trim(),
    country: String(address?.country || 'India').trim() || 'India'
  };
}

/** Legacy: single shippingProvider. New: byVendorId map (shipment group id → courier name). */
export function buildShippingAddressKey(address = {}) {
  const normalized = normalizeShippingAddress(address);
  const parts = [normalized.line1, normalized.city, normalized.state, normalized.pincode, normalized.country]
    .map((part) => String(part || '').trim().toLowerCase())
    .filter(Boolean);
  return parts.length ? parts.join('|') : 'default';
}

/** Same supplier + same delivery address → one transport pick. */
export function buildTransportGroupId(vendorId, shippingAddress = {}) {
  const vid = String(vendorId || '').trim();
  const shipKey = buildShippingAddressKey(shippingAddress);
  return `${vid}::${shipKey}`;
}

/** Merge shipment groups that share supplier + delivery address. */
export function consolidatePoTransportGroups(groups) {
  if (!Array.isArray(groups) || groups.length <= 1) return groups || [];

  const merged = new Map();
  for (const group of groups) {
    const vendorId = String(group?.vendorId || '').trim();
    const shippingAddress = group?.shippingAddress || null;
    const mergeKey = group?.transportGroupId || buildTransportGroupId(vendorId, shippingAddress || {});
    if (!mergeKey) continue;

    if (!merged.has(mergeKey)) {
      merged.set(mergeKey, {
        ...group,
        vendorId,
        transportGroupId: mergeKey,
        shippingAddressKey: group?.shippingAddressKey || buildShippingAddressKey(shippingAddress || {}),
        items: [...(group.items || [])],
        total: Number(group.total || 0) || 0
      });
      continue;
    }

    const existing = merged.get(mergeKey);
    existing.items.push(...(group.items || []));
    existing.total = Math.round((Number(existing.total || 0) + Number(group.total || 0)) * 100) / 100;
    if (!existing.shippingAddress && shippingAddress) {
      existing.shippingAddress = shippingAddress;
      existing.shippingAddressLabel = group.shippingAddressLabel || existing.shippingAddressLabel;
    }
    if (!existing.vendorName && group.vendorName) {
      existing.vendorName = group.vendorName;
    }
  }

  return Array.from(merged.values());
}

export function getTransportGroupKey(groupOrKey) {
  if (groupOrKey && typeof groupOrKey === 'object') {
    return String(groupOrKey.transportGroupId || groupOrKey.vendorId || '').trim();
  }
  return String(groupOrKey || '').trim();
}
export function normalizeTransportSelection(transport) {
  if (!transport || typeof transport !== 'object') return null;
  const by = normalizeVendorKeyRecord(transport.byVendorId);
  const det = normalizeVendorKeyRecord(transport.byVendorCourierDetail);
  const hasPerVendor = Object.keys(by).some((id) => String(by[id] || '').trim());
  const next = {
    ...transport,
    byVendorId: by,
    byVendorCourierDetail: det
  };
  if (hasPerVendor) {
    next.shippingProvider = '';
  }
  return next;
}

export function isTransportSelectionReady(transport, groups) {
  if (!transport || typeof transport !== 'object') return false;
  const by = transport.byVendorId;
  const ids = (Array.isArray(groups) ? groups : [])
    .map((g) => getTransportGroupKey(g))
    .filter(Boolean);
  if (ids.length > 0) {
    return ids.every((id) => String(by?.[id] || '').trim());
  }
  if (String(transport.shippingProvider || '').trim()) return true;
  if (!by || typeof by !== 'object') return false;
  return Object.keys(by).some((k) => String(by[k] || '').trim());
}

export function isTransportSelectionReadyForVendor(transport, vendorIdOrGroup) {
  if (!transport || typeof transport !== 'object') return false;
  const id = getTransportGroupKey(vendorIdOrGroup);
  if (!id) return false;
  const by = transport.byVendorId;
  return Boolean(by && typeof by === 'object' && String(by[id] || '').trim());
}

export function getVendorTransportDetail(transport, vendorIdOrGroup) {
  const id = getTransportGroupKey(vendorIdOrGroup);
  if (!transport || !id) return null;
  const by = transport.byVendorCourierDetail;
  if (by && typeof by === 'object' && by[id]) return by[id];
  const name = transport.byVendorId?.[id];
  if (name) return { name, rate: null };
  return null;
}

function normalizeVendorKeyRecord(record) {
  if (!record || typeof record !== 'object') return {};
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [String(key), value])
  );
}

/**
 * Merge per-vendor transport picks. Only updates vendor ids in vendorIds (or union of maps).
 * Earlier supplier selections are kept when configuring transport one supplier at a time.
 */
export function mergeTransportSelections(existing, incoming, vendorIds = null) {
  const existingBy = normalizeVendorKeyRecord(existing?.byVendorId);
  const existingDet = normalizeVendorKeyRecord(existing?.byVendorCourierDetail);
  const incBy = normalizeVendorKeyRecord(incoming?.byVendorId);
  const incDet = normalizeVendorKeyRecord(incoming?.byVendorCourierDetail);

  const explicitIds = Array.isArray(vendorIds)
    ? vendorIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const ids =
    explicitIds.length > 0
      ? explicitIds
      : [...new Set([...Object.keys(existingBy), ...Object.keys(incBy)])];

  const next = {
    ...(existing && typeof existing === 'object' ? existing : {}),
    ...(incoming && typeof incoming === 'object' ? incoming : {}),
    byVendorId: { ...existingBy },
    byVendorCourierDetail: { ...existingDet }
  };

  for (const id of ids) {
    if (incBy[id] != null && String(incBy[id]).trim()) {
      next.byVendorId[id] = incBy[id];
    }
    if (incDet[id]) {
      next.byVendorCourierDetail[id] = incDet[id];
    }
  }

  if (incoming?.transportNotes) next.transportNotes = incoming.transportNotes;
  if (incoming?.trackingNumber) next.trackingNumber = incoming.trackingNumber;
  if (incoming?.trackingUrl) next.trackingUrl = incoming.trackingUrl;

  return normalizeTransportSelection(next);
}

export function formatQuoteMoney(rate) {
  if (rate == null || rate === '') return null;
  const n = Number(String(rate).replace(/,/g, ''));
  if (Number.isFinite(n)) {
    return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return String(rate);
}
