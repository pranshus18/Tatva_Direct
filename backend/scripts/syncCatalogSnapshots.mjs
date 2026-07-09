#!/usr/bin/env node
/**
 * Backfill shared catalog `products.stock/price` from listed `supplier_products` offers.
 *
 * Usage:
 *   node backend/scripts/syncCatalogSnapshots.mjs
 *   node backend/scripts/syncCatalogSnapshots.mjs --product-id=<uuid>
 */
import { supabase } from '../config/supabase.js';
import { syncCatalogProductSnapshotFromOffers } from '../services/catalogOfferSnapshotService.js';

function parseArgs(argv) {
  const productIdArg = argv.find((arg) => arg.startsWith('--product-id='));
  return {
    productId: productIdArg ? productIdArg.split('=').slice(1).join('=').trim() : ''
  };
}

async function loadProductIds(productId) {
  if (productId) return [productId];

  const { data, error } = await supabase
    .from('supplier_products')
    .select('product_id')
    .neq('status', 'rejected');

  if (error) throw error;

  return [...new Set((data || []).map((row) => row?.product_id).filter(Boolean))];
}

async function main() {
  const { productId } = parseArgs(process.argv.slice(2));
  const productIds = await loadProductIds(productId);

  let synced = 0;
  let failed = 0;

  for (const id of productIds) {
    const result = await syncCatalogProductSnapshotFromOffers(supabase, id);
    if (result.ok) {
      synced += 1;
      console.log(`[ok] ${id} stock=${result.stock} price=${result.price}`);
    } else {
      failed += 1;
      console.error(`[fail] ${id} reason=${result.reason || 'unknown'}`);
    }
  }

  console.log(`Done. synced=${synced} failed=${failed} total=${productIds.length}`);
}

main().catch((error) => {
  console.error('syncCatalogSnapshots failed:', error?.message || error);
  process.exit(1);
});
