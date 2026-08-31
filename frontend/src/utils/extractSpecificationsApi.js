import { getApiUrl } from '../config/api';
import {
  countNewlyFilledSpecificationValues,
  mergeExtractedValuesOntoSpecificationTemplate,
  mergeSpecificationObjects,
  parseSpecificationsObject,
  resolveSpecificationValueForKey
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

export const SPEC_EXTRACT_EMPTY_DESCRIPTION =
  'Enter a product description first. You can write normal sentences (for example “White vitreous china basin, 17.5 kg”) or key: value lines.';

export const SPEC_EXTRACT_CATEGORY_REQUIRED =
  'Select a category first so specification keys can be loaded.';

export const SPEC_EXTRACT_NO_VALUES =
  'No additional specification values could be identified in this description. Mention details such as colour, size, material, weight, or capacity, then try again.';

export const SPEC_EXTRACT_FAILED =
  'Could not extract specifications from this description. Check the description and try again.';

export function formatSpecExtractSuccessMessage(filledCount) {
  const count = Math.max(0, Number(filledCount) || 0);
  if (count === 1) {
    return 'Specifications extracted. 1 value was filled from the description.';
  }
  return `Specifications extracted. ${count} values were filled from the description.`;
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

function isFilledSpecInput(value) {
  if (value === null || value === undefined) return false;
  return String(value).trim() !== '';
}

/** Merge AI output into a spec map without wiping filled fields when AI returns null. */
export function applyExtractResultToSpecs(currentSpecs, data, { preserveFilled = false } = {}) {
  if (data?.status === 'warning') {
    return { ok: false, warning: data.categoryMismatchWarning || data.message };
  }
  if (data?.status !== 'success') {
    return { ok: false, error: data?.message || 'Extraction failed' };
  }

  const extracted = parseSpecificationsObject(data.specifications) || {};
  const current = parseSpecificationsObject(currentSpecs) || {};
  let merged =
    Object.keys(current).length > 0
      ? mergeExtractedValuesOntoSpecificationTemplate(current, extracted)
      : mergeSpecificationObjects(current, extracted);

  if (preserveFilled && Object.keys(current).length > 0) {
    merged = Object.fromEntries(
      Object.keys(current).map((key) => {
        const existing = resolveSpecificationValueForKey(current, key);
        if (isFilledSpecInput(existing)) return [key, existing];
        const next = resolveSpecificationValueForKey(merged, key);
        return [key, isFilledSpecInput(next) ? next : existing ?? ''];
      })
    );
  }

  const filledCount = countNewlyFilledSpecificationValues(current, merged);

  return {
    ok: true,
    merged,
    filledCount,
    provider: data.provider,
    categoryMismatchWarning: data.categoryMismatchWarning || null
  };
}
