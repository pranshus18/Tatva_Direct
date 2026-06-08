/**
 * Remove Asian Paints catalog, brands, supply-chain config, and profile references.
 * Run: node scripts/removeAsianPaintsData.mjs
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const BUCKET = process.env.SUPABASE_STORAGE_PRODUCT_BUCKET || 'product-images';

const ASIAN_PAINT_PATTERN = /asian\s*paints?/i;

function isAsianPaintsText(value) {
  return ASIAN_PAINT_PATTERN.test(String(value || '').trim());
}

function stripAsianFromBrandsString(brands) {
  const parts = String(brands || '')
    .split(/[,;|]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !isAsianPaintsText(p));
  return parts.join(', ');
}

function cleanCompanyInfoEntries(entries) {
  if (!Array.isArray(entries)) return entries;
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    const next = { ...entry };
    if (next.brands) next.brands = stripAsianFromBrandsString(next.brands);
    if (next.brand) next.brand = stripAsianFromBrandsString(next.brand);
    return next;
  });
}

function branchToAddress(profile) {
  const branch = profile?.branches?.[0] || {};
  return {
    line1: String(branch.address || branch.name || 'Address').trim(),
    city: String(branch.city || '').trim(),
    state: String(branch.state || '').trim(),
    pincode: String(branch.zipCode || branch.pincode || '').trim(),
    country: String(branch.country || 'India').trim()
  };
}

async function deleteWhere(table, filterFn) {
  const { data, error } = await sb.from(table).select('*');
  if (error) throw new Error(`${table} select: ${error.message}`);
  const rows = (data || []).filter(filterFn);
  if (!rows.length) return 0;
  const ids = rows.map((r) => r.id);
  const { error: delError } = await sb.from(table).delete().in('id', ids);
  if (delError) throw new Error(`${table} delete: ${delError.message}`);
  return rows.length;
}

async function deleteByIds(table, ids) {
  if (!ids.length) return 0;
  const { error } = await sb.from(table).delete().in('id', ids);
  if (error) throw new Error(`${table} delete: ${error.message}`);
  return ids.length;
}

async function main() {
  console.log('Finding Asian Paints products...');
  const { data: products, error: prodErr } = await sb
    .from('products')
    .select('id,name,supplier_id,family_id,images')
    .or('name.ilike.%asian%paint%,name.ilike.%asian paints%');
  if (prodErr) throw prodErr;

  const productIds = (products || []).map((p) => p.id);
  console.log('Products to remove:', products?.map((p) => p.name) || []);

  const { data: supplierProducts } = await sb
    .from('supplier_products')
    .select('id,product_id,supplier_id')
    .in('product_id', productIds.length ? productIds : ['00000000-0000-0000-0000-000000000000']);
  const spIds = (supplierProducts || []).map((r) => r.id);

  const { data: variants } = await sb
    .from('product_variants')
    .select('id,family_id,product_id')
    .in('product_id', productIds.length ? productIds : ['00000000-0000-0000-0000-000000000000']);
  const variantIds = (variants || []).map((v) => v.id);
  const familyIds = [...new Set((variants || []).map((v) => v.family_id).filter(Boolean))];

  if (spIds.length) {
    const n = await deleteByIds('order_items', (
      await sb.from('order_items').select('id').in('supplier_product_id', spIds)
    ).data?.map((r) => r.id) || []);
    console.log('Deleted order_items:', n);

    const invIds =
      (await sb.from('inventory_movements').select('id').in('supplier_product_id', spIds)).data?.map((r) => r.id) ||
      [];
    const invIds2 =
      productIds.length
        ? (await sb.from('inventory_movements').select('id').in('product_id', productIds)).data?.map((r) => r.id) ||
          []
        : [];
    console.log('Deleted inventory_movements:', await deleteByIds('inventory_movements', [...new Set([...invIds, ...invIds2])]));

    console.log('Deleted supplier_products:', await deleteByIds('supplier_products', spIds));
  }

  const bcovDeleted = await deleteWhere(
    'supplier_bcov_levels',
    (r) =>
      isAsianPaintsText(r.brand_name) ||
      isAsianPaintsText(r.normalized_brand) ||
      isAsianPaintsText(r.variant_name) ||
      /asian\s*aint/i.test(String(r.normalized_brand || ''))
  );
  console.log('Deleted supplier_bcov_levels:', bcovDeleted);

  if (productIds.length) {
    const { error: boqUpdErr } = await sb
      .from('boq_items')
      .update({ normalized_product_id: null })
      .in('normalized_product_id', productIds);
    if (boqUpdErr) throw new Error(`boq_items update: ${boqUpdErr.message}`);
    const boqCleared = (
      await sb.from('boq_items').select('id', { count: 'exact', head: true }).in('normalized_product_id', productIds)
    ).count;
    console.log('Cleared boq_items.normalized_product_id (remaining refs):', boqCleared ?? 0);

    for (const table of ['catalog_onboarding_reviews', 'product_onboarding_events']) {
      const { error: clrErr } = await sb.from(table).update({ resolved_product_id: null }).in('resolved_product_id', productIds);
      if (!clrErr) console.log(`Cleared ${table}.resolved_product_id`);
    }

    const { error: dupErr } = await sb
      .from('products')
      .update({ duplicate_of_product_id: null })
      .in('duplicate_of_product_id', productIds);
    if (!dupErr) console.log('Cleared products.duplicate_of_product_id refs');

    const notifIds =
      (await sb.from('notifications').select('id').in('related_product_id', productIds)).data?.map((r) => r.id) || [];
    if (notifIds.length) {
      console.log('Deleted notifications:', await deleteByIds('notifications', notifIds));
    }

    const { error: notifClrErr } = await sb
      .from('notifications')
      .update({ related_product_id: null })
      .in('related_product_id', productIds);
    if (!notifClrErr) console.log('Cleared notifications.related_product_id');

    for (const { table, column } of [
      { table: 'product_requests', column: 'resolved_product_id' },
      { table: 'service_provider_product_requests', column: 'resolved_product_id' },
      { table: 'service_provider_product_requests', column: 'product_id' }
    ]) {
      const { error } = await sb.from(table).update({ [column]: null }).in(column, productIds);
      if (!error) console.log(`Cleared ${table}.${column}`);
    }

    const prDel =
      (await sb.from('product_requests').select('id').in('resolved_product_id', productIds)).data?.map((r) => r.id) ||
      [];
    if (prDel.length) console.log('Deleted product_requests:', await deleteByIds('product_requests', prDel));

    if (variantIds.length) {
      await sb.from('product_requests').update({ resolved_variant_id: null }).in('resolved_variant_id', variantIds);
    }

    console.log('Deleted products:', await deleteByIds('products', productIds));
  }

  if (variantIds.length) {
    console.log('Deleted product_variants:', await deleteByIds('product_variants', variantIds));
  }

  if (familyIds.length) {
    console.log('Deleted product_families:', await deleteByIds('product_families', familyIds));
  }

  const brandDeleted = await deleteWhere(
    'brands',
    (r) => isAsianPaintsText(r.name) || isAsianPaintsText(r.normalized_name)
  );
  console.log('Deleted brands:', brandDeleted);

  const chainDeleted = await deleteWhere('category_supply_chains', (r) => isAsianPaintsText(r.category_name));
  console.log('Deleted category_supply_chains:', chainDeleted);

  // Clean user profiles
  const { data: users, error: userErr } = await sb.from('users').select('id,email,profile');
  if (userErr) throw userErr;

  let profilesUpdated = 0;
  for (const user of users || []) {
    const profile = user.profile || {};
    const profileJson = JSON.stringify(profile).toLowerCase();
    if (!profileJson.includes('asian')) continue;

    const nextProfile = { ...profile };
    let changed = false;

    if (isAsianPaintsText(nextProfile.brands) || stripAsianFromBrandsString(nextProfile.brands) !== String(nextProfile.brands || '')) {
      nextProfile.brands = stripAsianFromBrandsString(nextProfile.brands);
      changed = true;
    }

    const cleanedEntries = cleanCompanyInfoEntries(nextProfile.companyInfoEntries);
    if (JSON.stringify(cleanedEntries) !== JSON.stringify(nextProfile.companyInfoEntries)) {
      nextProfile.companyInfoEntries = cleanedEntries;
      changed = true;
    }

    if (!changed) continue;

    const updatePayload = { profile: nextProfile };
    const address = branchToAddress(nextProfile);
    if (address.line1 && address.city && address.state && address.pincode && address.country) {
      updatePayload.address = address;
    }

    const { error: updErr } = await sb.from('users').update(updatePayload).eq('id', user.id);
    if (updErr) throw updErr;
    profilesUpdated += 1;
    console.log('Updated profile:', user.email);
  }
  console.log('Profiles updated:', profilesUpdated);

  // Storage cleanup for product image folders
  if (productIds.length) {
    const prefixes = new Set(productIds);
    for (const sp of supplierProducts || []) {
      prefixes.add(`${sp.supplier_id}/${sp.product_id}`);
    }
    for (const prefix of prefixes) {
      try {
        const { data: files } = await sb.storage.from(BUCKET).list(prefix, { limit: 100 });
        if (files?.length) {
          const paths = files.map((f) => `${prefix}/${f.name}`);
          await sb.storage.from(BUCKET).remove(paths);
          console.log('Removed storage files:', paths.length, 'under', prefix);
        }
      } catch (e) {
        console.warn('Storage skip', prefix, e.message);
      }
    }
  }

  console.log('Asian Paints data removal complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
