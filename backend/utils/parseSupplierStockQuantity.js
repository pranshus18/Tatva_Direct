/**
 * Parse supplier "Current stock with you" as a non-negative whole number.
 * Returns null when the value cannot be interpreted safely.
 */
export function parseSupplierStockQuantity(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    return Math.trunc(raw);
  }
  let s = String(raw).trim();
  if (!s) return null;
  s = s.replace(/,/g, '');
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}
