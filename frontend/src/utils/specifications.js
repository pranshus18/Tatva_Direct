import { looksLikeSpecificationDump } from './productDisplay';

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

export const parseSpecificationsObject = (specifications) => {
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
  return String(value).trim() !== '';
};

export const isMeaningfullyFilledSpecValue = isMeaningfullyFilled;

/** Normalize specification keys for case/spacing/punctuation-insensitive matching. */
export const normalizeSpecificationKeyForMatch = (key) =>
  String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Resolve a value from a spec map using exact or normalized key matching. */
export const resolveSpecificationValueForKey = (specifications, targetKey) => {
  const parsed = parseSpecificationsObject(specifications) || {};
  if (Object.prototype.hasOwnProperty.call(parsed, targetKey)) {
    return parsed[targetKey];
  }
  const targetNorm = normalizeSpecificationKeyForMatch(targetKey);
  if (!targetNorm) return undefined;
  for (const [key, value] of Object.entries(parsed)) {
    if (normalizeSpecificationKeyForMatch(key) === targetNorm) {
      return value;
    }
  }
  return undefined;
};

/** Apply AI-extracted values onto admin template keys without leaving parallel empty keys. */
export const mergeExtractedValuesOntoSpecificationTemplate = (
  templateSpecs = {},
  extractedSpecs = {}
) => {
  const template = parseSpecificationsObject(templateSpecs) || {};
  const extracted = parseSpecificationsObject(extractedSpecs) || {};
  const merged = { ...template };

  Object.keys(template).forEach((key) => {
    const extractedValue = resolveSpecificationValueForKey(extracted, key);
    if (isMeaningfullyFilled(extractedValue)) {
      merged[key] = extractedValue;
    }
  });

  Object.entries(extracted).forEach(([extractedKey, value]) => {
    if (!isMeaningfullyFilled(value)) return;
    if (
      Object.prototype.hasOwnProperty.call(merged, extractedKey) &&
      isMeaningfullyFilled(merged[extractedKey])
    ) {
      return;
    }
    const matchedTemplateKey = Object.keys(template).find(
      (templateKey) =>
        normalizeSpecificationKeyForMatch(templateKey) ===
        normalizeSpecificationKeyForMatch(extractedKey)
    );
    if (matchedTemplateKey && !isMeaningfullyFilled(merged[matchedTemplateKey])) {
      merged[matchedTemplateKey] = value;
    } else if (!matchedTemplateKey && !Object.prototype.hasOwnProperty.call(merged, extractedKey)) {
      merged[extractedKey] = value;
    }
  });

  return merged;
};

export const countNewlyFilledSpecificationValues = (beforeSpecs = {}, afterSpecs = {}) => {
  const before = parseSpecificationsObject(beforeSpecs) || {};
  const after = parseSpecificationsObject(afterSpecs) || {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let count = 0;
  keys.forEach((key) => {
    const previous = resolveSpecificationValueForKey(before, key);
    const next = resolveSpecificationValueForKey(after, key);
    if (!isMeaningfullyFilled(previous) && isMeaningfullyFilled(next)) {
      count += 1;
    }
  });
  return count;
};

export const hasMeaningfulSpecValues = (specifications) => {
  const parsed = parseSpecificationsObject(specifications);
  if (!parsed) return false;
  return Object.values(parsed).some(isMeaningfullyFilled);
};

function normalizeSpecValueForComparison(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(normalizeSpecValueForComparison);
  if (typeof value === 'object') {
    const out = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        out[key] = normalizeSpecValueForComparison(value[key]);
      });
    return out;
  }
  return value;
}

function buildNormalizedMeaningfulSpecMap(specs = {}) {
  const parsed = parseSpecificationsObject(specs) || {};
  const out = new Map();
  Object.entries(parsed).forEach(([key, value]) => {
    const norm = normalizeSpecificationKeyForMatch(key);
    if (!norm || !isMeaningfullyFilled(value)) return;
    out.set(norm, normalizeSpecValueForComparison(value));
  });
  return out;
}

/** True when supplier specs differ from an existing catalog product baseline. */
export const hasSupplierSpecificationChangesFromBaseline = (
  baselineSpecs = {},
  supplierSpecs = {}
) => {
  const baseline = buildNormalizedMeaningfulSpecMap(baselineSpecs);
  const submitted = buildNormalizedMeaningfulSpecMap(supplierSpecs);

  if (baseline.size === 0) return false;

  for (const [norm, baselineValue] of baseline) {
    const submittedValue = submitted.get(norm);
    if (submittedValue === undefined) continue;
    if (JSON.stringify(baselineValue) !== JSON.stringify(submittedValue)) {
      return true;
    }
  }

  for (const norm of submitted.keys()) {
    if (!baseline.has(norm)) return true;
  }

  return false;
};

export const isSupplierOfferApproved = (status) => {
  const raw = String(status || 'pending').trim().toLowerCase();
  return raw === 'approved' || raw === 'active';
};

/** Admin/catalog specification keys assigned for a supplier offer row. */
export const getSupplierCatalogSpecificationKeys = (product = {}) => {
  if (Array.isArray(product.catalogSpecificationKeys) && product.catalogSpecificationKeys.length > 0) {
    return product.catalogSpecificationKeys.filter(Boolean);
  }
  const catalogSpecs = parseSpecificationsObject(product.catalogSpecifications);
  if (catalogSpecs && Object.keys(catalogSpecs).length > 0) {
    return Object.keys(catalogSpecs).filter(Boolean);
  }
  return Object.keys(parseSpecificationsObject(product.specifications) || {}).filter(Boolean);
};

/**
 * Approved offers with admin keys but incomplete supplier offer values still need a one-time fill.
 */
export const supplierOfferNeedsPostApprovalSpecFill = (product = {}) => {
  if (!product || !isSupplierOfferApproved(product.status)) return false;
  const keys = getSupplierCatalogSpecificationKeys(product);
  if (keys.length === 0) return false;
  return !supplierSpecificationValuesLocked({
    offerSpecifications:
      product.supplierOfferSpecifications || product.attributes?.specifications,
    supplierSpecValuesLocked: product.supplierSpecValuesLocked,
    catalogSpecificationKeys: keys,
    productStatus: product.status
  });
};

/**
 * Supplier spec values lock after the one-time post-approval fill is complete.
 * Pending offers stay editable until admin approval.
 */
export const supplierSpecificationValuesLocked = ({
  specifications,
  offerSpecifications,
  supplierSpecValuesLocked,
  catalogSpecificationKeys = [],
  productStatus = ''
} = {}) => {
  if (supplierSpecValuesLocked === true) return true;
  if (supplierSpecValuesLocked === false) return false;

  const offerSpecs = parseSpecificationsObject(offerSpecifications ?? specifications) || {};
  const templateKeys = Array.isArray(catalogSpecificationKeys)
    ? catalogSpecificationKeys.filter(Boolean)
    : [];

  if (isSupplierOfferApproved(productStatus) && templateKeys.length > 0) {
    return templateKeys.every((key) =>
      isMeaningfullyFilled(resolveSpecificationValueForKey(offerSpecs, key))
    );
  }

  if (!isSupplierOfferApproved(productStatus)) {
    return false;
  }

  return hasMeaningfulSpecValues(offerSpecs);
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

  const seen = new Set();
  return Object.keys(parsedObject)
    .filter((key) => isDisplayableSpecKey(key))
    .sort((a, b) => a.localeCompare(b))
    .flatMap((key) => {
      const norm = normalizeSpecKeyForDedup(key);
      if (!norm || seen.has(norm)) return [];
      seen.add(norm);
      return [
        {
          key,
          label: toReadableSpecLabel(key),
          value: parsedObject[key],
          displayValue: formatSpecDisplayValue(parsedObject[key]),
          hasValue: isMeaningfullyFilled(parsedObject[key])
        }
      ];
    });
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
  'supplierdescription',
  'publisheddescription',
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

/** Normalize spec keys so "B P A Free", "bpa-free", and "Bpa free" dedupe together. */
export const normalizeSpecKeyForDedup = (key) =>
  String(key || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** Merge spec maps while collapsing keys that differ only by casing/spacing/punctuation. */
export const mergeSpecificationMapsByNormalizedKey = (...sources) => {
  const byNorm = new Map();

  for (const source of sources) {
    const parsed = parseSpecificationsObject(source);
    if (!parsed) continue;

    for (const [key, value] of Object.entries(parsed)) {
      const norm = normalizeSpecKeyForDedup(key);
      if (!norm) continue;

      const existing = byNorm.get(norm);
      if (!existing) {
        byNorm.set(norm, { key, value });
        continue;
      }

      const existingFilled = isMeaningfullyFilled(existing.value);
      const incomingFilled = isMeaningfullyFilled(value);
      if (incomingFilled || !existingFilled) {
        byNorm.set(norm, { key, value });
      }
    }
  }

  const merged = {};
  for (const { key, value } of byNorm.values()) {
    merged[key] = value;
  }
  return merged;
};

/** Prefer meaningful variant/offer values; fill remaining keys from shared catalog/admin specs. */
export const mergeCatalogAndOfferSpecificationsForDisplay = (catalogSpecs = {}, offerSpecs = {}) =>
  mergeSpecificationMapsByNormalizedKey(catalogSpecs, offerSpecs);

/** Catalog template keys only — filled shared catalog values must not bleed across variants. */
export const catalogSpecificationTemplateForVariantMerge = (catalogSpecs = {}) => {
  const parsed = parseSpecificationsObject(catalogSpecs) || {};
  const result = {};
  Object.keys(parsed).forEach((key) => {
    const normalizedKey = String(key || '').trim();
    if (normalizedKey) result[normalizedKey] = '';
  });
  return result;
};

/** Resolve display specs for a supplier offer row (catalog template + per-variant offer). */
export const resolveSupplierOfferDisplaySpecifications = (product) => {
  if (!product) return {};
  const catalog = product.catalogSpecifications;
  const offer =
    product.supplierOfferSpecifications ||
    product.attributes?.specifications;
  if (catalog || offer) {
    const catalogTemplate = catalogSpecificationTemplateForVariantMerge(catalog || {});
    return mergeCatalogAndOfferSpecificationsForDisplay(catalogTemplate, offer || {});
  }
  return parseSpecificationsObject(product.specifications) || {};
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
