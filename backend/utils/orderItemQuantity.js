/**
 * Total ordered units across line items — not the number of product rows.
 * Qty 2 of one product is 2 items, not 1.
 */
export function sumOrderItemQuantities(items = []) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const qty = Number(item?.quantity);
    return sum + (Number.isFinite(qty) && qty > 0 ? qty : 0);
  }, 0);
}
