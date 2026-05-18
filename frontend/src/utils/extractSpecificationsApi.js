import { getApiUrl } from '../config/api';
import { mergeSpecificationObjects } from './specifications';

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

  const extracted = data.specifications || {};
  const merged = mergeSpecificationObjects(currentSpecs || {}, extracted);

  const filledCount =
    typeof data.extractedCount === 'number'
      ? data.extractedCount
      : Object.values(extracted).filter(
          (v) => v !== null && v !== undefined && String(v).trim() !== ''
        ).length;

  return {
    ok: true,
    merged,
    filledCount,
    provider: data.provider,
    categoryMismatchWarning: data.categoryMismatchWarning || null
  };
}
