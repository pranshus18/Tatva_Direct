/**
 * Backfill TSIN / Variant TSIN to current format:
 *   Product: TS + 5 alphanumeric chars
 *   Variant: product TSIN + 2 alphanumeric chars
 *
 * Usage (from backend/):
 *   node scripts/backfillTsinCodes.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { buildSupplierVariantIdentity } from '../services/productIdentityService.js';
import {
  persistCurrentCatalogTsin,
  persistCurrentProductVariantTsin,
  persistCurrentVariantTsin
} from '../services/tsinUpgradeService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in backend/.env');
  process.exit(1);
}

const supabase = createClient(url, key);

const PAGE_SIZE = 1000;

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function fetchAll(table, selectColumns) {
  const rows = [];
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from(table)
      .select(selectColumns)
      .range(from, to);

    if (error) throw error;
    if (!data || data.length === 0) break;

    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

function buildVariantIdentityInput(row, parentProduct = null) {
  const attrs = normalizeObject(row.attributes || row.canonical_attributes);
  const specs = normalizeObject(attrs.specifications || attrs.variantAttributes || {});
  return {
    brandModel: attrs.brandModel || attrs.brand_model || '',
    gtin: attrs.gtin || parentProduct?.gtin || '',
    mpn: attrs.mpn || attrs.modelNumber || attrs.model_no || parentProduct?.mpn || '',
    sku: attrs.sku || attrs.skuNo || attrs.gsku || '',
    unit: attrs.unit || row.unit || row.pack_unit || parentProduct?.unit || '',
    packSize: attrs.packSize || attrs.pack_size || row.pack_size || '',
    specifications: specs
  };
}

async function main() {
  console.log('Loading products...');
  const products = await fetchAll(
    'products',
    'id, name, category, unit, specifications, brand, gtin, mpn, asin'
  );

  console.log(`Found ${products.length} product(s). Upgrading product TSINs to TS + 5 chars...`);

  const productById = new Map();
  const usedAsins = new Set();
  let productUpdated = 0;
  let productUnchanged = 0;

  for (const product of products) {
    const previous = String(product.asin || '').trim().toUpperCase();
    const next = await persistCurrentCatalogTsin(supabase, product, usedAsins);
    productById.set(product.id, product);
    if (next && next !== previous) productUpdated += 1;
    else productUnchanged += 1;
  }

  console.log(`Products done. updated=${productUpdated}, unchanged=${productUnchanged}`);

  console.log('Loading supplier_products...');
  const supplierProducts = await fetchAll(
    'supplier_products',
    'id, product_id, variant_key, variant_asin, attributes'
  );

  let supplierVariantUpdated = 0;
  let supplierVariantUnchanged = 0;

  for (const sp of supplierProducts) {
    const parent = productById.get(sp.product_id) || null;
    if (!parent) continue;

    if (!String(sp.variant_key || '').trim()) {
      const variantIdentity = buildSupplierVariantIdentity(
        buildVariantIdentityInput(sp, parent),
        parent
      );
      sp.variant_key = variantIdentity.variantKey;
      await supabase
        .from('supplier_products')
        .update({ variant_key: sp.variant_key })
        .eq('id', sp.id);
    }

    const previous = String(sp.variant_asin || '').trim().toUpperCase();
    const next = await persistCurrentVariantTsin(supabase, sp, parent.asin || '');
    if (next && next !== previous) supplierVariantUpdated += 1;
    else supplierVariantUnchanged += 1;
  }

  console.log(
    `Supplier variants done. updated=${supplierVariantUpdated}, unchanged=${supplierVariantUnchanged}`
  );

  console.log('Loading product_variants...');
  const productVariants = await fetchAll(
    'product_variants',
    'id, product_id, variant_key, variant_asin, canonical_attributes, gtin, mpn, unit, pack_size'
  );

  let productVariantUpdated = 0;
  let productVariantUnchanged = 0;

  for (const pv of productVariants) {
    const parent = productById.get(pv.product_id) || null;
    if (!parent) continue;

    if (!String(pv.variant_key || '').trim()) {
      const variantInput = buildVariantIdentityInput(
        {
          ...pv,
          attributes: {
            ...normalizeObject(pv.canonical_attributes),
            gtin: pv.gtin,
            mpn: pv.mpn,
            unit: pv.unit,
            packSize: pv.pack_size
          }
        },
        parent
      );
      pv.variant_key = buildSupplierVariantIdentity(variantInput, parent).variantKey;
      await supabase.from('product_variants').update({ variant_key: pv.variant_key }).eq('id', pv.id);
    }

    const previous = String(pv.variant_asin || '').trim().toUpperCase();
    const next = await persistCurrentProductVariantTsin(supabase, pv, parent.asin || '');
    if (next && next !== previous) productVariantUpdated += 1;
    else productVariantUnchanged += 1;
  }

  console.log(
    `Product variants done. updated=${productVariantUpdated}, unchanged=${productVariantUnchanged}`
  );

  console.log('TSIN upgrade completed. Format is now TS + 5 product chars + 2 variant chars.');
}

main().catch((err) => {
  console.error('Backfill failed:', err?.message || err);
  process.exit(1);
});
