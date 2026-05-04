/**
 * Backfill TSIN / Variant TSIN for existing rows.
 *
 * Usage (from backend/):
 *   node scripts/backfillTsinCodes.js
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { buildIdentityBundle, buildVariantAsinLikeId } from '../services/productIdentityService.js';

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

function cleanIdentifier(value) {
  return String(value || '').replace(/\s+/g, '').trim();
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

function buildProductIdentityInput(row) {
  const specs = normalizeObject(row.specifications);
  return {
    name: row.name || '',
    category: row.category || '',
    unit: row.unit || '',
    brand: row.brand || specs.brand || specs.brandModel || '',
    gtin: cleanIdentifier(row.gtin || specs.gtin || specs.upc || specs.ean || ''),
    mpn: row.mpn || specs.mpn || specs.modelNumber || specs.model_no || '',
    packSize: specs.packSize || specs.pack_size || '',
    brandModel: specs.brandModel || '',
    specifications: specs
  };
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
    specifications: specs,
    variantAttributes: specs
  };
}

async function main() {
  console.log('Loading products...');
  const products = await fetchAll(
    'products',
    'id, name, category, unit, specifications, brand, gtin, mpn, asin'
  );

  console.log(`Found ${products.length} product(s). Backfilling TSIN...`);

  const productById = new Map();
  for (const product of products) {
    productById.set(product.id, product);
  }

  let productUpdated = 0;
  let productFailed = 0;

  for (const product of products) {
    const identity = buildIdentityBundle(buildProductIdentityInput(product));
    const tsin = identity.asinLikeId;

    const patch = { asin: tsin };
    if (identity.catalog.gtin) patch.gtin = identity.catalog.gtin;
    if (identity.catalog.mpn) patch.mpn = identity.catalog.mpn;
    if (identity.catalog.brand) patch.brand = identity.catalog.brand;
    if (identity.catalogKey) patch.catalog_key = identity.catalogKey;

    const { error } = await supabase.from('products').update(patch).eq('id', product.id);
    if (error) {
      productFailed += 1;
      console.error(`❌ products ${product.id}: ${error.message}`);
      continue;
    }

    product.asin = tsin;
    productById.set(product.id, product);
    productUpdated += 1;
  }

  console.log(`Products done. updated=${productUpdated}, failed=${productFailed}`);

  console.log('Loading supplier_products...');
  const supplierProducts = await fetchAll(
    'supplier_products',
    'id, product_id, variant_key, variant_asin, attributes'
  );

  let supplierVariantUpdated = 0;
  let supplierVariantFailed = 0;

  for (const sp of supplierProducts) {
    const parent = productById.get(sp.product_id) || null;
    if (!parent) continue;

    const variantIdentity = buildIdentityBundle(buildVariantIdentityInput(sp, parent));
    const variantKey = sp.variant_key || variantIdentity.variantKey;
    const variantTsin = buildVariantAsinLikeId(parent.asin || '', variantKey);

    const patch = {
      variant_asin: variantTsin,
      variant_key: variantKey
    };

    const { error } = await supabase.from('supplier_products').update(patch).eq('id', sp.id);
    if (error) {
      supplierVariantFailed += 1;
      console.error(`❌ supplier_products ${sp.id}: ${error.message}`);
      continue;
    }

    supplierVariantUpdated += 1;
  }

  console.log(
    `Supplier variants done. updated=${supplierVariantUpdated}, failed=${supplierVariantFailed}`
  );

  console.log('Loading product_variants...');
  const productVariants = await fetchAll(
    'product_variants',
    'id, product_id, variant_key, variant_asin, canonical_attributes, gtin, mpn, unit, pack_size'
  );

  let productVariantUpdated = 0;
  let productVariantFailed = 0;

  for (const pv of productVariants) {
    const parent = productById.get(pv.product_id) || null;
    if (!parent) continue;

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

    const variantIdentity = buildIdentityBundle(variantInput);
    const variantKey = pv.variant_key || variantIdentity.variantKey;
    const variantTsin = buildVariantAsinLikeId(parent.asin || '', variantKey);

    const patch = {
      variant_asin: variantTsin,
      variant_key: variantKey
    };

    const { error } = await supabase.from('product_variants').update(patch).eq('id', pv.id);
    if (error) {
      productVariantFailed += 1;
      console.error(`❌ product_variants ${pv.id}: ${error.message}`);
      continue;
    }

    productVariantUpdated += 1;
  }

  console.log(
    `Product variants done. updated=${productVariantUpdated}, failed=${productVariantFailed}`
  );

  console.log('TSIN backfill completed.');
}

main().catch((err) => {
  console.error('Backfill failed:', err?.message || err);
  process.exit(1);
});

