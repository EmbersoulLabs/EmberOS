-- Sprint 3 Phase 3 PR 3.5 (remediated): Scene projection-only persistence.
-- Does NOT create scene usage/cost ledgers.
-- Provider terminal/usage/cost/outbox remain in canonical provider tables.

CREATE TABLE IF NOT EXISTS ai_story_scene_projection_correlations (
  projection_correlation_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  scene_execution_id UUID NOT NULL
    REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  worker_execution_result_id UUID NOT NULL
    REFERENCES ai_story_worker_execution_results(worker_execution_result_id) ON DELETE RESTRICT,
  provider_execution_id TEXT NOT NULL
    REFERENCES provider_executions(execution_id) ON DELETE RESTRICT,
  provider_attempt_id TEXT NOT NULL,
  outbox_job_id TEXT NOT NULL
    REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT,
  dispatch_id TEXT NOT NULL
    REFERENCES provider_execution_dispatches(dispatch_id) ON DELETE RESTRICT,
  provider_finalization_reference TEXT NOT NULL,
  scene_result_id UUID NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  correlation JSONB NOT NULL,
  projected_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT ai_story_scene_projection_scene_unique UNIQUE (scene_execution_id),
  CONSTRAINT ai_story_scene_projection_hash_unique UNIQUE (integrity_hash),
  CONSTRAINT ai_story_scene_projection_finalization_unique UNIQUE (provider_finalization_reference)
);

CREATE INDEX IF NOT EXISTS ai_story_scene_projection_workspace_idx
  ON ai_story_scene_projection_correlations (workspace_id, projected_at);

CREATE TABLE IF NOT EXISTS ai_story_scene_results (
  scene_result_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL
    REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_runtime_id UUID NOT NULL,
  scene_execution_id UUID NOT NULL
    REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  worker_execution_result_id UUID NOT NULL
    REFERENCES ai_story_worker_execution_results(worker_execution_result_id) ON DELETE RESTRICT,
  projection_correlation_id UUID NOT NULL
    REFERENCES ai_story_scene_projection_correlations(projection_correlation_id) ON DELETE RESTRICT,
  provider_execution_id TEXT NOT NULL,
  provider_attempt_id TEXT NOT NULL,
  provider_finalization_reference TEXT NOT NULL,
  scene_id TEXT NOT NULL,
  scene_order INTEGER NOT NULL,
  status TEXT NOT NULL,
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  result JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  projected_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT ai_story_scene_results_scene_unique UNIQUE (scene_execution_id),
  CONSTRAINT ai_story_scene_results_hash_unique UNIQUE (integrity_hash),
  CONSTRAINT ai_story_scene_results_worker_unique UNIQUE (worker_execution_result_id)
);

CREATE INDEX IF NOT EXISTS ai_story_scene_results_workspace_idx
  ON ai_story_scene_results (workspace_id, projected_at);
CREATE INDEX IF NOT EXISTS ai_story_scene_results_plan_idx
  ON ai_story_scene_results (execution_plan_id, scene_order);
