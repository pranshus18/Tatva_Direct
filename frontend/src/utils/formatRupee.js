/** Indian Rupee display helpers — use for all user-visible prices. */
export const RUPEE_SYMBOL = '₹';

const DEFAULT_LOCALE = 'en-IN';

/**
 * @param {unknown} value
 * @param {{ minimumFractionDigits?: number, maximumFractionDigits?: number, fallback?: string }} [options]
 */
export function formatRupee(value, options = {}) {
  const {
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    fallback = `${RUPEE_SYMBOL}0`
  } = options;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return `${RUPEE_SYMBOL}${num.toLocaleString(DEFAULT_LOCALE, {
    minimumFractionDigits,
    maximumFractionDigits
  })}`;
}

/** e.g. ₹1,250.00 per kg */
export function formatRupeePerUnit(price, unit, options = {}) {
  const unitLabel = String(unit || 'unit').trim() || 'unit';
  return `${formatRupee(price, options)} per ${unitLabel}`;
}

/** Compact label for form fields: MRP (₹) */
export function rupeeFieldLabel(baseLabel) {
  const label = String(baseLabel || 'Price').trim();
  return label.includes('₹') ? label : `${label} (${RUPEE_SYMBOL})`;
}
