import {
  normalizeSpecificationKeyForMatch,
  parseSpecificationsObject
} from './specifications';

/** Align option-chip keys with the shared specifications key matcher (punctuation-insensitive). */
function normalizeOptionKey(key) {
  return normalizeSpecificationKeyForMatch(key);
}

/** Amazon-style: one shopper-facing selector; everything else lives in specifications. */
const PRIMARY_VARIANT_OPTION_KEYS = [
  'color',
  'colour',
  'size',
  'capacity',
  'pack_size',
  'packsize',
  'style',
  'pattern',
  'material',
  'height',
  'length',
  'width',
  'weight',
  'volume'
];

export function pickPrimaryVariantOption(variantOptions = []) {
  if (!Array.isArray(variantOptions) || variantOptions.length === 0) return [];
  if (variantOptions.length === 1) return variantOptions;

  const withKeys = variantOptions.map((option) => ({
    ...option,
    normalizedKey: normalizeOptionKey(option.key)
  }));

  for (const priorityKey of PRIMARY_VARIANT_OPTION_KEYS) {
    const match = withKeys.find((option) => option.normalizedKey === priorityKey);
    if (match) return [match];
  }

  const [best] = [...withKeys].sort(
    (left, right) => (right.values?.length || 0) - (left.values?.length || 0)
  );
  return best ? [best] : [];
}

function normalizeOptionValue(value) {
  return String(value || '').trim().toLowerCase();
}

export function variantSelectionKey(variant) {
  return [
    variant?.productId || '',
    variant?.variantKey || '',
    variant?.variantAsin || '',
    variant?.supplierProductId || ''
  ].join('::');
}

export function variantMatchesUrlToken(variant, token) {
  const normalized = String(token || '').trim();
  if (!normalized) return false;
  return (
    String(variant?.variantKey || '') === normalized ||
    String(variant?.variantAsin || '') === normalized ||
    String(variant?.supplierProductId || '') === normalized ||
    String(variant?.productId || '') === normalized
  );
}

export function resolveVariantDisplaySpecifications(variant) {
  if (!variant) return {};
  return parseSpecificationsObject(variant.specifications) || variant.specifications || {};
}

export function resolveVariantAttributeValue(specifications, optionKey) {
  const parsed = parseSpecificationsObject(specifications) || specifications || {};
  const normalizedKey = normalizeOptionKey(optionKey);
  const matchEntry = Object.entries(parsed).find(
    ([attrKey]) => normalizeOptionKey(attrKey) === normalizedKey
  );
  return matchEntry ? matchEntry[1] : undefined;
}

export function variantMatchesSelections(variant, selections) {
  const attrs = resolveVariantDisplaySpecifications(variant);
  return Object.entries(selections || {}).every(([key, value]) => {
    const rawValue = resolveVariantAttributeValue(attrs, key);
    if (rawValue === undefined || rawValue === null || rawValue === '') return false;
    if (Array.isArray(rawValue)) {
      return normalizeOptionValue(rawValue.map(String).join(', ')) === normalizeOptionValue(value);
    }
    return normalizeOptionValue(rawValue) === normalizeOptionValue(value);
  });
}

/**
 * Prefer a variant matching option chips. When chips form an incompatible combo,
 * do NOT fall through to URL/first variant (would disagree with highlighted chips).
 */
export function resolveActiveDiscoveryVariant({
  variants = [],
  selectedVariantKey = '',
  optionSelections = {},
  urlVariantToken = ''
} = {}) {
  if (!variants.length) return null;

  const selectionEntries = Object.entries(optionSelections || {}).filter(([, value]) =>
    String(value || '').trim()
  );
  if (selectionEntries.length > 0) {
    const matched = variants.find((variant) =>
      variantMatchesSelections(variant, Object.fromEntries(selectionEntries))
    );
    if (matched) return matched;
    // Partial / dead chip combo: keep the last explicitly chosen variant only if it still matches.
    // Returning null surfaces "no matching variant" rather than a silent wrong listing.
    if (selectedVariantKey) {
      const explicit = variants.find(
        (variant) => variantSelectionKey(variant) === selectedVariantKey
      );
      if (explicit && variantMatchesSelections(explicit, Object.fromEntries(selectionEntries))) {
        return explicit;
      }
    }
    return null;
  }

  if (selectedVariantKey) {
    const explicit = variants.find((variant) => variantSelectionKey(variant) === selectedVariantKey);
    if (explicit) return explicit;
  }

  const urlVariant = String(urlVariantToken || '').trim();
  if (urlVariant) {
    const byToken = variants.find((variant) => variantMatchesUrlToken(variant, urlVariant));
    if (byToken) return byToken;
  }

  return variants[0];
}

export function buildOptionSelectionsForVariant(variant, variantOptions = []) {
  const attrs = resolveVariantDisplaySpecifications(variant);
  const nextSelections = {};
  for (const option of variantOptions) {
    const rawValue = resolveVariantAttributeValue(attrs, option.key);
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    nextSelections[option.key] = Array.isArray(rawValue)
      ? rawValue.map(String).join(', ')
      : String(rawValue).trim();
  }
  return nextSelections;
}

function formatVariantLabelValue(value) {
  if (value === undefined || value === null || value === '') return '';
  if (Array.isArray(value)) return value.map(String).join(', ').trim();
  return String(value).trim();
}

/** Human-readable variant chip label — prefers API variantOptions over hardcoded attribute keys. */
export function resolveDiscoveryVariantLabel(variant, variantOptions = []) {
  if (!variant) return 'Variant';

  const specs = resolveVariantDisplaySpecifications(variant);
  const canonical =
    variant?.canonicalAttributes && typeof variant.canonicalAttributes === 'object'
      ? variant.canonicalAttributes
      : {};

  const parts = [];
  const seen = new Set();

  for (const option of variantOptions) {
    const key = String(option?.key || '').trim();
    if (!key) continue;
    const raw =
      resolveVariantAttributeValue(specs, key) ??
      resolveVariantAttributeValue(canonical, key);
    const formatted = formatVariantLabelValue(raw);
    if (!formatted) continue;
    const dedupeKey = formatted.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    parts.push(formatted);
  }

  if (parts.length) return parts.join(' · ');
  if (variant?.variantAsin) return String(variant.variantAsin);
  return variant?.variantName || variant?.name || 'Variant';
}
