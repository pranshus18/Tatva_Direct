import { getApiUrl } from '../config/api';
import {
  countNewlyFilledSpecificationValues,
  mergeExtractedValuesOntoSpecificationTemplate,
  mergeSpecificationObjects,
  parseSpecificationsObject
} from './specifications';

/** Stable fingerprint of fields that feed specification extraction. */
export function buildSpecExtractionSourceKey({
  name = '',
  category = '',
  brand = '',
  description = ''
} = {}) {
  const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
  return [normalize(name), normalize(category), normalize(brand), normalize(description)].join('\n');
}

export async function extractSpecificationsFromDescription({
  description,
  category,
  productName = '',
  existingSpecifications = {},
  provider = 'auto'
}) {
  const token = localStorage.getItem('token');
  const response = await fetch(getApiUrl('/api/supplier/products/extract-specifications'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      description,
      category,
      productName,
      provider,
      existingSpecifications
    })
  });

  const data = await response.json().catch(() => ({ status: 'error', message: 'Invalid response' }));
  return { response, data };
}

/** Merge AI output into a spec map without wiping filled fields when AI returns null. */
export function applyExtractResultToSpecs(currentSpecs, data) {
  if (data?.status === 'warning') {
    return { ok: false, warning: data.categoryMismatchWarning || data.message };
  }
  if (data?.status !== 'success') {
    return { ok: false, error: data?.message || 'Extraction failed' };
  }

  const extracted = parseSpecificationsObject(data.specifications) || {};
  const current = parseSpecificationsObject(currentSpecs) || {};
  const merged =
    Object.keys(current).length > 0
      ? mergeExtractedValuesOntoSpecificationTemplate(current, extracted)
      : mergeSpecificationObjects(current, extracted);

  const filledCount = countNewlyFilledSpecificationValues(current, merged);

  return {
    ok: true,
    merged,
    filledCount,
    provider: data.provider,
    categoryMismatchWarning: data.categoryMismatchWarning || null
  };
}
