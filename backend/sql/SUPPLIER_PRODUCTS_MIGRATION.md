# Supplier Products Junction Table Migration

## Overview
This migration enables multiple suppliers to offer the same product with different prices, stock, and locations while maintaining the same product ID for identical products.

## Database Changes

### New Table: `supplier_products`
A junction table that links suppliers to products with supplier-specific data:
- `product_id` - References the shared product
- `supplier_id` - References the supplier
- `price` - Supplier's price for this product
- `stock` - Supplier's stock level
- `location` - Supplier's location
- `status` - Approval status (pending/approved/rejected)
- `is_active` - Whether this supplier's offering is active

### Products Table
The `products` table now stores only shared product information:
- `name`, `description`, `category`, `unit`, `specifications`
- Supplier-specific fields (`price`, `stock`, `location`, `supplier_id`, `status`) are moved to `supplier_products`

## Migration Steps

1. **Run the migration SQL:**
   ```bash
   psql -d your_database -f backend/sql/migration_add_supplier_products.sql
   ```
   Or execute the SQL file in your Supabase SQL editor.

2. **Allow per-location offers (if not already applied):**
   ```bash
   psql -d your_database -f backend/sql/migration_update_supplier_products_unique_location.sql
   ```

3. **Add variation-aware uniqueness (Phase 2):**
   ```bash
   psql -d your_database -f backend/sql/migration_add_supplier_products_variant_key.sql
   ```
   This migration:
   - Adds `supplier_products.variant_key`
   - Backfills deterministic variant keys from `attributes`
   - Preserves existing duplicate rows safely
   - Enforces unique constraint on:
     - `(product_id, supplier_id, location, variant_key)`

4. **Add catalog identity columns (ASIN-style + strong identifiers):**
   ```bash
   psql -d your_database -f backend/sql/migration_add_products_identity_columns.sql
   ```

5. **Refresh variant keys with admin specifications (recommended):**
   ```bash
   psql -d your_database -f backend/sql/migration_refresh_variant_key_with_specs.sql
   ```
   This updates `variant_key` so specification values (color/ram/storage/etc.)
   also participate in variation uniqueness.

6. **Add variation number (child ASIN-like):**
   ```bash
   psql -d your_database -f backend/sql/migration_add_supplier_products_variant_asin.sql
   ```
   This adds `supplier_products.variant_asin` so each exact variation has a stable
   identifier number.

7. **Add return workflow table (recommended for tracking):**
   ```bash
   psql -d your_database -f backend/sql/migration_add_order_returns.sql
   ```
   This enables service-provider return requests and supplier return processing.

8. **The migration set will:**
   - Create the `supplier_products` table
   - Migrate existing data from `products` to `supplier_products`
   - Create necessary indexes
   - Set up triggers
   - Add variation identity and uniqueness via `variant_key`

## How It Works

### Product Creation Flow

1. **Check for existing product:**
   - System generates a deterministic product ID based on name + category + specifications
   - If product with that ID exists, use it
   - If not, create new product with shared data only

2. **Create supplier_products entry:**
   - Always create a new entry in `supplier_products` with supplier-specific data
   - Each supplier can have their own price, stock, location for the same product
   - Same product ID is reused for all suppliers

### Example Scenario

**Supplier A adds "Steel Bar 10mm":**
- Product created with ID: `abc-123-def-456`
- Supplier_products entry: Supplier A, Price: ₹500, Stock: 100

**Supplier B adds "Steel Bar 10mm" (same specs):**
- Product ID reused: `abc-123-def-456` (same ID!)
- New supplier_products entry: Supplier B, Price: ₹450, Stock: 200

Both suppliers now offer the same product (same ID) with different pricing and stock.

## API Changes

### POST `/api/supplier/products`
- Now creates/uses shared product and creates supplier_products entry
- Returns combined product data with supplier-specific fields

### GET `/api/supplier/products`
- Now joins `products` with `supplier_products` to get supplier's offerings
- Returns products with supplier-specific pricing, stock, location

## Notes

- The `products` table still has `supplier_id` for backward compatibility
- New products should use the `supplier_products` table
- Existing queries may need updates to join with `supplier_products` where supplier-specific data is needed
