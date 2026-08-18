-- Sprint 3 PR 3.7 Phase C remediation — append-only Worker Attempt Observations.
-- Operational resume/reconciliation evidence only.
-- Does NOT replace immutable terminal WorkerExecutionResult authority.
-- Never UPDATE/DELETE observation rows.

CREATE TABLE IF NOT EXISTS ai_story_worker_attempt_observations (
  observation_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  provider_execution_id TEXT NOT NULL
    REFERENCES provider_executions(execution_id) ON DELETE RESTRICT,
  provider_attempt_id TEXT NOT NULL,
  dispatch_id TEXT NOT NULL
    REFERENCES provider_execution_dispatches(dispatch_id) ON DELETE RESTRICT,
  outbox_job_id TEXT NOT NULL
    REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT,
  provider_request_id TEXT,
  observation_kind TEXT NOT NULL,
  reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
  deterministic_integrity_hash TEXT NOT NULL,
  observation JSONB NOT NULL,
  produced_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_worker_observation_hash_unique UNIQUE (deterministic_integrity_hash)
);

CREATE INDEX IF NOT EXISTS ai_story_worker_observation_dispatch_idx
  ON ai_story_worker_attempt_observations (dispatch_id, produced_at DESC);
CREATE INDEX IF NOT EXISTS ai_story_worker_observation_attempt_idx
  ON ai_story_worker_attempt_observations (provider_attempt_id, produced_at DESC);
CREATE INDEX IF NOT EXISTS ai_story_worker_observation_workspace_idx
  ON ai_story_worker_attempt_observations (workspace_id, accepted_at);
