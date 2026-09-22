-- Additive Character Virtualizer jobs and lineage.
-- Source portraits stay CHARACTER_SOURCE_PORTRAIT. Accepted synthetic output becomes IDENTITY_MASTER.
-- Persistence is not Provider execution. Historical reusable Character versions remain readable.

CREATE TABLE IF NOT EXISTS ai_story_character_virtualization_jobs (
  job_id uuid PRIMARY KEY,
  org_id uuid NOT NULL CONSTRAINT as_cvj_org_fk REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL CONSTRAINT as_cvj_ws_fk REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_asset_id uuid NOT NULL CONSTRAINT as_cvj_source_asset_fk REFERENCES assets(id) ON DELETE RESTRICT,
  source_content_hash text NOT NULL CHECK (source_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_semantic text NOT NULL CHECK (source_semantic = 'CHARACTER_SOURCE_PORTRAIT'),
  style text NOT NULL CHECK (style IN ('PREMIUM_3D','STYLIZED_CGI','ILLUSTRATED')),
  visual_class text NOT NULL CHECK (visual_class IN ('PHOTOREALISTIC_SOURCE','SYNTHETIC_3D','STYLIZED_CGI','ILLUSTRATED')),
  creative_direction text,
  permission_confirmed boolean NOT NULL CHECK (permission_confirmed = true),
  status text NOT NULL CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','REJECTED')),
  acceptance_status text NOT NULL CHECK (acceptance_status IN ('NOT_READY','VIRTUAL_CHARACTER_CANDIDATE','ACCEPTED','DISCARDED')),
  provider text NOT NULL,
  provider_model text NOT NULL,
  provider_attempt_id uuid,
  prompt_fingerprint text CHECK (prompt_fingerprint IS NULL OR prompt_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  output_asset_id uuid CONSTRAINT as_cvj_output_asset_fk REFERENCES assets(id) ON DELETE RESTRICT,
  output_content_hash text CHECK (output_content_hash IS NULL OR output_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  output_semantic text CHECK (output_semantic IS NULL OR output_semantic IN ('CHARACTER_SOURCE_PORTRAIT','VIRTUAL_CHARACTER_CANDIDATE','ACCEPTED_VIRTUAL_IDENTITY_MASTER')),
  cost_category text NOT NULL CHECK (cost_category = 'CHARACTER_VIRTUALIZATION'),
  cost_usd numeric,
  parent_job_id uuid CONSTRAINT as_cvj_parent_fk REFERENCES ai_story_character_virtualization_jobs(job_id) ON DELETE RESTRICT,
  automatic_retry boolean NOT NULL CHECK (automatic_retry = false),
  reusable_character_id uuid CONSTRAINT as_cvj_rc_fk REFERENCES ai_story_reusable_characters(reusable_character_id) ON DELETE RESTRICT,
  reusable_character_version_id uuid CONSTRAINT as_cvj_rc_ver_fk REFERENCES ai_story_reusable_character_versions(reusable_character_version_id) ON DELETE RESTRICT,
  seedance_video_calls integer NOT NULL CHECK (seedance_video_calls = 0),
  real_image_provider_calls integer NOT NULL CHECK (real_image_provider_calls = 0),
  user_safe_error text,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT as_cvj_source_not_output_chk CHECK (output_asset_id IS NULL OR output_asset_id <> source_asset_id)
);

CREATE INDEX IF NOT EXISTS as_cvj_workspace_idx
  ON ai_story_character_virtualization_jobs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS as_cvj_source_idx
  ON ai_story_character_virtualization_jobs (source_asset_id, status);
CREATE INDEX IF NOT EXISTS as_cvj_character_idx
  ON ai_story_character_virtualization_jobs (reusable_character_id, reusable_character_version_id);

CREATE OR REPLACE FUNCTION protect_ai_story_character_virtualization_job_identity_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.job_id IS DISTINCT FROM OLD.job_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.source_asset_id IS DISTINCT FROM OLD.source_asset_id
     OR NEW.source_content_hash IS DISTINCT FROM OLD.source_content_hash
     OR NEW.source_semantic IS DISTINCT FROM OLD.source_semantic
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.automatic_retry IS DISTINCT FROM OLD.automatic_retry
     OR NEW.seedance_video_calls IS DISTINCT FROM OLD.seedance_video_calls THEN
    RAISE EXCEPTION 'AI Story Character Virtualization job identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.acceptance_status = 'ACCEPTED'
     AND (NEW.reusable_character_id IS DISTINCT FROM OLD.reusable_character_id
          OR NEW.reusable_character_version_id IS DISTINCT FROM OLD.reusable_character_version_id
          OR NEW.output_asset_id IS DISTINCT FROM OLD.output_asset_id
          OR NEW.output_content_hash IS DISTINCT FROM OLD.output_content_hash) THEN
    RAISE EXCEPTION 'Accepted Character Virtualization lineage is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_story_character_virtualization_job_identity_v1 ON ai_story_character_virtualization_jobs;
CREATE TRIGGER ai_story_character_virtualization_job_identity_v1 BEFORE UPDATE ON ai_story_character_virtualization_jobs
FOR EACH ROW EXECUTE FUNCTION protect_ai_story_character_virtualization_job_identity_v1();

ALTER TABLE ai_story_character_virtualization_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS as_cvj_select ON ai_story_character_virtualization_jobs;
CREATE POLICY as_cvj_select ON ai_story_character_virtualization_jobs FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS as_cvj_insert ON ai_story_character_virtualization_jobs;
CREATE POLICY as_cvj_insert ON ai_story_character_virtualization_jobs FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));
DROP POLICY IF EXISTS as_cvj_update ON ai_story_character_virtualization_jobs;
CREATE POLICY as_cvj_update ON ai_story_character_virtualization_jobs FOR UPDATE TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')))
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));
