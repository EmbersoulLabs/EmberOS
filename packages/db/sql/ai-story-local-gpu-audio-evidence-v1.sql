-- Additive, idempotent LOCAL_GPU audio evidence.
-- Does not update Post-QC rows, decisions, or historical certification records.
-- Not applied to Staging or Production by this change.
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

COMMIT;
