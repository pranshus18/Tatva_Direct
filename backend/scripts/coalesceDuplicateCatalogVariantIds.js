/**
 * Unify leftover duplicate variant keys / TSINs that are the same catalog variant.
 *
 * Usage (from backend/):
 *   node scripts/coalesceDuplicateCatalogVariantIds.js
 *   node scripts/coalesceDuplicateCatalogVariantIds.js --asin=TSPCYY1
 *   node scripts/coalesceDuplicateCatalogVariantIds.js --dry-run
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { coalesceSameCatalogVariantIdentitiesForProduct } from '../services/coalesceCatalogVariantIdentityService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const supabase = createClient(url, key);
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const asinArg = [...args].find((value) => value.startsWith('--asin='));
const productIdArg = [...args].find((value) => value.startsWith('--product-id='));
const filterAsin = asinArg ? asinArg.slice('--asin='.length).trim().toUpperCase() : '';
const filterProductId = productIdArg ? productIdArg.slice('--product-id='.length).trim() : '';

async function fetchAll(table, columns, apply = (query) => query) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const to = from + pageSize - 1;
    let query = apply(supabase.from(table).select(columns).range(from, to));
    const { data, error } = await query;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function main() {
  let productQuery = (query) => query.order('updated_at', { ascending: false });
  if (filterProductId) {
    productQuery = (query) => query.eq('id', filterProductId);
  } else if (filterAsin) {
    productQuery = (query) => query.eq('asin', filterAsin);
  }

  const products = await fetchAll(
    'products',
    'id, name, asin, specifications',
    productQuery
  );
  if (!products.length) {
    console.log('No matching products.');
    return;
  }

  let patchedProducts = 0;
  let patchedOffers = 0;
  for (const product of products) {
    if (dryRun) {
      const { data: offers, error } = await supabase
        .from('supplier_products')
        .select(
          'id, product_id, supplier_id, outlet_id, price, status, is_active, variant_key, variant_asin, product_variant_id, attributes, created_at'
        )
        .eq('product_id', product.id)
        .neq('status', 'rejected');
      if (error) throw error;
      const { planCatalogVariantIdentityCoalesce } = await import(
        '../services/coalesceCatalogVariantIdentityService.js'
      );
      const patches = planCatalogVariantIdentityCoalesce({
        parentAsin: product.asin || '',
        catalogSpecs: product.specifications || {},
        offers: offers || []
      });
      if (!patches.length) continue;
      patchedProducts += 1;
      patchedOffers += patches.length;
      console.log(
        `[dry-run] ${product.name} (${product.asin || product.id}) would update ${patches.length} offer(s):`,
        patches.map((patch) => ({
          id: patch.id,
          from: patch.from.variant_asin,
          to: patch.to.variant_asin,
          key: patch.to.variant_key
        }))
      );
      continue;
    }

    const { applied } = await coalesceSameCatalogVariantIdentitiesForProduct(supabase, {
      productId: product.id,
      parentAsin: product.asin || '',
      catalogSpecs: product.specifications || {}
    });
    if (!applied.length) continue;
    patchedProducts += 1;
    patchedOffers += applied.length;
    console.log(
      `Updated ${product.name} (${product.asin || product.id}):`,
      applied.map((patch) => `${patch.from?.variant_asin} → ${patch.to.variant_asin}`)
    );
  }

  console.log(
    `${dryRun ? 'Dry run: ' : ''}unified ${patchedOffers} offer(s) across ${patchedProducts} product(s).`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
