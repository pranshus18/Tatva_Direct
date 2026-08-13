/**
 * Canonical INR money helpers. All stored and charged amounts are rounded to paise.
 */

export function roundMoney(value) {
  const num = Number(value);
  const safe = Number.isFinite(num) ? num : 0;
  return Math.round(safe * 100) / 100;
}

/**
 * Parse a price from number or string (Indian grouping commas, optional ₹ / Rs).
 * Invalid or negative values become 0.
 */
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

/** Line total: rounded unit price × quantity, then rounded to paise. */
export function lineMoneyTotal(unitPrice, quantity) {
  const qty = Number(quantity);
  const safeQty = Number.isFinite(qty) ? qty : 0;
  return roundMoney(parseMoney(unitPrice) * safeQty);
}
