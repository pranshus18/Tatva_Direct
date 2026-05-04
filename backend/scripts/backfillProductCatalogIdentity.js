/**
 * One-off: fill products.asin, catalog_key, and optional gtin/mpn/brand
 * from existing name/category/unit/specifications (same rules as supplier POST).
 *
 * Usage (from backend/):
 *   node scripts/backfillProductCatalogIdentity.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { buildIdentityBundle } from '../services/productIdentityService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const supabase = createClient(url, key);

const stripGtin = (value) => String(value || '').replace(/\s+/g, '').trim();

async function main() {
  const { data: rows, error } = await supabase
    .from('products')
    .select('id, name, category, unit, specifications')
    .or('asin.is.null,catalog_key.is.null');

  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }

  if (!rows?.length) {
    console.log('No products need catalog identity backfill.');
    return;
  }

  console.log(`Backfilling catalog identity for ${rows.length} product(s)...`);

  for (const row of rows) {
    const specs = row.specifications && typeof row.specifications === 'object' ? row.specifications : {};
    const brandInput = String(specs.brand || specs.brandModel || '').trim();
    const mpnInput = String(
      specs.mpn || specs.modelNumber || specs.model_no || ''
    ).trim();
    const gtinInput = stripGtin(specs.gtin || specs.upc || specs.ean || '');

    const identityBundle = buildIdentityBundle({
      name: row.name,
      category: row.category,
      brand: brandInput,
      gtin: gtinInput,
      mpn: mpnInput,
      unit: row.unit,
      packSize: specs.packSize || specs.pack_size || '',
      brandModel: specs.brandModel,
      specifications: specs
    });

    const patch = {
      asin: identityBundle.asinLikeId,
      catalog_key: identityBundle.catalogKey
    };
    if (identityBundle.catalog.gtin) patch.gtin = identityBundle.catalog.gtin;
    if (identityBundle.catalog.mpn) patch.mpn = identityBundle.catalog.mpn;
    if (identityBundle.catalog.brand) patch.brand = identityBundle.catalog.brand;

    const { error: upErr } = await supabase.from('products').update(patch).eq('id', row.id);
    if (upErr) {
      console.error(`  ${row.id} (${row.name}):`, upErr.message);
    } else {
      console.log(`  OK ${row.name} → asin=${patch.asin}, catalog_key set`);
    }
  }

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
