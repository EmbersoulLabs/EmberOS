BEGIN;
CREATE TABLE ai_story_generation_results (
  generation_result_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  execution_plan_id uuid NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_execution_id uuid NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  generation_unit_id uuid NOT NULL,
  source_kind text NOT NULL,
  provider_attempt_id text UNIQUE REFERENCES provider_attempts(attempt_id) ON DELETE RESTRICT,
  local_generation_output_id uuid UNIQUE REFERENCES ai_story_local_generation_outputs(output_id) ON DELETE RESTRICT,
  local_worker_output_id uuid UNIQUE,
  asset_id uuid NOT NULL,
  content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[0-9a-f]{64}$'),
  fingerprint text NOT NULL UNIQUE CHECK(fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_generation_result_exact_source CHECK (
    (source_kind = 'REMOTE_PROVIDER' AND provider_attempt_id IS NOT NULL AND local_generation_output_id IS NULL AND local_worker_output_id IS NULL)
    OR (source_kind = 'MANUAL_LOCAL' AND provider_attempt_id IS NULL AND local_generation_output_id IS NOT NULL AND local_worker_output_id IS NULL)
    OR (source_kind = 'LOCAL_GPU_WORKER' AND provider_attempt_id IS NULL AND local_generation_output_id IS NULL AND local_worker_output_id IS NOT NULL)
  )
);
CREATE INDEX ai_story_generation_result_plan_idx ON ai_story_generation_results(workspace_id, execution_plan_id);

-- Preserve the historical Provider FK; current local evaluations pin a Generation Result instead.
ALTER TABLE ai_story_post_generation_qc_evaluations ADD COLUMN generation_result_id uuid REFERENCES ai_story_generation_results(generation_result_id) ON DELETE RESTRICT;
ALTER TABLE ai_story_post_generation_qc_evaluations ALTER COLUMN provider_attempt_id DROP NOT NULL;
ALTER TABLE ai_story_post_generation_qc_evaluations ALTER COLUMN media_asset_id DROP NOT NULL;
ALTER TABLE ai_story_post_generation_qc_evaluations ADD CONSTRAINT ai_story_post_qc_result_or_legacy CHECK (
  generation_result_id IS NOT NULL OR (provider_attempt_id IS NOT NULL AND media_asset_id IS NOT NULL)
);
CREATE INDEX ai_story_post_qc_result_idx ON ai_story_post_generation_qc_evaluations(generation_result_id, evaluation_version);
CREATE UNIQUE INDEX ai_story_post_qc_result_version_unique ON ai_story_post_generation_qc_evaluations(generation_result_id,evaluation_version) WHERE generation_result_id IS NOT NULL;

CREATE TABLE ai_story_generation_result_decisions (
  decision_id uuid PRIMARY KEY,
  generation_result_id uuid NOT NULL UNIQUE REFERENCES ai_story_generation_results(generation_result_id) ON DELETE RESTRICT,
  post_qc_evaluation_id uuid NOT NULL REFERENCES ai_story_post_generation_qc_evaluations(post_qc_evaluation_id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK(decision IN('APPROVED','LOCAL_REGENERATION_REQUIRED','REJECTED')),
  actor_user_id uuid NOT NULL,
  fact jsonb NOT NULL,
  decided_at timestamptz NOT NULL
);
CREATE TABLE ai_story_generation_result_continuity_frames (
  generation_result_id uuid PRIMARY KEY REFERENCES ai_story_generation_results(generation_result_id) ON DELETE RESTRICT,
  frame_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  content_hash text NOT NULL CHECK(content_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_content_hash text NOT NULL CHECK(source_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  extracted_at timestamptz NOT NULL
);

-- Canonical Scene Result remains the assembly authority. Provider columns keep their historical FKs.
ALTER TABLE ai_story_scene_results ADD COLUMN generation_result_id uuid UNIQUE REFERENCES ai_story_generation_results(generation_result_id) ON DELETE RESTRICT;
ALTER TABLE ai_story_scene_results ALTER COLUMN worker_execution_result_id DROP NOT NULL;
ALTER TABLE ai_story_scene_results ALTER COLUMN projection_correlation_id DROP NOT NULL;
ALTER TABLE ai_story_scene_results ALTER COLUMN provider_execution_id DROP NOT NULL;
ALTER TABLE ai_story_scene_results ALTER COLUMN provider_attempt_id DROP NOT NULL;
ALTER TABLE ai_story_scene_results ALTER COLUMN provider_finalization_reference DROP NOT NULL;
ALTER TABLE ai_story_scene_results ADD CONSTRAINT ai_story_scene_result_source_required CHECK (
  generation_result_id IS NOT NULL OR (
    worker_execution_result_id IS NOT NULL AND projection_correlation_id IS NOT NULL
    AND provider_execution_id IS NOT NULL AND provider_attempt_id IS NOT NULL AND provider_finalization_reference IS NOT NULL
  )
);

CREATE FUNCTION enforce_ai_story_generation_result_immutable_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'GENERATION_RESULT_IMMUTABLE_CONFLICT' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER generation_result_immutable BEFORE UPDATE OR DELETE ON ai_story_generation_results FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_generation_result_immutable_v1();
CREATE TRIGGER generation_result_decision_immutable BEFORE UPDATE OR DELETE ON ai_story_generation_result_decisions FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_generation_result_immutable_v1();
CREATE TRIGGER generation_result_frame_immutable BEFORE UPDATE OR DELETE ON ai_story_generation_result_continuity_frames FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_generation_result_immutable_v1();

ALTER TABLE ai_story_generation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_generation_result_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_generation_result_continuity_frames ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_story_generation_results, ai_story_generation_result_decisions, ai_story_generation_result_continuity_frames FROM anon, authenticated;
GRANT SELECT ON ai_story_generation_results, ai_story_generation_result_decisions, ai_story_generation_result_continuity_frames TO authenticated;
CREATE POLICY generation_result_select ON ai_story_generation_results FOR SELECT TO authenticated USING (
  EXISTS(SELECT 1 FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
    JOIN campaigns c ON c.id=ai_story_generation_results.campaign_id
    JOIN ai_stories s ON s.id=ai_story_generation_results.story_id
    WHERE m.user_id=(SELECT auth.uid()) AND m.workspace_id=ai_story_generation_results.workspace_id
      AND w.org_id=ai_story_generation_results.org_id AND c.workspace_id=w.id
      AND s.workspace_id=w.id AND s.campaign_id=c.id)
);
CREATE POLICY generation_result_decision_select ON ai_story_generation_result_decisions FOR SELECT TO authenticated USING (
  generation_result_id IN(SELECT generation_result_id FROM ai_story_generation_results)
);
CREATE POLICY generation_result_frame_select ON ai_story_generation_result_continuity_frames FOR SELECT TO authenticated USING (
  generation_result_id IN(SELECT generation_result_id FROM ai_story_generation_results)
);
-- CPU media processing only: never a Provider dispatch/Attempt queue.
CREATE TABLE ai_story_local_media_jobs (
  job_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  execution_plan_id uuid NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  package_id uuid NOT NULL REFERENCES ai_story_local_generation_packages(package_id) ON DELETE RESTRICT,
  asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  generation_result_id uuid REFERENCES ai_story_generation_results(generation_result_id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('VALIDATE_OUTPUT','EXTRACT_FRAME')),
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','FAILED')),
  claim_token uuid,
  lease_until timestamptz,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='VALIDATE_OUTPUT' AND asset_id IS NOT NULL AND generation_result_id IS NULL)
      OR (kind='EXTRACT_FRAME' AND generation_result_id IS NOT NULL AND asset_id IS NULL))
);
CREATE INDEX ai_story_local_media_pending_idx ON ai_story_local_media_jobs(state,created_at);
CREATE FUNCTION enforce_local_media_job_identity_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'LOCAL_MEDIA_JOB_IDENTITY_IMMUTABLE'; END IF;
  IF (NEW.job_id,NEW.workspace_id,NEW.execution_plan_id,NEW.package_id,NEW.asset_id,NEW.generation_result_id,NEW.actor_user_id,NEW.kind,NEW.created_at)
     IS DISTINCT FROM (OLD.job_id,OLD.workspace_id,OLD.execution_plan_id,OLD.package_id,OLD.asset_id,OLD.generation_result_id,OLD.actor_user_id,OLD.kind,OLD.created_at)
  THEN RAISE EXCEPTION 'LOCAL_MEDIA_JOB_IDENTITY_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER local_media_job_identity_immutable BEFORE UPDATE OR DELETE ON ai_story_local_media_jobs FOR EACH ROW EXECUTE FUNCTION enforce_local_media_job_identity_v1();
ALTER TABLE ai_story_local_media_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ai_story_local_media_jobs FROM anon, authenticated;
GRANT SELECT ON ai_story_local_media_jobs TO authenticated;
CREATE POLICY local_media_job_select ON ai_story_local_media_jobs FOR SELECT TO authenticated USING (
  package_id IN (SELECT package_id FROM ai_story_local_generation_packages)
);
COMMIT;
