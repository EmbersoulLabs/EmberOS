CREATE TABLE IF NOT EXISTS ai_story_pre_dispatch_bundle_supersessions (
  supersession_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  scene_execution_id uuid NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  source_compiled_request_id uuid NOT NULL REFERENCES ai_story_compiled_provider_requests(compiled_request_id) ON DELETE RESTRICT,
  source_correlation_id uuid NOT NULL REFERENCES ai_story_scene_scheduling_correlations(correlation_id) ON DELETE RESTRICT,
  source_outbox_job_id text NOT NULL REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT,
  source_dispatch_id text NOT NULL REFERENCES provider_execution_dispatches(dispatch_id) ON DELETE RESTRICT,
  successor_compiled_request_id uuid NOT NULL REFERENCES ai_story_compiled_provider_requests(compiled_request_id) ON DELETE RESTRICT,
  successor_correlation_id uuid NOT NULL REFERENCES ai_story_scene_scheduling_correlations(correlation_id) ON DELETE RESTRICT,
  successor_outbox_job_id text NOT NULL REFERENCES provider_outbox_jobs(job_id) ON DELETE RESTRICT,
  successor_dispatch_id text NOT NULL REFERENCES provider_execution_dispatches(dispatch_id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (reason IN (
    'I2V_PROVIDER_INPUT_PROJECTION_DEFECT',
    'DETERMINISTIC_PRE_DISPATCH_AUTHORITY_DEFECT',
    'REVIEW_RETRY_CREATIVE_INSTRUCTION_PRECEDENCE_DEFECT'
  )),
  actor_user_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  target_contract_version text NOT NULL,
  authority_version text NOT NULL CHECK (authority_version = 'ai-story-pre-dispatch-bundle-supersession.v1'),
  paid_side_effect_evidence jsonb NOT NULL,
  integrity_hash text NOT NULL CHECK (integrity_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_bundle_supersession_distinct_compiled CHECK (source_compiled_request_id <> successor_compiled_request_id),
  CONSTRAINT ai_story_bundle_supersession_distinct_correlation CHECK (source_correlation_id <> successor_correlation_id),
  CONSTRAINT ai_story_bundle_supersession_distinct_outbox CHECK (source_outbox_job_id <> successor_outbox_job_id),
  CONSTRAINT ai_story_bundle_supersession_distinct_dispatch CHECK (source_dispatch_id <> successor_dispatch_id),
  CONSTRAINT ai_story_bundle_supersession_source_unique UNIQUE (source_compiled_request_id),
  CONSTRAINT ai_story_bundle_supersession_source_correlation_unique UNIQUE (source_correlation_id),
  CONSTRAINT ai_story_bundle_supersession_source_outbox_unique UNIQUE (source_outbox_job_id),
  CONSTRAINT ai_story_bundle_supersession_source_dispatch_unique UNIQUE (source_dispatch_id),
  CONSTRAINT ai_story_bundle_supersession_successor_compiled_unique UNIQUE (successor_compiled_request_id),
  CONSTRAINT ai_story_bundle_supersession_successor_correlation_unique UNIQUE (successor_correlation_id),
  CONSTRAINT ai_story_bundle_supersession_successor_outbox_unique UNIQUE (successor_outbox_job_id),
  CONSTRAINT ai_story_bundle_supersession_successor_dispatch_unique UNIQUE (successor_dispatch_id),
  CONSTRAINT ai_story_bundle_supersession_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT ai_story_bundle_supersession_integrity_unique UNIQUE (integrity_hash)
);

CREATE INDEX IF NOT EXISTS ai_story_bundle_supersession_scene_idx
  ON ai_story_pre_dispatch_bundle_supersessions(scene_execution_id, created_at);

ALTER TABLE ai_story_pre_dispatch_bundle_supersessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_bundle_supersession_select ON ai_story_pre_dispatch_bundle_supersessions;
CREATE POLICY ai_story_bundle_supersession_select
  ON ai_story_pre_dispatch_bundle_supersessions
  FOR SELECT TO authenticated
  USING (workspace_id IN (
    SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
  ));

DROP POLICY IF EXISTS ai_story_bundle_supersession_insert ON ai_story_pre_dispatch_bundle_supersessions;
CREATE POLICY ai_story_bundle_supersession_insert
  ON ai_story_pre_dispatch_bundle_supersessions
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid() AND role IN ('admin','operator')
  ));

CREATE OR REPLACE FUNCTION enforce_ai_story_bundle_supersession_immutable_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI Story pre-dispatch bundle supersession authority is immutable'
    USING ERRCODE = '23514';
END $$;

DROP TRIGGER IF EXISTS ai_story_bundle_supersession_immutable_v1
  ON ai_story_pre_dispatch_bundle_supersessions;
CREATE TRIGGER ai_story_bundle_supersession_immutable_v1
  BEFORE UPDATE OR DELETE ON ai_story_pre_dispatch_bundle_supersessions
  FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_bundle_supersession_immutable_v1();
