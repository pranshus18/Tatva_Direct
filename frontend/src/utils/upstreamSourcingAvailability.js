import { normalizeSupplierProductKey } from './supplierProductRow';

const DEFAULT_UNAVAILABLE_REASON =
  'No eligible upstream supplier exists for this product.';

/**
 * Map mine listing ids that cannot be sourced because the suggestion has no
 * eligible upstream offers. Used to drop them from the selected-for-sourcing set.
 */
export function collectUnavailableSourcingMineIds(suggestionItems, getEligibleOfferCount) {
  const unavailable = {};
  for (const item of Array.isArray(suggestionItems) ? suggestionItems : []) {
    const mineId = normalizeSupplierProductKey(item?.mineSupplierProductId);
    if (!mineId) continue;
    const count =
      typeof getEligibleOfferCount === 'function'
        ? Number(getEligibleOfferCount(item)) || 0
        : Array.isArray(item?.upstreamOffers)
          ? item.upstreamOffers.length
          : 0;
    if (count > 0) continue;
    unavailable[mineId] =
      String(item?.message || '').trim() || DEFAULT_UNAVAILABLE_REASON;
  }
  return unavailable;
}

/** Remove unavailable mine ids from a selectedMine / offer-pick map. */
export function dropUnavailableFromSelection(selectionMap, unavailableMap) {
  const next = { ...(selectionMap && typeof selectionMap === 'object' ? selectionMap : {}) };
  let changed = false;
  for (const key of Object.keys(unavailableMap || {})) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      delete next[key];
      changed = true;
    }
  }
  return changed ? next : selectionMap && typeof selectionMap === 'object' ? selectionMap : {};
}
