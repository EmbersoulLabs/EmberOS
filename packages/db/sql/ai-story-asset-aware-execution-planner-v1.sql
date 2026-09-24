-- Asset-aware execution planning foundation.
-- ANALYZE ONCE: content-addressed immutable analysis snapshots.
-- REFERENCE MANY: Story bindings pin snapshots without owning Asset bytes.
-- PLAN PER EXECUTION: immutable planner snapshots derive mode and audio requirements.

CREATE TABLE IF NOT EXISTS asset_analysis_snapshots (
  snapshot_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  source_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  analyzed_content_hash text NOT NULL
    CHECK (analyzed_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  analyzer_version text NOT NULL,
  schema_version text NOT NULL,
  analysis jsonb NOT NULL,
  analysis_fingerprint text NOT NULL
    CHECK (analysis_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_analysis_snapshot_cache_unique UNIQUE (
    workspace_id,
    analyzed_content_hash,
    analyzer_version,
    schema_version
  ),
  CONSTRAINT asset_analysis_snapshot_fingerprint_unique UNIQUE (
    workspace_id,
    analysis_fingerprint
  )
);

CREATE INDEX IF NOT EXISTS asset_analysis_snapshot_asset_idx
  ON asset_analysis_snapshots (workspace_id, source_asset_id, created_at);

CREATE TABLE IF NOT EXISTS asset_analysis_attempts (
  attempt_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  content_hash text NOT NULL
    CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  analyzer_version text NOT NULL,
  schema_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED')),
  snapshot_id uuid REFERENCES asset_analysis_snapshots(snapshot_id)
    ON DELETE RESTRICT,
  error_code text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  CONSTRAINT asset_analysis_attempt_outcome_check CHECK (
    (
      status = 'SUCCEEDED'
      AND snapshot_id IS NOT NULL
      AND error_code IS NULL
    )
    OR (
      status = 'FAILED'
      AND snapshot_id IS NULL
      AND error_code IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS asset_analysis_attempt_cache_idx
  ON asset_analysis_attempts (
    workspace_id,
    content_hash,
    analyzer_version,
    schema_version,
    completed_at
  );

CREATE INDEX IF NOT EXISTS asset_analysis_attempt_asset_idx
  ON asset_analysis_attempts (workspace_id, asset_id, completed_at);

CREATE TABLE IF NOT EXISTS ai_story_asset_bindings (
  binding_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id)
    ON DELETE RESTRICT,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  asset_content_hash text NOT NULL
    CHECK (asset_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  analysis_snapshot_id uuid NOT NULL
    REFERENCES asset_analysis_snapshots(snapshot_id) ON DELETE RESTRICT,
  analysis_content_hash text NOT NULL
    CHECK (analysis_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  role text NOT NULL CHECK (role IN (
    'STORY_REFERENCE',
    'SCENE_REFERENCE',
    'FIRST_FRAME_CANDIDATE',
    'SOURCE_VIDEO_CANDIDATE',
    'PRODUCT_GROUNDING',
    'CHARACTER_GROUNDING',
    'SOURCE_AUDIO',
    'CHARACTER_AUTHORITY',
    'PRODUCT_AUTHORITY',
    'ENVIRONMENT_AUTHORITY',
    'BRAND_ASSET',
    'SOURCE_IMAGE_CANDIDATE',
    'CONTINUITY_REFERENCE',
    'SUPPORTING_REFERENCE',
    'UNUSED'
  )),
  required boolean NOT NULL DEFAULT false,
  reason text NOT NULL,
  trace jsonb NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'REJECTED', 'SUPERSEDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_story_asset_binding_hash_match
    CHECK (asset_content_hash = analysis_content_hash),
  CONSTRAINT ai_story_asset_binding_identity_unique UNIQUE (
    story_id,
    story_version_id,
    asset_id,
    analysis_snapshot_id,
    role
  )
);

CREATE INDEX IF NOT EXISTS ai_story_asset_binding_story_idx
  ON ai_story_asset_bindings (
    workspace_id,
    story_id,
    story_version_id,
    status
  );

CREATE TABLE IF NOT EXISTS ai_story_asset_matching_results (
  matching_result_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id)
    ON DELETE RESTRICT,
  contract_version text NOT NULL,
  result jsonb NOT NULL,
  result_fingerprint text NOT NULL
    CHECK (result_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  matcher_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_story_asset_matching_result_fingerprint_unique UNIQUE (
    workspace_id,
    result_fingerprint
  )
);

CREATE INDEX IF NOT EXISTS ai_story_asset_matching_result_story_idx
  ON ai_story_asset_matching_results (
    workspace_id,
    story_id,
    story_version_id,
    created_at
  );

CREATE TABLE IF NOT EXISTS ai_story_execution_planner_snapshots (
  planner_snapshot_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  asset_decision_status text NOT NULL CHECK (asset_decision_status IN (
    'NEEDS_RECOMMENDED_UPLOADS',
    'AWAITING_NO_ASSET_CONFIRMATION',
    'RESOLVED',
    'UNSUPPORTED'
  )),
  requirements jsonb NOT NULL,
  audio_intent text NOT NULL CHECK (audio_intent IN (
    'NONE',
    'NATIVE_DIALOGUE',
    'VOICE_OVER',
    'PRESERVE_SOURCE_AUDIO',
    'MIXED'
  )),
  provider_capability_requirements jsonb NOT NULL,
  resolved_generation_mode text CHECK (
    resolved_generation_mode IS NULL OR resolved_generation_mode IN (
      'TEXT_TO_VIDEO',
      'FIRST_FRAME_IMAGE_TO_VIDEO',
      'VIDEO_TO_VIDEO'
    )
  ),
  plan jsonb NOT NULL,
  planning_fingerprint text NOT NULL
    CHECK (planning_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  planner_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_story_execution_planner_fingerprint_unique UNIQUE (
    workspace_id,
    planning_fingerprint
  )
);

CREATE INDEX IF NOT EXISTS ai_story_execution_planner_story_idx
  ON ai_story_execution_planner_snapshots (
    workspace_id,
    story_id,
    story_version_id,
    created_at
  );

CREATE OR REPLACE FUNCTION enforce_asset_analysis_snapshot_immutable_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Asset Analysis Snapshot is immutable' USING ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS asset_analysis_snapshot_immutable_v1
  ON asset_analysis_snapshots;
CREATE TRIGGER asset_analysis_snapshot_immutable_v1
  BEFORE UPDATE OR DELETE ON asset_analysis_snapshots
  FOR EACH ROW EXECUTE FUNCTION enforce_asset_analysis_snapshot_immutable_v1();

CREATE OR REPLACE FUNCTION enforce_ai_story_execution_planner_snapshot_immutable_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI Story Execution Planner Snapshot is immutable'
    USING ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS ai_story_execution_planner_snapshot_immutable_v1
  ON ai_story_execution_planner_snapshots;
CREATE TRIGGER ai_story_execution_planner_snapshot_immutable_v1
  BEFORE UPDATE OR DELETE ON ai_story_execution_planner_snapshots
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ai_story_execution_planner_snapshot_immutable_v1();

CREATE OR REPLACE FUNCTION enforce_ai_story_asset_matching_immutable_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI Story Asset matching authority is immutable'
    USING ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS ai_story_asset_binding_immutable_v1
  ON ai_story_asset_bindings;
CREATE TRIGGER ai_story_asset_binding_immutable_v1
  BEFORE UPDATE OR DELETE ON ai_story_asset_bindings
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ai_story_asset_matching_immutable_v1();

DROP TRIGGER IF EXISTS ai_story_asset_matching_result_immutable_v1
  ON ai_story_asset_matching_results;
CREATE TRIGGER ai_story_asset_matching_result_immutable_v1
  BEFORE UPDATE OR DELETE ON ai_story_asset_matching_results
  FOR EACH ROW
  EXECUTE FUNCTION enforce_ai_story_asset_matching_immutable_v1();

ALTER TABLE asset_analysis_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_analysis_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_asset_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_asset_matching_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_execution_planner_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS asset_analysis_snapshots_select
  ON asset_analysis_snapshots;
CREATE POLICY asset_analysis_snapshots_select ON asset_analysis_snapshots
  FOR SELECT USING (workspace_id IN (SELECT user_workspace_ids()));

DROP POLICY IF EXISTS asset_analysis_attempts_select
  ON asset_analysis_attempts;
CREATE POLICY asset_analysis_attempts_select ON asset_analysis_attempts
  FOR SELECT USING (workspace_id IN (SELECT user_workspace_ids()));

DROP POLICY IF EXISTS ai_story_asset_bindings_select
  ON ai_story_asset_bindings;
CREATE POLICY ai_story_asset_bindings_select ON ai_story_asset_bindings
  FOR SELECT USING (workspace_id IN (SELECT user_workspace_ids()));

DROP POLICY IF EXISTS ai_story_asset_matching_results_select
  ON ai_story_asset_matching_results;
CREATE POLICY ai_story_asset_matching_results_select
  ON ai_story_asset_matching_results
  FOR SELECT USING (workspace_id IN (SELECT user_workspace_ids()));

DROP POLICY IF EXISTS ai_story_execution_planner_snapshots_select
  ON ai_story_execution_planner_snapshots;
CREATE POLICY ai_story_execution_planner_snapshots_select
  ON ai_story_execution_planner_snapshots
  FOR SELECT USING (workspace_id IN (SELECT user_workspace_ids()));
