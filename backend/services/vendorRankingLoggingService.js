export function logItemVendorResult({ itemId, itemName, validVendors }) {
  console.log(`[Vendor Ranking] Item "${itemName}" (ID: ${itemId}): ${validVendors.length} valid vendors found`);
}

export function logNoVendorsDebug({ itemId, itemName, vendors, referenceProduct }) {
  console.log(`[Vendor Ranking] No suppliers available for item "${itemName}" (ID: ${itemId})`);
  console.log(`[Vendor Ranking] Total vendors before filtering: ${vendors.length}`);
  console.log(`[Vendor Ranking] Has reference product: ${!!referenceProduct}`);
  if (referenceProduct) {
    console.log(`[Vendor Ranking] Reference product has supplier: ${!!referenceProduct.supplier}`);
    console.log(`[Vendor Ranking] Reference product price: ${referenceProduct.price}`);
    console.log(`[Vendor Ranking] Reference product status: ${referenceProduct.status}`);
  }
  if (vendors.length > 0) {
    console.log('[Vendor Ranking] Sample vendor data:', JSON.stringify(vendors[0], null, 2));
  }
}

export function logVendorRankingSummary({ items, itemVendors }) {
  console.log('[Vendor Ranking] ========== SUMMARY ==========');
  console.log(`[Vendor Ranking] Total items processed: ${items.length}`);
  Object.keys(itemVendors).forEach((itemId) => {
    const vendors = itemVendors[itemId];
    const item = items.find((i) => (i.id?.toString() || String(i.id)) === itemId);
    const itemName = item?.normalizedName || item?.rawName || itemId;
    console.log(`[Vendor Ranking] Item "${itemName}" (ID: ${itemId}): ${vendors?.length || 0} vendors`);
  });
  console.log('[Vendor Ranking] ============================');
}
