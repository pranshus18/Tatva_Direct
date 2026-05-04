-- ============================================
-- MIGRATION: Shared model specification profiles
-- ============================================
-- Purpose:
-- - Save reusable specifications per (category + model identifier)
-- - Auto-apply for other suppliers when same model is added

CREATE TABLE IF NOT EXISTS model_spec_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category VARCHAR(80) NOT NULL,
  model_identifier VARCHAR(200) NOT NULL,
  display_model VARCHAR(220),
  specifications JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (category, model_identifier)
);

CREATE INDEX IF NOT EXISTS idx_model_spec_profiles_category ON model_spec_profiles(category);
CREATE INDEX IF NOT EXISTS idx_model_spec_profiles_model_identifier ON model_spec_profiles(model_identifier);
CREATE INDEX IF NOT EXISTS idx_model_spec_profiles_specs_gin ON model_spec_profiles USING GIN(specifications);

DROP TRIGGER IF EXISTS update_model_spec_profiles_updated_at ON model_spec_profiles;
CREATE TRIGGER update_model_spec_profiles_updated_at
  BEFORE UPDATE ON model_spec_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
