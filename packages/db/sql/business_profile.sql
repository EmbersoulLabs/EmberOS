-- SPEC-001 Business Profile table (final v1.1 shape)
-- Run: pnpm --filter @ceo-agent/db sql:business-profile
--
-- Fresh database: this file alone yields the final schema.
-- Legacy databases (older business_profiles with text industry / text business_hours):
--   run this file (CREATE IF NOT EXISTS is a no-op if table exists), then
--   run sql:business-profile-v1-1 (idempotent patch).

CREATE TABLE IF NOT EXISTS business_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  company_name text,
  industry_id text,
  industry_display_name text,
  industry_custom_value text,
  services text[] NOT NULL DEFAULT '{}',
  business_description text,
  target_audience text,
  business_hours jsonb NOT NULL DEFAULT '[]',
  business_email text,
  business_phone text,
  whatsapp_business text,
  website text,
  facebook text,
  instagram text,
  tiktok text,
  youtube text,
  red_note text,
  linkedin text,
  country text,
  state_province text,
  city text,
  address text,
  postal_code text,
  timezone text,
  brand_personality text[] NOT NULL DEFAULT '{}',
  brand_style text[] NOT NULL DEFAULT '{}',
  brand_values text[] NOT NULL DEFAULT '{}',
  brand_keywords text[] NOT NULL DEFAULT '{}',
  logo text,
  brand_colors text[] NOT NULL DEFAULT '{}',
  brand_fonts text[] NOT NULL DEFAULT '{}',
  brand_images text[] NOT NULL DEFAULT '{}',
  supported_languages text[] NOT NULL DEFAULT '{}',
  default_publishing_platforms text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_by uuid,
  deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS business_profiles_workspace_idx ON business_profiles(workspace_id);
