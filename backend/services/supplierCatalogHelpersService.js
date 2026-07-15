export const normalizeText = (text) =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s\d-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const normalizeGtin = (value) => String(value || '').replace(/\s+/g, '').trim();

export const isValidGtin = (value) => /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(value);

export const isCatalogGuardrailsEnabled = () => (process.env.CATALOG_GUARDRAILS_ENABLED || 'true') !== 'false';

export const onboardingAutoApproveThreshold = Number(process.env.ONBOARDING_AUTO_APPROVE_THRESHOLD || '0.8');

export const normalizeModelIdentifier = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const sanitizeSpecifications = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const cleaned = {};
  Object.entries(input).forEach(([key, value]) => {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) return;
    if (value === undefined) return;
    cleaned[normalizedKey] = value;
  });
  return cleaned;
};

export const isMeaningfullyFilledSpecValue = (value) => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  return String(value).trim() !== '';
};

export const countMeaningfulSpecValues = (specsObj) =>
  Object.values(specsObj || {}).filter(isMeaningfullyFilledSpecValue).length;

/** Normalize specifications stored as object, JSON string, or legacy array rows. */
export const parseSpecificationsObject = (value) => {
  if (!value) return null;

  const arrayToObject = (arr) => {
    const out = {};
    for (const item of arr || []) {
      if (!item) continue;
      if (Array.isArray(item) && item.length >= 2) {
        const key = String(item[0] ?? '').trim();
        if (!key) continue;
        out[key] = item[1];
        continue;
      }
      if (typeof item === 'object') {
        const key = String(item.key ?? item.name ?? '').trim();
        if (!key) continue;
        out[key] = item.value;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  };

  if (typeof value === 'object' && !Array.isArray(value)) {
    if (
      value.snapshot &&
      typeof value.snapshot === 'object' &&
      !Array.isArray(value.snapshot)
    ) {
      return value.snapshot;
    }
    return value;
  }
  if (Array.isArray(value)) return arrayToObject(value);

  if (typeof value === 'string') {
    try {
      let parsed = JSON.parse(value);
      if (typeof parsed === 'string') {
        try {
          parsed = JSON.parse(parsed);
        } catch {
          // keep as-is
        }
      }
      if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed)) return arrayToObject(parsed);
        return parsed;
      }
    } catch {
      return null;
    }
  }

  return null;
};

/** Immutable order / PO snapshot fields — not merged from live catalog rows. */
export const ORDER_SNAPSHOT_META_KEYS = new Set([
  'parentAsin',
  'variantAsin',
  'variantKey',
  'brandModel',
  'variantAttributes',
  'snapshotAt',
  'productIdentification',
  'bcov',
  'gst',
  'identity',
  'catalogKey',
  'matchSignals',
  'asinLikeId',
  'variantAsinLikeId'
]);

const stripOrderSnapshotMetaKeys = (specs = {}) =>
  Object.fromEntries(
    Object.entries(specs).filter(([key]) => !ORDER_SNAPSHOT_META_KEYS.has(String(key || '').trim()))
  );

/**
 * Merge catalog + order snapshot specs for display without overwriting
 * frozen identity fields captured at order placement.
 */
export const mergeOrderItemSpecificationsForDisplay = (productSpecs, snapshot) => {
  const productParsed = parseSpecificationsObject(productSpecs) || {};
  const snapshotParsed = parseSpecificationsObject(snapshot) || {};
  const merged = mergeSpecificationMaps(
    stripOrderSnapshotMetaKeys(productParsed),
    stripOrderSnapshotMetaKeys(snapshotParsed)
  );
  for (const key of ORDER_SNAPSHOT_META_KEYS) {
    if (
      snapshotParsed[key] !== undefined &&
      snapshotParsed[key] !== null &&
      snapshotParsed[key] !== ''
    ) {
      merged[key] = snapshotParsed[key];
    }
  }
  return merged;
};

/** Merge spec maps; prefer meaningful values over empty placeholders. */
export const mergeSpecificationMaps = (...sources) => {
  const merged = {};
  for (const source of sources) {
    const parsed = parseSpecificationsObject(source);
    if (!parsed) continue;
    Object.entries(parsed).forEach(([key, value]) => {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey) return;
      const hasKey = Object.prototype.hasOwnProperty.call(merged, normalizedKey);
      const existingFilled = isMeaningfullyFilledSpecValue(merged[normalizedKey]);
      const incomingFilled = isMeaningfullyFilledSpecValue(value);
      if (!hasKey) {
        merged[normalizedKey] = value;
        return;
      }
      if (incomingFilled && !existingFilled) {
        merged[normalizedKey] = value;
      }
    });
  }
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

export const buildSpecificationTemplateFromFields = (fields = []) => {
  const template = {};
  for (const field of fields) {
    const key = String(field?.field_key || field?.key || '').trim();
    if (!key) continue;
    template[key] = null;
  }
  return template;
};

export const normalizeBcovBrand = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const toFiniteNumber = (value) => {
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
};

export const parseBcovNotes = (rawNotes) => {
  const raw = String(rawNotes || '').trim();
  if (!raw) return { levelName: null, buyerBcov: null, rawNotes: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        levelName: String(parsed.levelName || '').trim() || null,
        buyerBcov: String(parsed.buyerBcov || '').trim() || null,
        rawNotes: raw
      };
    }
  } catch (_) {
    // legacy non-JSON notes
  }
  return { levelName: null, buyerBcov: raw, rawNotes: raw };
};

export const composeBcovNotes = ({ levelName, buyerBcov }) => {
  const payload = {
    levelName: String(levelName || '').trim() || null,
    buyerBcov: String(buyerBcov || '').trim() || null
  };
  if (!payload.levelName && !payload.buyerBcov) return null;
  return JSON.stringify(payload);
};
