const PREFERRED_SPEC_KEYS = [
  'brandModel',
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
  'gst',
  // Internal catalog identity bundle — too verbose for order line-item chips.
  'identity',
  'catalogKey',
  'matchSignals',
  'asinLikeId',
  'variantAsinLikeId'
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

const CUSTOMER_SPEC_EXCLUDE_KEYS = new Set([
  'brand',
  'brandmodel',
  'category',
  'unit',
  'gtin',
  'barcode',
  'mpn',
  'hsncode',
  'hsn_code',
  'hsn',
  'lsa',
  'asin',
  'variantasin',
  'variantkey',
  'listingname',
  'description',
  'name',
  'specification',
  'specifications',
  'specs',
  'moq',
  'min_order_quantity',
  'stock',
  'location',
  'cgst',
  'igst',
  'sgst',
  'gst',
  'cgst_rate',
  'igst_rate',
  'sgst_rate',
  'cgstrate',
  'igstrate',
  'sgstrate',
  'gstrate',
  'bcov',
  'about',
  'about_this_item',
  'product_description',
  'productdetails',
  'product_details',
  'details',
  'overview',
  'features',
  'highlights',
  'key_features',
  'keyfeatures'
]);

const CUSTOMER_SPEC_EXCLUDE_PATTERN = /(cgst|igst|sgst|gst|hsn|cess|vat|tax|bcov)/;

export const normalizeSpecFieldKey = (key) =>
  String(key || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');

/** Hide internal catalog, identity, and tax fields from buyer-facing spec lists. */
export const isCustomerFacingSpecKey = (key) => {
  if (!isDisplayableSpecKey(key)) return false;
  const normalized = normalizeSpecFieldKey(key);
  const compact = normalized.replace(/_/g, '');
  if (CUSTOMER_SPEC_EXCLUDE_KEYS.has(normalized) || CUSTOMER_SPEC_EXCLUDE_KEYS.has(compact)) {
    return false;
  }
  return !CUSTOMER_SPEC_EXCLUDE_PATTERN.test(compact);
};

function looksLikeMisplacedDescriptionValue(displayValue) {
  const value = String(displayValue || '').trim();
  if (!value || value === '(Not set)') return false;
  if (value.length > 180 && /[.!?]/.test(value) && value.split(/\s+/).length > 25) {
    return true;
  }
  return looksLikeSpecificationDump(value);
}

function looksLikeSpecificationDump(text) {
  const lines = String(text || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return false;
  const specLikeLines = lines.filter((line) => /^[\w\s/&().-]+\s*:\s*.+/.test(line));
  return specLikeLines.length >= Math.max(2, Math.ceil(lines.length * 0.5));
}

function isCustomerFacingSpecEntry(entry) {
  if (!isCustomerFacingSpecKey(entry?.key)) return false;
  return !looksLikeMisplacedDescriptionValue(entry?.displayValue);
}

export const specificationEntriesForCustomerDisplay = (specifications) =>
  specificationEntriesForDetails(specifications).filter((entry) =>
    isCustomerFacingSpecEntry(entry)
  );

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

/** Flat spec map for logistics quotes (preserves keys like weight / dimensions). */
export const specificationsObjectForLogistics = (specifications) => {
  const parsedObject = parseSpecificationsObject(specifications);
  if (!parsedObject) return {};

  const out = {};
  Object.keys(parsedObject)
    .filter((key) => isDisplayableSpecKey(key))
    .forEach((key) => {
      const value = parsedObject[key];
      if (!isMeaningfullyFilled(value)) return;
      if (typeof value === 'object' && value !== null) {
        const formatted = formatSpecValue(value);
        if (formatted) out[key] = formatted;
      } else {
        out[key] = String(value);
      }
    });
  return out;
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

/** Union template field keys with variant specs; variant values win (including empty). */
export const mergeVariantSpecificationTemplate = (templateSpecs = {}, variantSpecs = {}) => {
  const template = parseSpecificationsObject(templateSpecs) || {};
  const variant = parseSpecificationsObject(variantSpecs) || {};
  const merged = {};

  Object.keys(template).forEach((key) => {
    merged[key] = Object.prototype.hasOwnProperty.call(variant, key) ? variant[key] : '';
  });

  Object.keys(variant).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(merged, key)) {
      merged[key] = variant[key];
    }
  });

  return merged;
};
