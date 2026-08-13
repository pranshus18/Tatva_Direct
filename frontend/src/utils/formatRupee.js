/** Indian Rupee display helpers — use for all user-visible prices. */
export const RUPEE_SYMBOL = '₹';

const DEFAULT_LOCALE = 'en-IN';

/** Round to paise so 19.99 × 3 is ₹59.97, not a float remainder. */
export function roundMoney(value) {
  const num = Number(value);
  const safe = Number.isFinite(num) ? num : 0;
  return Math.round(safe * 100) / 100;
}

/** Parse a price from number or Indian-formatted string (commas, ₹, Rs). */
export function parseMoney(raw) {
  if (raw === null || raw === undefined || raw === '') return 0;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return 0;
    return roundMoney(raw);
  }
  const text = String(raw).trim();
  if (!text) return 0;
  const stripped = text
    .replace(/₹/g, '')
    .replace(/,/g, '')
    .replace(/^\s*rs\.?\s*/i, '')
    .trim();
  const num = Number.parseFloat(stripped);
  if (!Number.isFinite(num) || num < 0) return 0;
  return roundMoney(num);
}

export function lineMoneyTotal(unitPrice, quantity) {
  const qty = Number(quantity);
  const safeQty = Number.isFinite(qty) ? qty : 0;
  return roundMoney(parseMoney(unitPrice) * safeQty);
}

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
  return `${RUPEE_SYMBOL}${roundMoney(num).toLocaleString(DEFAULT_LOCALE, {
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
