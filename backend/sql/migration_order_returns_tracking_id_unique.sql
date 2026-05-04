-- ============================================
-- MIGRATION: Enforce unique return tracking IDs
-- ============================================

-- 1) Normalize blank tracking values to NULL so they don't interfere.
UPDATE order_returns
SET tracking_id = NULL
WHERE tracking_id IS NOT NULL
  AND btrim(tracking_id) = '';

-- 2) Deduplicate existing non-null tracking IDs before adding unique index.
-- Keeps the earliest row unchanged; appends suffix for later duplicates.
WITH ranked AS (
  SELECT
    id,
    tracking_id,
    ROW_NUMBER() OVER (
      PARTITION BY lower(btrim(tracking_id))
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM order_returns
  WHERE tracking_id IS NOT NULL
    AND btrim(tracking_id) <> ''
),
dups AS (
  SELECT id, tracking_id, rn
  FROM ranked
  WHERE rn > 1
)
UPDATE order_returns r
SET tracking_id = concat(r.tracking_id, '-D', d.rn)
FROM dups d
WHERE r.id = d.id;

-- 3) Enforce uniqueness for all future non-null tracking IDs.
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_returns_tracking_id
  ON order_returns (tracking_id)
  WHERE tracking_id IS NOT NULL;
