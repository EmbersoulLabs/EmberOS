-- Sprint 3 Phase 3 PR 3.3: Worker Execution Result persistence.
-- Immutable operational facts for resume/reconciliation only.
-- No Finalizer terminal write, usage/cost, Scene Result, or execution unlock.

CREATE TABLE IF NOT EXISTS ai_story_worker_execution_results (
  worker_execution_result_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  provider_execution_id TEXT NOT NULL
    REFERENCES provider_executions(execution_id) ON DELETE RESTRICT,
  provider_attempt_id TEXT NOT NULL,
  dispatch_id TEXT NOT NULL
    REFERENCES provider_execution_dispatches(dispatch_id) ON DELETE RESTRICT,
  outbox_job_id TEXT NOT NULL
    REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT,
  routing_decision_id UUID NOT NULL
    REFERENCES ai_story_scene_routing_decisions(routing_decision_id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  router_version INTEGER NOT NULL CHECK (router_version = 1),
  provider_request_id TEXT,
  worker_state TEXT NOT NULL,
  acceptance_classification TEXT NOT NULL,
  canonical_provider_state TEXT NOT NULL,
  reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE,
  deterministic_integrity_hash TEXT NOT NULL,
  worker_contract_version TEXT NOT NULL,
  result JSONB NOT NULL,
  produced_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_worker_result_dispatch_unique UNIQUE (dispatch_id),
  CONSTRAINT ai_story_worker_result_hash_unique UNIQUE (deterministic_integrity_hash),
  CONSTRAINT ai_story_worker_result_attempt_unique UNIQUE (provider_attempt_id)
);

CREATE INDEX IF NOT EXISTS ai_story_worker_result_workspace_idx
  ON ai_story_worker_execution_results (workspace_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_worker_result_execution_idx
  ON ai_story_worker_execution_results (provider_execution_id);
