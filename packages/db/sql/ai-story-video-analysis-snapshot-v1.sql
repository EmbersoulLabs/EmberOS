-- Standalone additive migration for AI Story video analysis snapshots.
-- Applies on a certified predecessor that already has assets and workspace_members.
-- Does not alter predecessor business tables. New snapshot columns are additive.
-- Rollback: DROP TRIGGER, DROP FUNCTION ai_story_video_analysis_snapshots_immutable,
-- DROP TABLE ai_story_video_analysis_claims, DROP TABLE ai_story_video_analysis_snapshots.
-- Snapshots are immutable. A failed claim does not block a later claim.

CREATE TABLE IF NOT EXISTS ai_story_video_analysis_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  asset_content_hash text NOT NULL,
  analysis_type text NOT NULL DEFAULT 'AI_STORY_VIDEO',
  analysis_version text NOT NULL,
  extractor_version text NOT NULL,
  observation_json jsonb NOT NULL,
  analysis_json jsonb NOT NULL,
  provider_id text NOT NULL,
  model_id text NOT NULL,
  requested_model_id text,
  provider_model_id text,
  provider_request_id text,
  input_tokens integer,
  output_tokens integer,
  input_fingerprint text NOT NULL,
  cost_usd numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_story_video_analysis_snapshots_reuse_uidx UNIQUE (
    workspace_id, asset_id, asset_content_hash, analysis_version, extractor_version
  )
);

CREATE INDEX IF NOT EXISTS ai_story_video_analysis_snapshots_workspace_idx
  ON ai_story_video_analysis_snapshots (workspace_id, asset_id);

CREATE TABLE IF NOT EXISTS ai_story_video_analysis_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  asset_content_hash text NOT NULL,
  analysis_type text NOT NULL DEFAULT 'AI_STORY_VIDEO',
  analysis_version text NOT NULL,
  extractor_version text NOT NULL,
  status text NOT NULL,
  snapshot_id uuid REFERENCES ai_story_video_analysis_snapshots(id) ON DELETE RESTRICT,
  error_code text,
  provider_id text,
  requested_model_id text,
  provider_model_id text,
  provider_request_id text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric,
  attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_story_video_analysis_claims_status_chk CHECK (status IN ('CLAIMED', 'SUCCEEDED', 'FAILED'))
);

CREATE INDEX IF NOT EXISTS ai_story_video_analysis_claims_workspace_idx
  ON ai_story_video_analysis_claims (workspace_id, asset_id, status);

ALTER TABLE ai_story_video_analysis_snapshots
  ADD COLUMN IF NOT EXISTS requested_model_id text,
  ADD COLUMN IF NOT EXISTS provider_model_id text,
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer;

ALTER TABLE ai_story_video_analysis_claims
  ADD COLUMN IF NOT EXISTS provider_id text,
  ADD COLUMN IF NOT EXISTS requested_model_id text,
  ADD COLUMN IF NOT EXISTS provider_model_id text,
  ADD COLUMN IF NOT EXISTS provider_request_id text,
  ADD COLUMN IF NOT EXISTS input_tokens integer,
  ADD COLUMN IF NOT EXISTS output_tokens integer,
  ADD COLUMN IF NOT EXISTS cost_usd numeric,
  ADD COLUMN IF NOT EXISTS attempted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS ai_story_video_analysis_claims_active_uidx
  ON ai_story_video_analysis_claims (workspace_id, asset_id, asset_content_hash, analysis_version, extractor_version)
  WHERE status IN ('CLAIMED', 'SUCCEEDED');

CREATE OR REPLACE FUNCTION ai_story_video_analysis_snapshots_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AI_STORY_VIDEO_ANALYSIS_SNAPSHOT_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS ai_story_video_analysis_snapshots_no_mutation ON ai_story_video_analysis_snapshots;
CREATE TRIGGER ai_story_video_analysis_snapshots_no_mutation
  BEFORE UPDATE OR DELETE ON ai_story_video_analysis_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION ai_story_video_analysis_snapshots_immutable();

ALTER TABLE ai_story_video_analysis_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_video_analysis_claims ENABLE ROW LEVEL SECURITY;

DO $video_analysis_rls$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL AND to_regprocedure('user_workspace_ids()') IS NULL THEN
    RETURN;
  END IF;

  IF to_regprocedure('user_workspace_ids()') IS NULL THEN
    EXECUTE $create_user_workspace_ids$
      CREATE FUNCTION user_workspace_ids()
      RETURNS SETOF uuid
      LANGUAGE sql
      SECURITY DEFINER
      STABLE
      AS $body$
        SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
      $body$
    $create_user_workspace_ids$;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_snapshots_select ON ai_story_video_analysis_snapshots';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_snapshots_insert ON ai_story_video_analysis_snapshots';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_snapshots_update ON ai_story_video_analysis_snapshots';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_snapshots_delete ON ai_story_video_analysis_snapshots';
  EXECUTE 'CREATE POLICY ai_story_video_analysis_snapshots_select ON ai_story_video_analysis_snapshots FOR SELECT USING (workspace_id IN (SELECT user_workspace_ids()))';

  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_claims_select ON ai_story_video_analysis_claims';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_claims_insert ON ai_story_video_analysis_claims';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_claims_update ON ai_story_video_analysis_claims';
  EXECUTE 'DROP POLICY IF EXISTS ai_story_video_analysis_claims_delete ON ai_story_video_analysis_claims';
  EXECUTE 'CREATE POLICY ai_story_video_analysis_claims_select ON ai_story_video_analysis_claims FOR SELECT USING (workspace_id IN (SELECT user_workspace_ids()))';

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'GRANT SELECT ON ai_story_video_analysis_snapshots TO authenticated';
    EXECUTE 'GRANT SELECT ON ai_story_video_analysis_claims TO authenticated';
  END IF;
END
$video_analysis_rls$;
