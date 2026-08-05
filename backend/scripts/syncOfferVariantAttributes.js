/**
 * Backfill: align supplier_products.attributes.variantAttributes with attributes.specifications.
 * Run from backend/: node scripts/syncOfferVariantAttributes.js
 */
import { supabase } from '../config/supabase.js';
import { syncOfferAttributesWithSpecifications } from '../services/productIdentityService.js';
import { parseSupplierOfferAttributes } from '../services/supplierCatalogHelpersService.js';

const BATCH_SIZE = 200;

function attributesDiffer(before = {}, after = {}) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

async function main() {
  let offset = 0;
  let scanned = 0;
  let updated = 0;

  while (true) {
    const { data: rows, error } = await supabase
      .from('supplier_products')
      .select('id, attributes')
      .order('id', { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Fetch failed:', error.message);
      process.exit(1);
    }
    if (!rows?.length) break;

    for (const row of rows) {
      scanned += 1;
      const current = parseSupplierOfferAttributes(row.attributes);
      const synced = syncOfferAttributesWithSpecifications(current);
      if (!attributesDiffer(current, synced)) continue;

      const { error: updateError } = await supabase
        .from('supplier_products')
        .update({ attributes: synced, updated_at: new Date().toISOString() })
        .eq('id', row.id);

      if (updateError) {
        console.error(`Failed to update offer ${row.id}:`, updateError.message);
        continue;
      }
      updated += 1;
    }

    offset += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`Scanned ${scanned} supplier offer(s); synced ${updated} stale variantAttributes row(s).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
