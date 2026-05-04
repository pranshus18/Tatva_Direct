# Catalog Onboarding Rollout

## 1) Apply migrations

Run these SQL files in order:

1. `migration_add_catalog_onboarding_guardrails.sql`
2. `migration_backfill_catalog_families_variants.sql`

## 2) Enable guardrails safely

Environment flags:

- `CATALOG_GUARDRAILS_ENABLED=true`
- `ONBOARDING_AUTO_APPROVE_THRESHOLD=0.8`

Set `CATALOG_GUARDRAILS_ENABLED=false` to temporarily fall back to legacy catalog commercial field sync.

## 3) Bootstrap spec templates

Create templates via admin endpoint:

- `POST /api/admin/spec-templates`

Each template should define strict keys and data type rules. Supplier onboarding endpoints only accept template keys.

## 4) Review queue operations

Use:

- `GET /api/admin/product-requests`
- `POST /api/admin/product-requests/:id/review`

Low-confidence onboarding runs are queued to `product_requests` and tracked in `product_ingestion_runs`.

## 5) Validation checks after cutover

- New supplier product rows should set `product_variant_id`.
- New uncertain submissions should create `product_requests`.
- `product_ingestion_runs` should have one row per onboarding attempt.
- No supplier commercial fields should overwrite canonical product fields when guardrails are enabled.
