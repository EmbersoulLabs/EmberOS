-- Additive, idempotent LOCAL_GPU audio evidence.
-- Run after ai-story-local-gpu-execution-mode-v1.sql.
-- Does not update Post-QC rows, decisions, Manual Local rows, or certification records.
-- Not applied to Staging or Production by this change.
--
-- The table owner and a BYPASSRLS role such as service_role skip row-level security.
-- BEFORE INSERT still binds the row to its Generation Result, and BEFORE UPDATE OR
-- DELETE rejects changes for every role that cannot disable triggers. A superuser
-- can disable triggers; this migration does not claim otherwise.

BEGIN;

CREATE TABLE IF NOT EXISTS ai_story_local_gpu_audio_evidence (
  audio_evidence_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE RESTRICT,
  execution_plan_id uuid NOT NULL REFERENCES ai_story_execution_plans (id) ON DELETE RESTRICT,
  scene_execution_id uuid NOT NULL REFERENCES ai_story_scene_executions (id) ON DELETE RESTRICT,
  generation_result_id uuid NOT NULL UNIQUE REFERENCES ai_story_generation_results (generation_result_id) ON DELETE RESTRICT,
  asset_id uuid NOT NULL REFERENCES assets (id) ON DELETE RESTRICT,
  content_hash text NOT NULL,
  has_audio boolean NOT NULL,
  speech_content text NOT NULL,
  evidence_fingerprint text NOT NULL UNIQUE,
  fact jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_story_local_gpu_audio_evidence_speech_check CHECK (
    (has_audio = true AND speech_content = 'HUMAN_REVIEW_REQUIRED')
    OR (has_audio = false AND speech_content = 'NOT_APPLICABLE')
  )
);

CREATE INDEX IF NOT EXISTS ai_story_local_gpu_audio_evidence_workspace_idx
  ON ai_story_local_gpu_audio_evidence (workspace_id, execution_plan_id);

CREATE OR REPLACE FUNCTION enforce_ai_story_local_gpu_audio_evidence_binding_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent ai_story_generation_results%ROWTYPE;
BEGIN
  SELECT * INTO parent
  FROM ai_story_generation_results
  WHERE generation_result_id = NEW.generation_result_id;

  IF NOT FOUND
     OR parent.org_id IS DISTINCT FROM NEW.org_id
     OR parent.workspace_id IS DISTINCT FROM NEW.workspace_id
     OR parent.execution_plan_id IS DISTINCT FROM NEW.execution_plan_id
     OR parent.scene_execution_id IS DISTINCT FROM NEW.scene_execution_id
     OR parent.asset_id IS DISTINCT FROM NEW.asset_id
     OR parent.content_hash IS DISTINCT FROM NEW.content_hash
  THEN
    RAISE EXCEPTION 'LOCAL_GPU_AUDIO_EVIDENCE_WORKSPACE_MISMATCH' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM assets
    WHERE id = NEW.asset_id
      AND org_id = NEW.org_id
      AND workspace_id = NEW.workspace_id
  ) THEN
    RAISE EXCEPTION 'LOCAL_GPU_AUDIO_EVIDENCE_WORKSPACE_MISMATCH' USING ERRCODE = '23514';
  END IF;

  IF (NEW.fact->>'orgId')::uuid IS DISTINCT FROM NEW.org_id
     OR (NEW.fact->>'workspaceId')::uuid IS DISTINCT FROM NEW.workspace_id
     OR (NEW.fact->>'executionPlanId')::uuid IS DISTINCT FROM NEW.execution_plan_id
     OR (NEW.fact->>'sceneExecutionId')::uuid IS DISTINCT FROM NEW.scene_execution_id
     OR (NEW.fact->>'generationResultId')::uuid IS DISTINCT FROM NEW.generation_result_id
     OR (NEW.fact->>'assetId')::uuid IS DISTINCT FROM NEW.asset_id
     OR NEW.fact->>'contentHash' IS DISTINCT FROM NEW.content_hash
     OR NEW.fact->>'speechContent' IS DISTINCT FROM NEW.speech_content
     OR NEW.fact->>'evidenceFingerprint' IS DISTINCT FROM NEW.evidence_fingerprint
     OR (NEW.fact->>'hasAudio')::boolean IS DISTINCT FROM NEW.has_audio
  THEN
    RAISE EXCEPTION 'LOCAL_GPU_AUDIO_EVIDENCE_MISMATCH' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_ai_story_local_gpu_audio_evidence_immutable_v1()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'LOCAL_GPU_AUDIO_EVIDENCE_IMMUTABLE' USING ERRCODE = '23514';
END;
$$;

DROP TRIGGER IF EXISTS ai_story_local_gpu_audio_evidence_binding_v1
  ON ai_story_local_gpu_audio_evidence;
CREATE TRIGGER ai_story_local_gpu_audio_evidence_binding_v1
  BEFORE INSERT OR UPDATE ON ai_story_local_gpu_audio_evidence
  FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_local_gpu_audio_evidence_binding_v1();

DROP TRIGGER IF EXISTS ai_story_local_gpu_audio_evidence_immutable_v1
  ON ai_story_local_gpu_audio_evidence;
CREATE TRIGGER ai_story_local_gpu_audio_evidence_immutable_v1
  BEFORE UPDATE OR DELETE ON ai_story_local_gpu_audio_evidence
  FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_local_gpu_audio_evidence_immutable_v1();

ALTER TABLE ai_story_local_gpu_audio_evidence ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ai_story_local_gpu_audio_evidence FROM PUBLIC, anon, authenticated;
GRANT SELECT ON ai_story_local_gpu_audio_evidence TO authenticated;

DROP POLICY IF EXISTS ai_story_local_gpu_audio_evidence_select ON ai_story_local_gpu_audio_evidence;
DROP POLICY IF EXISTS ai_story_local_gpu_audio_evidence_insert ON ai_story_local_gpu_audio_evidence;
DROP POLICY IF EXISTS ai_story_local_gpu_audio_evidence_update ON ai_story_local_gpu_audio_evidence;
DROP POLICY IF EXISTS ai_story_local_gpu_audio_evidence_delete ON ai_story_local_gpu_audio_evidence;
DROP POLICY IF EXISTS ai_story_local_gpu_audio_evidence_all ON ai_story_local_gpu_audio_evidence;

CREATE POLICY ai_story_local_gpu_audio_evidence_select
  ON ai_story_local_gpu_audio_evidence
  FOR SELECT
  TO authenticated
  USING (
    workspace_id IN (
      SELECT workspace_id
      FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    REVOKE ALL ON ai_story_local_gpu_audio_evidence FROM service_role;
    GRANT SELECT, INSERT ON ai_story_local_gpu_audio_evidence TO service_role;
  END IF;
END $$;

COMMIT;
