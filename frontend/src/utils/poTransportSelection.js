/** Legacy: single shippingProvider. New: byVendorId map (supplier UUID → courier name). */
export function isTransportSelectionReady(transport, groups) {
  if (!transport || typeof transport !== 'object') return false;
  if (String(transport.shippingProvider || '').trim()) return true;
  const by = transport.byVendorId;
  if (!by || typeof by !== 'object') return false;
  const ids = (Array.isArray(groups) ? groups : []).map((g) => String(g.vendorId || '')).filter(Boolean);
  if (ids.length === 0) return Object.keys(by).some((k) => String(by[k] || '').trim());
  return ids.every((id) => String(by[id] || '').trim());
}

export function isTransportSelectionReadyForVendor(transport, vendorId) {
  if (!transport || typeof transport !== 'object') return false;
  const id = String(vendorId || '').trim();
  if (!id) return false;
  if (String(transport.shippingProvider || '').trim()) return true;
  const by = transport.byVendorId;
  return Boolean(by && typeof by === 'object' && String(by[id] || '').trim());
}

export function getVendorTransportDetail(transport, vendorId) {
  const id = String(vendorId || '').trim();
  if (!transport || !id) return null;
  const by = transport.byVendorCourierDetail;
  if (by && typeof by === 'object' && by[id]) return by[id];
  const name = transport.byVendorId?.[id];
  if (name) return { name, rate: null };
  if (String(transport.shippingProvider || '').trim()) {
    return { name: transport.shippingProvider, rate: null };
  }
  return null;
}

function normalizeVendorKeyRecord(record) {
  if (!record || typeof record !== 'object') return {};
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [String(key), value])
  );
}

/**
 * Merge per-vendor transport picks. By default unions all vendor ids from existing + incoming
 * so earlier supplier selections are kept when configuring transport one supplier at a time.
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

  return next;
}

export function formatQuoteMoney(rate) {
  if (rate == null || rate === '') return null;
  const n = Number(String(rate).replace(/,/g, ''));
  if (Number.isFinite(n)) {
    return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return String(rate);
}
