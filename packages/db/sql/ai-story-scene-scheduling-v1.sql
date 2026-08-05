-- Sprint 3 Phase 3 PR 3.2: Runtime Authorization persistence + Scene Scheduling.
-- Execution Plan remains the only Aggregate Root.
-- RuntimeAuthorizedFact is append-only subordinate authority.
-- Routing decisions and Scene↔Provider correlations are immutable.
-- Reuses provider_executions / provider_execution_envelopes / provider_outbox_jobs.
-- No Worker, Adapter, Finalizer, usage/cost, or execution unlock.

CREATE TABLE IF NOT EXISTS ai_story_runtime_authorized_facts (
  runtime_authorization_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  runtime_authorization_version INTEGER NOT NULL CHECK (runtime_authorization_version >= 1),
  review_decision_id UUID NOT NULL,
  review_hash TEXT NOT NULL,
  assembly_definition_id UUID NOT NULL,
  assembly_hash TEXT NOT NULL,
  ordered_scene_execution_ids JSONB NOT NULL,
  qc_result_ids JSONB NOT NULL,
  authorized_by UUID NOT NULL,
  authorized_at TIMESTAMPTZ NOT NULL,
  authorization_contract_version TEXT NOT NULL,
  deterministic_integrity_hash TEXT NOT NULL,
  fact JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_runtime_auth_plan_unique UNIQUE (execution_plan_id),
  CONSTRAINT ai_story_runtime_auth_hash_unique UNIQUE (deterministic_integrity_hash)
);

CREATE INDEX IF NOT EXISTS ai_story_runtime_auth_workspace_idx
  ON ai_story_runtime_authorized_facts (workspace_id, accepted_at);

CREATE TABLE IF NOT EXISTS ai_story_scene_routing_decisions (
  routing_decision_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_execution_id UUID NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  runtime_authorization_id UUID NOT NULL
    REFERENCES ai_story_runtime_authorized_facts(runtime_authorization_id) ON DELETE RESTRICT,
  capability_id TEXT NOT NULL,
  capability_version TEXT NOT NULL,
  selected_provider_id TEXT NOT NULL,
  selected_adapter_version TEXT NOT NULL,
  router_version INTEGER NOT NULL DEFAULT 1 CHECK (router_version = 1),
  registry_snapshot_hash TEXT NOT NULL,
  capability_snapshot JSONB NOT NULL,
  policy_snapshot JSONB NOT NULL,
  candidate_summary JSONB NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL,
  deterministic_integrity_hash TEXT NOT NULL,
  automatic_fallback_enabled BOOLEAN NOT NULL DEFAULT FALSE
    CHECK (automatic_fallback_enabled = FALSE),
  contract_version TEXT NOT NULL,
  decision JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_scene_routing_scene_unique UNIQUE (scene_execution_id),
  CONSTRAINT ai_story_scene_routing_hash_unique UNIQUE (deterministic_integrity_hash)
);

CREATE INDEX IF NOT EXISTS ai_story_scene_routing_plan_idx
  ON ai_story_scene_routing_decisions (execution_plan_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_scene_routing_workspace_idx
  ON ai_story_scene_routing_decisions (workspace_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_scene_routing_auth_idx
  ON ai_story_scene_routing_decisions (runtime_authorization_id);

CREATE TABLE IF NOT EXISTS ai_story_scene_scheduling_correlations (
  correlation_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_execution_id UUID NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  runtime_authorization_id UUID NOT NULL
    REFERENCES ai_story_runtime_authorized_facts(runtime_authorization_id) ON DELETE RESTRICT,
  routing_decision_id UUID NOT NULL
    REFERENCES ai_story_scene_routing_decisions(routing_decision_id) ON DELETE RESTRICT,
  provider_execution_id TEXT NOT NULL
    REFERENCES provider_executions(execution_id) ON DELETE RESTRICT,
  envelope_id TEXT NOT NULL
    REFERENCES provider_execution_envelopes(envelope_id) ON DELETE RESTRICT,
  outbox_job_id TEXT NOT NULL
    REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT,
  request_hash TEXT NOT NULL,
  envelope_hash TEXT NOT NULL,
  routing_decision_hash TEXT NOT NULL,
  authorization_hash TEXT NOT NULL,
  scheduling_identity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  scheduled_by UUID NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  correlation JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_scene_scheduling_scene_unique UNIQUE (scene_execution_id),
  CONSTRAINT ai_story_scene_scheduling_provider_unique UNIQUE (provider_execution_id),
  CONSTRAINT ai_story_scene_scheduling_outbox_unique UNIQUE (outbox_job_id),
  CONSTRAINT ai_story_scene_scheduling_identity_unique UNIQUE (scheduling_identity_hash)
);

CREATE INDEX IF NOT EXISTS ai_story_scene_scheduling_plan_idx
  ON ai_story_scene_scheduling_correlations (execution_plan_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_scene_scheduling_workspace_idx
  ON ai_story_scene_scheduling_correlations (workspace_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_scene_scheduling_auth_idx
  ON ai_story_scene_scheduling_correlations (runtime_authorization_id);
