-- Additive Character DNA analysis jobs. Source portraits stay CHARACTER_SOURCE_PORTRAIT.
-- Analysis is image understanding, not image generation. Persistence is not Provider execution.

CREATE TABLE IF NOT EXISTS ai_story_character_dna_analysis_jobs (
  job_id uuid PRIMARY KEY,
  org_id uuid NOT NULL CONSTRAINT as_cdj_org_fk REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL CONSTRAINT as_cdj_ws_fk REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_asset_id uuid NOT NULL CONSTRAINT as_cdj_source_asset_fk REFERENCES assets(id) ON DELETE RESTRICT,
  source_content_hash text NOT NULL CHECK (source_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_semantic text NOT NULL CHECK (source_semantic = 'CHARACTER_SOURCE_PORTRAIT'),
  permission_confirmed boolean NOT NULL CHECK (permission_confirmed = true),
  status text NOT NULL CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  approval_status text NOT NULL CHECK (approval_status IN ('PENDING_HUMAN_REVIEW','APPROVED','DISCARDED')),
  provider text NOT NULL,
  provider_model text NOT NULL,
  provider_attempt_id uuid,
  input_tokens integer,
  output_tokens integer,
  cost_category text NOT NULL CHECK (cost_category = 'CHARACTER_DNA_ANALYSIS'),
  cost_usd numeric,
  image_generation_calls integer NOT NULL CHECK (image_generation_calls = 0),
  gpt_image_calls integer NOT NULL CHECK (gpt_image_calls = 0),
  seedance_video_calls integer NOT NULL CHECK (seedance_video_calls = 0),
  reusable_character_id uuid CONSTRAINT as_cdj_rc_fk REFERENCES ai_story_reusable_characters(reusable_character_id) ON DELETE RESTRICT,
  reusable_character_version_id uuid CONSTRAINT as_cdj_rc_ver_fk REFERENCES ai_story_reusable_character_versions(reusable_character_version_id) ON DELETE RESTRICT,
  user_safe_error text,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS as_cdj_workspace_idx
  ON ai_story_character_dna_analysis_jobs (workspace_id, created_at);
CREATE INDEX IF NOT EXISTS as_cdj_source_idx
  ON ai_story_character_dna_analysis_jobs (source_asset_id, status);
