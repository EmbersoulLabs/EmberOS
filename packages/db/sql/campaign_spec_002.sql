-- SPEC-002 Campaign schema extensions
-- Run: pnpm --filter @ceo-agent/db sql:campaign-spec-002

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS company_profile_id uuid REFERENCES business_profiles(id) ON DELETE SET NULL;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS target_audience_override text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_objective_id text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_objective_custom text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS business_status text NOT NULL DEFAULT 'draft';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS output_language text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS subtitle_language text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS cta_language text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS hashtag_language text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS folder text;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS assigned_to uuid;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS first_generated_at timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_generated_at timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS published_at timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS purge_after timestamptz;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS marketing_package_id uuid;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS external_asset_url text;

CREATE TABLE IF NOT EXISTS marketing_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  strategy_ref jsonb,
  report_ref jsonb,
  hook_ref text,
  caption_ref text,
  cta_ref text,
  hashtags_ref jsonb,
  subtitle_ref text,
  video_ref text,
  marketing_score numeric,
  user_edited jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_packages_workspace_idx ON marketing_packages(workspace_id);

ALTER TABLE campaigns DROP CONSTRAINT IF EXISTS campaigns_marketing_package_id_fkey;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_marketing_package_id_fkey
  FOREIGN KEY (marketing_package_id) REFERENCES marketing_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS campaigns_business_status_idx ON campaigns(workspace_id, business_status);
CREATE INDEX IF NOT EXISTS campaigns_deleted_at_idx ON campaigns(workspace_id, deleted_at);
