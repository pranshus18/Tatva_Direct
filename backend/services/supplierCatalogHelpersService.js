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
