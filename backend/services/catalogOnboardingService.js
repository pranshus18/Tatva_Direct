import { buildIdentityBundle, normalizeTextField } from './productIdentityService.js';

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeSpecFieldKey(value) {
  return normalizeTextField(value || '').replace(/\s+/g, '_');
}

export function parseSpecFieldValue(field, value) {
  if (value === undefined || value === null || value === '') return null;
  const dataType = field?.data_type || 'text';
  if (dataType === 'number') {
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }
  if (dataType === 'boolean') {
    if (value === true || value === false) return value;
    const str = String(value).toLowerCase().trim();
    if (str === 'true' || str === 'yes' || str === '1') return true;
    if (str === 'false' || str === 'no' || str === '0') return false;
    return null;
  }
  return String(value).trim();
}

export function buildTemplateFieldMap(templateFields = []) {
  const map = new Map();
  for (const field of templateFields) {
    const key = normalizeSpecFieldKey(field.field_key || field.display_name);
    if (!key) continue;
    map.set(key, field);
  }
  return map;
}

export function validateSpecValues(templateFields = [], incomingSpecs = {}) {
  const specData = safeObject(incomingSpecs);
  const fieldMap = buildTemplateFieldMap(templateFields);
  const allowed = {};
  const errors = [];
  const unknownKeys = [];

  for (const [inputKey, rawValue] of Object.entries(specData)) {
    const key = normalizeSpecFieldKey(inputKey);
    const field = fieldMap.get(key);
    if (!field) {
      unknownKeys.push(inputKey);
      continue;
    }

    const parsedValue = parseSpecFieldValue(field, rawValue);
    if (parsedValue === null && (field.is_required || false)) {
      errors.push(`Missing required value for ${field.display_name || field.field_key}`);
      continue;
    }
    if (parsedValue === null) continue;

    if (field.data_type === 'enum' && Array.isArray(field.enum_values) && field.enum_values.length > 0) {
      const normalizedAllowed = field.enum_values.map((v) => String(v).trim().toLowerCase());
      if (!normalizedAllowed.includes(String(parsedValue).trim().toLowerCase())) {
        errors.push(`Invalid enum value for ${field.display_name || field.field_key}`);
        continue;
      }
    }

    if (field.data_type === 'number') {
      if (field.min_value !== null && field.min_value !== undefined && parsedValue < Number(field.min_value)) {
        errors.push(`Value below minimum for ${field.display_name || field.field_key}`);
        continue;
      }
      if (field.max_value !== null && field.max_value !== undefined && parsedValue > Number(field.max_value)) {
        errors.push(`Value above maximum for ${field.display_name || field.field_key}`);
        continue;
      }
    }

    allowed[key] = parsedValue;
  }

  for (const field of templateFields) {
    const key = normalizeSpecFieldKey(field.field_key || field.display_name);
    if (field.is_required && (allowed[key] === undefined || allowed[key] === null || allowed[key] === '')) {
      errors.push(`Missing required key: ${field.display_name || field.field_key}`);
    }
  }

  return { allowed, errors, unknownKeys };
}

export function scoreOnboardingConfidence({ identityBundle, validationErrors = [], unknownKeys = [] }) {
  let score = 0.4;
  if (identityBundle?.matchSignals?.hasGtin) score += 0.35;
  if (identityBundle?.matchSignals?.hasMpn) score += 0.15;
  if (identityBundle?.matchSignals?.hasSku) score += 0.1;
  score -= Math.min(0.25, validationErrors.length * 0.05);
  score -= Math.min(0.2, unknownKeys.length * 0.03);
  return Math.max(0, Math.min(1, Number(score.toFixed(2))));
}

export function decideOnboardingAction(confidence, threshold = 0.8) {
  return confidence >= threshold ? 'auto_linked' : 'queued_review';
}

export function buildCatalogMatchingPayload(input = {}) {
  return buildIdentityBundle(input);
}
