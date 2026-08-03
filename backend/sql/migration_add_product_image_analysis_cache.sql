-- Shared cache for supplier product photo AI analysis.
-- Same image bytes (any upload order) reuse one stored extraction for all suppliers.

CREATE TABLE IF NOT EXISTS product_image_analysis_cache (
  image_set_hash TEXT PRIMARY KEY,
  image_count INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'gemini',
  model_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  response_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_image_analysis_cache_updated
  ON product_image_analysis_cache (updated_at DESC);
