const STORAGE_PREFIX = 'boqCancelledItemIds:';

function itemKey(item) {
  if (item?.id != null && String(item.id).trim() !== '') {
    return String(item.id).trim();
  }
  return '';
}

export function readCancelledBoqItemIds(boqId) {
  if (!boqId) return new Set();
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${boqId}`);
    const parsed = JSON.parse(raw || '[]');
    return new Set((Array.isArray(parsed) ? parsed : []).map(String).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function writeCancelledBoqItemIds(boqId, ids) {
  if (!boqId) return;
  try {
    const list = [...(ids instanceof Set ? ids : new Set(ids || []))].map(String).filter(Boolean);
    if (list.length === 0) {
      sessionStorage.removeItem(`${STORAGE_PREFIX}${boqId}`);
      return;
    }
    sessionStorage.setItem(`${STORAGE_PREFIX}${boqId}`, JSON.stringify(list));
  } catch {
    /* ignore storage errors */
  }
}

export function clearCancelledBoqItemIds(boqId) {
  if (!boqId) return;
  try {
    sessionStorage.removeItem(`${STORAGE_PREFIX}${boqId}`);
  } catch {
    /* ignore */
  }
}

export function excludeCancelledBoqItems(items = [], boqId = null, extraCancelledIds = null) {
  const cancelled = new Set([
    ...readCancelledBoqItemIds(boqId),
    ...((extraCancelledIds instanceof Set ? extraCancelledIds : new Set(extraCancelledIds || [])).values())
  ]);
  if (cancelled.size === 0) return Array.isArray(items) ? items : [];
  return (items || []).filter((item) => {
    const key = itemKey(item);
    return !key || !cancelled.has(key);
  });
}
