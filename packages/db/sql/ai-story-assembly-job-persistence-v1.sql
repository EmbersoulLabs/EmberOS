-- Sprint 3 PR 3.6 Phase 3: deterministic Assembly Job persistence.
-- Append-only Assembly Job Facts. No Final Story Result. No media assembly.
-- Execution Plan remains the sole Aggregate Root.

CREATE TABLE IF NOT EXISTS ai_story_assembly_jobs (
  assembly_job_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  assembly_definition_id UUID NOT NULL
    REFERENCES ai_story_assembly_definitions(assembly_definition_id) ON DELETE RESTRICT,
  runtime_authorization_id UUID NOT NULL,
  ordered_scene_result_ids JSONB NOT NULL,
  ordered_scene_content_hashes JSONB NOT NULL,
  assembly_contract_version TEXT NOT NULL,
  assembly_engine_snapshot_id UUID NOT NULL,
  assembly_engine_snapshot_hash TEXT NOT NULL,
  deterministic_fingerprint TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  job JSONB NOT NULL,
  CONSTRAINT ai_story_assembly_jobs_fingerprint_unique UNIQUE (deterministic_fingerprint)
);

CREATE INDEX IF NOT EXISTS ai_story_assembly_jobs_plan_idx
  ON ai_story_assembly_jobs (execution_plan_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_assembly_jobs_workspace_idx
  ON ai_story_assembly_jobs (workspace_id, accepted_at);
CREATE INDEX IF NOT EXISTS ai_story_assembly_jobs_definition_idx
  ON ai_story_assembly_jobs (assembly_definition_id);

CREATE TABLE IF NOT EXISTS ai_story_assembly_job_facts (
  fact_id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id UUID NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id UUID NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  animation_package_id UUID NOT NULL REFERENCES ai_story_animation_packages(id) ON DELETE RESTRICT,
  execution_plan_id UUID NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  assembly_job_id UUID NOT NULL
    REFERENCES ai_story_assembly_jobs(assembly_job_id) ON DELETE RESTRICT,
  fact_kind TEXT NOT NULL
    CHECK (fact_kind IN ('ACCEPTED', 'PROCESSING_STARTED', 'SUCCEEDED', 'FAILED')),
  integrity_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  fact JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ai_story_assembly_job_facts_hash_unique UNIQUE (integrity_hash)
);

-- At most one ACCEPTED fact per Assembly Job.
CREATE UNIQUE INDEX IF NOT EXISTS ai_story_assembly_job_facts_accepted_unique
  ON ai_story_assembly_job_facts (assembly_job_id)
  WHERE fact_kind = 'ACCEPTED';

-- Exactly one terminal outcome (SUCCEEDED or FAILED) per Assembly Job.
CREATE UNIQUE INDEX IF NOT EXISTS ai_story_assembly_job_facts_terminal_unique
  ON ai_story_assembly_job_facts (assembly_job_id)
  WHERE fact_kind IN ('SUCCEEDED', 'FAILED');

CREATE INDEX IF NOT EXISTS ai_story_assembly_job_facts_job_idx
  ON ai_story_assembly_job_facts (assembly_job_id, recorded_at);
CREATE INDEX IF NOT EXISTS ai_story_assembly_job_facts_workspace_idx
  ON ai_story_assembly_job_facts (workspace_id, recorded_at);
CREATE INDEX IF NOT EXISTS ai_story_assembly_job_facts_plan_idx
  ON ai_story_assembly_job_facts (execution_plan_id, recorded_at);
