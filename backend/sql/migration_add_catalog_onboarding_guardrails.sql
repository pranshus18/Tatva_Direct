-- ============================================
-- MIGRATION: Catalog onboarding guardrails
-- ============================================
-- Adds canonical family/variant model, spec templates, request workflow,
-- and AI ingestion audit tables for Amazon-style onboarding.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Canonical family table (base model line)
CREATE TABLE IF NOT EXISTS product_families (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  canonical_name VARCHAR(200) NOT NULL,
  brand VARCHAR(120),
  category VARCHAR(80) NOT NULL,
  model_line VARCHAR(160),
  normalized_family_key VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'retired')),
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (normalized_family_key)
);

CREATE INDEX IF NOT EXISTS idx_product_families_category ON product_families(category);
CREATE INDEX IF NOT EXISTS idx_product_families_brand ON product_families(brand);

-- 2) Canonical variants table (exact model/variation identity)
CREATE TABLE IF NOT EXISTS product_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_id UUID NOT NULL REFERENCES product_families(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_name VARCHAR(220),
  variant_key VARCHAR(128) NOT NULL,
  variant_asin VARCHAR(32),
  gtin VARCHAR(64),
  mpn VARCHAR(128),
  brand VARCHAR(120),
  unit VARCHAR(20),
  pack_size VARCHAR(80),
  canonical_attributes JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'review_pending' CHECK (status IN ('draft', 'review_pending', 'approved', 'rejected', 'retired')),
  confidence_score NUMERIC(5,2),
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  rejection_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (family_id, variant_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_variants_variant_asin_not_blank
ON product_variants (variant_asin)
WHERE variant_asin IS NOT NULL AND btrim(variant_asin) <> '';

CREATE INDEX IF NOT EXISTS idx_product_variants_status ON product_variants(status);
CREATE INDEX IF NOT EXISTS idx_product_variants_attributes ON product_variants USING GIN(canonical_attributes);

-- 3) Add variant/family links to existing tables
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS family_id UUID REFERENCES product_families(id),
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES product_variants(id);

ALTER TABLE supplier_products
  ADD COLUMN IF NOT EXISTS product_variant_id UUID REFERENCES product_variants(id),
  ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'INR',
  ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMP DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS availability_status VARCHAR(20) DEFAULT 'in_stock' CHECK (availability_status IN ('in_stock', 'out_of_stock', 'preorder', 'discontinued'));

CREATE INDEX IF NOT EXISTS idx_supplier_products_variant_ref ON supplier_products(product_variant_id);
CREATE INDEX IF NOT EXISTS idx_supplier_products_attributes_gin ON supplier_products USING GIN(attributes);

-- 4) Stronger supplier-offer uniqueness per outlet/location + variant
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_supplier_offer_variant_outlet'
  ) THEN
    ALTER TABLE supplier_products
      ADD CONSTRAINT uq_supplier_offer_variant_outlet
      UNIQUE (supplier_id, product_id, outlet_id, variant_key);
  END IF;
END$$;

-- 5) Admin schema templates for allowed specification keys
CREATE TABLE IF NOT EXISTS spec_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(150) NOT NULL,
  category VARCHAR(80) NOT NULL,
  family_id UUID REFERENCES product_families(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (category, family_id)
);

CREATE TABLE IF NOT EXISTS spec_template_fields (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  template_id UUID NOT NULL REFERENCES spec_templates(id) ON DELETE CASCADE,
  field_key VARCHAR(80) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  data_type VARCHAR(20) NOT NULL CHECK (data_type IN ('text', 'number', 'boolean', 'enum', 'unit')),
  is_required BOOLEAN DEFAULT FALSE,
  allowed_units TEXT[] DEFAULT '{}',
  enum_values TEXT[] DEFAULT '{}',
  min_value NUMERIC,
  max_value NUMERIC,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (template_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_spec_template_fields_template ON spec_template_fields(template_id, sort_order);

-- 6) Product requests workflow for low-confidence onboarding
CREATE TABLE IF NOT EXISTS product_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requested_by UUID NOT NULL REFERENCES users(id),
  supplier_id UUID REFERENCES users(id),
  source VARCHAR(20) NOT NULL DEFAULT 'supplier' CHECK (source IN ('supplier', 'boq', 'manual', 'api')),
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_review', 'needs_info', 'approved', 'rejected', 'merged')),
  category VARCHAR(80),
  normalized_input JSONB DEFAULT '{}',
  ai_prefill JSONB DEFAULT '{}',
  confidence_score NUMERIC(5,2),
  resolved_product_id UUID REFERENCES products(id),
  resolved_variant_id UUID REFERENCES product_variants(id),
  reviewer_id UUID REFERENCES users(id),
  review_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_requests_status ON product_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_requests_requested_by ON product_requests(requested_by);

-- 7) AI ingestion audit trail
CREATE TABLE IF NOT EXISTS product_ingestion_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  request_id UUID REFERENCES product_requests(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES users(id),
  provider VARCHAR(20) NOT NULL CHECK (provider IN ('gemini', 'openai', 'claude', 'manual')),
  model VARCHAR(120),
  prompt_version VARCHAR(40) DEFAULT 'v1',
  input_payload JSONB DEFAULT '{}',
  extracted_payload JSONB DEFAULT '{}',
  validated_payload JSONB DEFAULT '{}',
  confidence_score NUMERIC(5,2),
  validation_errors JSONB DEFAULT '[]',
  final_decision VARCHAR(20) DEFAULT 'pending' CHECK (final_decision IN ('pending', 'auto_linked', 'queued_review', 'rejected', 'approved')),
  actor_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_ingestion_runs_request_id ON product_ingestion_runs(request_id);
CREATE INDEX IF NOT EXISTS idx_product_ingestion_runs_supplier_id ON product_ingestion_runs(supplier_id);
CREATE INDEX IF NOT EXISTS idx_product_ingestion_runs_created_at ON product_ingestion_runs(created_at DESC);

-- 8) Trigger wiring
DROP TRIGGER IF EXISTS update_product_families_updated_at ON product_families;
CREATE TRIGGER update_product_families_updated_at
  BEFORE UPDATE ON product_families
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_variants_updated_at ON product_variants;
CREATE TRIGGER update_product_variants_updated_at
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_spec_templates_updated_at ON spec_templates;
CREATE TRIGGER update_spec_templates_updated_at
  BEFORE UPDATE ON spec_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_spec_template_fields_updated_at ON spec_template_fields;
CREATE TRIGGER update_spec_template_fields_updated_at
  BEFORE UPDATE ON spec_template_fields
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_product_requests_updated_at ON product_requests;
CREATE TRIGGER update_product_requests_updated_at
  BEFORE UPDATE ON product_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
