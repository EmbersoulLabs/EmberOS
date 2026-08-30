CREATE TABLE IF NOT EXISTS ai_story_post_generation_qc_evaluations(
  post_qc_evaluation_id uuid PRIMARY KEY,
  post_qc_input_id uuid NOT NULL,
  evaluation_version integer NOT NULL CHECK(evaluation_version>0),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  provider_attempt_id text NOT NULL REFERENCES provider_attempts(attempt_id) ON DELETE RESTRICT,
  media_asset_id uuid NOT NULL REFERENCES ai_story_durable_scene_media_attestations(media_attestation_id) ON DELETE RESTRICT,
  scene_execution_id uuid NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  aggregate_status text NOT NULL CHECK(aggregate_status IN('POST_QC_PASS','POST_QC_WARN','POST_QC_REJECT','POST_QC_REQUIRES_HUMAN_CONFIRMATION')),
  evaluation_fingerprint text NOT NULL UNIQUE CHECK(evaluation_fingerprint~'^sha256:[0-9a-f]{64}$'),
  input_package jsonb NOT NULL,
  evaluation jsonb NOT NULL,
  evaluated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(post_qc_input_id,evaluation_version)
);
CREATE INDEX IF NOT EXISTS ai_story_post_qc_attempt_idx ON ai_story_post_generation_qc_evaluations(provider_attempt_id,evaluated_at);
CREATE INDEX IF NOT EXISTS ai_story_post_qc_workspace_idx ON ai_story_post_generation_qc_evaluations(workspace_id,evaluated_at);
CREATE INDEX IF NOT EXISTS ai_story_post_qc_media_idx ON ai_story_post_generation_qc_evaluations(media_asset_id,evaluated_at);
ALTER TABLE ai_story_post_generation_qc_evaluations ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION enforce_ai_story_post_qc_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Post-Generation QC evidence is immutable' USING ERRCODE='23514'; END $$;
DROP TRIGGER IF EXISTS ai_story_post_qc_immutable_v1 ON ai_story_post_generation_qc_evaluations;
CREATE TRIGGER ai_story_post_qc_immutable_v1 BEFORE UPDATE OR DELETE ON ai_story_post_generation_qc_evaluations FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_post_qc_immutable_v1();
DROP POLICY IF EXISTS ai_story_post_qc_select ON ai_story_post_generation_qc_evaluations;
CREATE POLICY ai_story_post_qc_select ON ai_story_post_generation_qc_evaluations FOR SELECT TO authenticated USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()));
DROP POLICY IF EXISTS ai_story_post_qc_insert ON ai_story_post_generation_qc_evaluations;
CREATE POLICY ai_story_post_qc_insert ON ai_story_post_generation_qc_evaluations FOR INSERT TO authenticated WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN('admin','operator','reviewer')));
