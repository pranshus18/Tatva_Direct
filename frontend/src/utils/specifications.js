const PREFERRED_SPEC_KEYS = [
  'brandModel',
  'identity',
  'variantAsin',
  'mpn',
  'catalogName',
  'asinLiked'
];

const INTERNAL_SPEC_KEYS = new Set(['snapshot']);

/** PO/order snapshot identity — not product template fields. */
const ORDER_SNAPSHOT_META_KEYS = new Set([
  'parentAsin',
  'variantAsin',
  'variantKey',
  'brandModel',
  'variantAttributes',
  'snapshotAt',
  'productIdentification',
  'bcov',
  'gst'
]);

const isDisplayableSpecKey = (key) => {
  const normalized = String(key || '').trim();
  return normalized && !INTERNAL_SPEC_KEYS.has(normalized) && !ORDER_SNAPSHOT_META_KEYS.has(normalized);
};

export const toReadableSpecLabel = (rawKey) =>
  String(rawKey || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase());

export const formatSpecValue = (value, depth = 0) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'object') return String(value);
  if (depth > 1) return '';

  return Object.entries(value)
    .map(([key, nestedValue]) => {
      const nested = formatSpecValue(nestedValue, depth + 1);
      return nested ? `${toReadableSpecLabel(key)}: ${nested}` : '';
    })
    .filter(Boolean)
    .join(', ');
};

const parseSpecificationsObject = (specifications) => {
  if (!specifications) return null;

  if (typeof specifications === 'object' && !Array.isArray(specifications)) {
    return specifications.snapshot && typeof specifications.snapshot === 'object'
      ? specifications.snapshot
      : specifications;
  }

  if (typeof specifications === 'string') {
    try {
      const parsed = JSON.parse(specifications);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed.snapshot && typeof parsed.snapshot === 'object'
          ? parsed.snapshot
          : parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
};

const isMeaningfullyFilled = (value) => {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
};

/** Flatten product/order specifications for chip display in supplier portals. */
export const parseSpecificationsForDisplay = (specifications, options = {}) => {
  const maxEntries = Number.isFinite(options.maxEntries) ? options.maxEntries : 12;
  const includeEmpty = options.includeEmpty === true;

  if (!specifications) return [];

  const parsedObject = parseSpecificationsObject(specifications);
  if (!parsedObject) {
    return [{ label: 'Specs', value: String(specifications) }];
  }

  const entries = [];
  const seen = new Set();

  const pushEntry = (key, value) => {
    const label = toReadableSpecLabel(key);
    const normalizedLabel = label.toLowerCase();
    if (!label || seen.has(normalizedLabel) || !isDisplayableSpecKey(key)) return;
    if (!includeEmpty && !isMeaningfullyFilled(value)) return;

    const formatted =
      typeof value === 'object' && value !== null
        ? formatSpecValue(value)
        : isMeaningfullyFilled(value)
          ? String(value)
          : '';

    entries.push({
      label,
      value: formatted || '(Not set)'
    });
    seen.add(normalizedLabel);
  };

  PREFERRED_SPEC_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(parsedObject, key)) {
      pushEntry(key, parsedObject[key]);
    }
  });

  Object.keys(parsedObject)
    .sort((a, b) => a.localeCompare(b))
    .forEach((key) => pushEntry(key, parsedObject[key]));

  return entries.slice(0, maxEntries);
};

export const formatSpecDisplayValue = (value) => {
  if (!isMeaningfullyFilled(value)) return '(Not set)';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'object') {
    const formatted = formatSpecValue(value);
    return formatted || '(Not set)';
  }
  return String(value);
};

export const specificationEntriesForDetails = (specifications) => {
  const parsedObject = parseSpecificationsObject(specifications);
  if (!parsedObject) return [];

  return Object.keys(parsedObject)
    .filter((key) => isDisplayableSpecKey(key))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => ({
      key,
      label: toReadableSpecLabel(key),
      value: parsedObject[key],
      displayValue: formatSpecDisplayValue(parsedObject[key]),
      hasValue: isMeaningfullyFilled(parsedObject[key])
    }));
};

/** Format a spec value for a text input. */
export const specValueToInput = (value) => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
};

/** Parse text input back into a spec value (preserves arrays/objects when possible). */
export const parseSpecInputToValue = (raw, originalValue) => {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return '';

  if (Array.isArray(originalValue)) {
    return trimmed
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (originalValue !== null && typeof originalValue === 'object') {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
};

export const mergeSpecificationObjects = (templateSpecs = {}, storedSpecs = {}) => {
  const merged = { ...(templateSpecs || {}) };
  Object.entries(storedSpecs || {}).forEach(([key, value]) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;
    const hasStored = isMeaningfullyFilled(value);
    const hasExisting = isMeaningfullyFilled(merged[normalizedKey]);
    if (!Object.prototype.hasOwnProperty.call(merged, normalizedKey) || (hasStored && !hasExisting)) {
      merged[normalizedKey] = value;
    }
  });
  return merged;
};
