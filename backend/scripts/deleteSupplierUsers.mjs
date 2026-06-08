/**
 * Delete supplier accounts and related data.
 * Run: node scripts/deleteSupplierUsers.mjs ashu@gmail.com asian@gmail.com
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const emails = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['ashu@gmail.com', 'asian@gmail.com'];

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const PROFILE_BUCKET = process.env.SUPABASE_STORAGE_PROFILE_BUCKET || 'profile-photos';

async function deleteByColumn(table, column, value) {
  const { data, error: selErr } = await sb.from(table).select('id').eq(column, value);
  if (selErr) {
    const msg = String(selErr.message || '');
    if (msg.includes('does not exist') || msg.includes('schema cache')) return 0;
    throw new Error(`${table} select: ${selErr.message}`);
  }
  const ids = (data || []).map((r) => r.id).filter(Boolean);
  if (!ids.length) return 0;
  const { error: delErr } = await sb.from(table).delete().in('id', ids);
  if (delErr) throw new Error(`${table} delete: ${delErr.message}`);
  return ids.length;
}

async function deleteOrdersForSupplier(supplierId) {
  const { data: orders, error } = await sb.from('orders').select('id').eq('supplier_id', supplierId);
  if (error) throw error;
  const orderIds = (orders || []).map((o) => o.id);
  if (!orderIds.length) return 0;

  for (const table of ['order_items', 'order_returns', 'payments', 'payment_receipts', 'invoices', 'ledger_entries']) {
    try {
      const { error: delErr } = await sb.from(table).delete().in('order_id', orderIds);
      if (!delErr) console.log(`  ${table} (by order): cleared`);
    } catch {
      /* table may not exist */
    }
  }

  try {
    const { error: notifErr } = await sb.from('notifications').delete().in('related_order_id', orderIds);
    if (!notifErr) console.log('  notifications (by order): cleared');
  } catch {
    /* optional */
  }

  const { error: ordDelErr } = await sb.from('orders').delete().in('id', orderIds);
  if (ordDelErr) throw new Error(`orders delete: ${ordDelErr.message}`);
  return orderIds.length;
}

async function clearUserReferences(userId) {
  const refTables = [
    ['categories', 'created_by'],
    ['units', 'created_by'],
    ['brands', 'approved_by'],
    ['products', 'approved_by'],
    ['category_supply_chains', 'updated_by'],
    ['model_spec_profiles', 'created_by'],
    ['model_spec_profiles', 'updated_by']
  ];

  for (const [table, column] of refTables) {
    const { error } = await sb.from(table).update({ [column]: null }).eq(column, userId);
    if (!error) {
      const { count } = await sb.from(table).select('*', { count: 'exact', head: true }).eq(column, userId);
      if (count === 0) continue;
    }
  }

  const { data: catRows } = await sb.from('categories').select('id,name').eq('created_by', userId);
  if (catRows?.length) {
    await sb.from('categories').update({ created_by: null }).eq('created_by', userId);
    console.log(`  categories.created_by: cleared (${catRows.length})`);
  }

  const { data: unitRows } = await sb.from('units').select('id').eq('created_by', userId);
  if (unitRows?.length) {
    await sb.from('units').update({ created_by: null }).eq('created_by', userId);
    console.log(`  units.created_by: cleared (${unitRows.length})`);
  }
}

async function removeProfileStorage(userId) {
  try {
    const { data: files } = await sb.storage.from(PROFILE_BUCKET).list(userId, { limit: 100 });
    if (files?.length) {
      const paths = files.map((f) => `${userId}/${f.name}`);
      await sb.storage.from(PROFILE_BUCKET).remove(paths);
      console.log(`  profile-photos: removed ${paths.length} file(s)`);
    }
  } catch (e) {
    console.warn(`  profile-photos skip: ${e.message}`);
  }
}

async function deleteUserAccount(user) {
  const { id: userId, email } = user;
  console.log(`\nDeleting ${email} (${userId})...`);

  const ordersDeleted = await deleteOrdersForSupplier(userId);
  if (ordersDeleted) console.log(`  orders: ${ordersDeleted}`);

  const tables = [
    ['invoices', 'supplier_id'],
    ['payments', 'supplier_id'],
    ['payment_receipts', 'supplier_id'],
    ['supplier_products', 'supplier_id'],
    ['supplier_bcov_levels', 'supplier_id'],
    ['supplier_credit_accounts', 'supplier_id'],
    ['supplier_credit_accounts', 'buyer_user_id'],
    ['inventory_movements', 'supplier_id'],
    ['outlets', 'supplier_id'],
    ['notifications', 'user_id'],
    ['notifications', 'related_supplier_id'],
    ['supplier_chain_profile_requests', 'user_id'],
    ['products', 'supplier_id'],
    ['brands', 'requested_by'],
    ['po_carts', 'service_provider_id'],
    ['product_ingestion_runs', 'supplier_id'],
    ['catalog_onboarding_reviews', 'supplier_id'],
    ['product_onboarding_events', 'supplier_id']
  ];

  for (const [table, column] of tables) {
    const n = await deleteByColumn(table, column, userId);
    if (n) console.log(`  ${table}.${column}: ${n}`);
  }

  await clearUserReferences(userId);
  await removeProfileStorage(userId);

  const refColumns = [
    'supplier_id',
    'user_id',
    'service_provider_id',
    'buyer_user_id',
    'created_by',
    'requested_by',
    'related_supplier_id'
  ];

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const { error: dbDelErr } = await sb.from('users').delete().eq('id', userId);
    if (!dbDelErr) {
      console.log('  users row: deleted');
      break;
    }

    const tableMatch = String(dbDelErr.message || '').match(/on table "([^"]+)"/i);
    if (!tableMatch) throw new Error(`users delete: ${dbDelErr.message}`);

    const table = tableMatch[1];
    let cleared = 0;
    for (const column of refColumns) {
      cleared += await deleteByColumn(table, column, userId);
      if (cleared > 0) break;
    }
    if (!cleared) {
      const nulled = await sb.from(table).update({ supplier_id: null }).eq('supplier_id', userId);
      if (!nulled.error) cleared = 1;
    }
    if (!cleared) throw new Error(`users delete blocked by ${table}: ${dbDelErr.message}`);
    console.log(`  ${table}: cleared blocker (attempt ${attempt + 1})`);
  }

  const { error: authDelErr } = await sb.auth.admin.deleteUser(userId);
  if (authDelErr) {
    console.warn(`  auth user: ${authDelErr.message} (DB row already removed)`);
  } else {
    console.log('  auth user: deleted');
  }
}

async function main() {
  const { data: users, error } = await sb.from('users').select('id,email,user_type').in('email', emails);
  if (error) throw error;
  if (!users?.length) {
    console.log('No matching users found for:', emails.join(', '));
    return;
  }

  for (const user of users) {
    await deleteUserAccount(user);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
