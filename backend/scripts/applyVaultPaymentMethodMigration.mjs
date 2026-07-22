#!/usr/bin/env node
/**
 * Prints the SQL required to switch orders.payment_method from wallet → vault.
 * Paste into Supabase → SQL Editor → Run.
 *
 * Optional: DATABASE_URL=... node scripts/applyVaultPaymentMethodMigration.mjs
 * (requires the `pg` package)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const sqlPath = path.join(__dirname, '../sql/migration_payment_method_wallet_to_vault.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const databaseUrl = String(process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '').trim();

if (!databaseUrl) {
  console.log('--- Copy/paste this into Supabase SQL Editor ---\n');
  console.log(sql);
  console.log('\n--- end ---');
  process.exit(0);
}

try {
  const pg = await import('pg');
  const client = new pg.default.Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log('Applied migration_payment_method_wallet_to_vault.sql');
  } finally {
    await client.end();
  }
} catch (error) {
  console.error(error.message || error);
  console.error('\nInstall pg (`npm i pg`) or run the SQL manually in Supabase SQL Editor.');
  process.exit(1);
}
