const DESCRIPTION_COLUMN_KEYS = [
  'description',
  'item',
  'name',
  'product',
  'item description',
  'item name',
  'material',
  'product name'
];

const QUANTITY_COLUMN_KEYS = ['quantity', 'qty', 'qty.', 'amount', 'nos', 'number', 'count'];

export function normalizeBoqColumnKey(key) {
  return String(key || '').trim().toLowerCase();
}

export function isBoqDescriptionColumn(key) {
  const normalized = normalizeBoqColumnKey(key);
  if (!normalized) return false;
  if (DESCRIPTION_COLUMN_KEYS.includes(normalized)) return true;
  return (
    normalized.includes('description') ||
    normalized.includes('material') ||
    (normalized.includes('product') && !normalized.includes('qty')) ||
    (normalized.includes('name') && !normalized.includes('qty') && !normalized.includes('quantity'))
  );
}

export function isBoqQuantityColumn(key) {
  const normalized = normalizeBoqColumnKey(key);
  if (!normalized || isBoqDescriptionColumn(key)) return false;
  if (QUANTITY_COLUMN_KEYS.includes(normalized)) return true;
  return (
    /^(qty|quantity|nos|count|amount)\b/.test(normalized) ||
    normalized.includes('quantity') ||
    normalized.endsWith(' qty')
  );
}

export function parseBoqQuantityValue(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0 || value >= 1000000) return null;
    return value;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return null;

  const match = raw.match(/^([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)(?:\s*(?:nos|no|pcs|pc|units?|uom))?\.?$/i);
  if (!match) return null;

  const num = parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(num) || num <= 0 || num >= 1000000) return null;
  return num;
}

export function extractBoqQuantity(rawItem) {
  const keys = Object.keys(rawItem || {});

  for (const key of keys) {
    if (!isBoqQuantityColumn(key)) continue;
    const qty = parseBoqQuantityValue(rawItem[key]);
    if (qty != null) return qty;
  }

  for (const key of keys) {
    if (isBoqDescriptionColumn(key)) continue;
    const qty = parseBoqQuantityValue(rawItem[key]);
    if (qty != null) return qty;
  }

  return 0;
}
