-- Canonical append-only human authorization for a terminal pre-result Provider retry.
-- STAGING lifecycle authority only; this migration performs no execution or commercial mutation.

CREATE TABLE IF NOT EXISTS ai_story_post_terminal_provider_retry_authorizations (
  authorization_id uuid PRIMARY KEY,
  environment text NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  execution_plan_id uuid NOT NULL REFERENCES ai_story_execution_plans(id) ON DELETE RESTRICT,
  scene_execution_id uuid NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  source_compiled_request_id uuid NOT NULL REFERENCES ai_story_compiled_provider_requests(compiled_request_id) ON DELETE RESTRICT,
  source_compiled_request_fingerprint text NOT NULL,
  prior_provider_attempt_id text NOT NULL REFERENCES provider_attempts(attempt_id) ON DELETE RESTRICT,
  prior_worker_result_id uuid NOT NULL REFERENCES ai_story_worker_execution_results(worker_execution_result_id) ON DELETE RESTRICT,
  prior_reservation_id uuid NOT NULL REFERENCES certification_commercial_reservations(certification_reservation_id) ON DELETE RESTRICT,
  failure_classification text NOT NULL,
  failure_code text NOT NULL,
  retry_reason text NOT NULL,
  human_decision text NOT NULL,
  authorized_by uuid NOT NULL,
  authorized_at timestamptz NOT NULL,
  retry_generation integer NOT NULL,
  target_compiler_contract_version text NOT NULL,
  target_mode text NOT NULL,
  commercial_authorization_id uuid NOT NULL REFERENCES commercial_execution_authorizations(commercial_authorization_id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL,
  integrity_hash text NOT NULL,
  contract_version text NOT NULL,
  fact jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_story_post_terminal_retry_source_contract_unique UNIQUE
    (prior_provider_attempt_id, failure_classification, target_compiler_contract_version),
  CONSTRAINT ai_story_post_terminal_retry_idempotency_unique UNIQUE (idempotency_key),
  CONSTRAINT ai_story_post_terminal_retry_integrity_unique UNIQUE (integrity_hash),
  CONSTRAINT ai_story_post_terminal_retry_worker_result_unique UNIQUE (prior_worker_result_id),
  CONSTRAINT ai_story_post_terminal_retry_environment_check CHECK (environment = 'STAGING'),
  CONSTRAINT ai_story_post_terminal_retry_human_decision_check CHECK (human_decision = 'AUTHORIZE_ONE_RETRY'),
  CONSTRAINT ai_story_post_terminal_retry_generation_check CHECK (retry_generation >= 2),
  CONSTRAINT ai_story_post_terminal_retry_contract_check CHECK (contract_version = 'ai-story-post-terminal-provider-retry.v1')
);

CREATE INDEX IF NOT EXISTS ai_story_post_terminal_retry_scene_idx
  ON ai_story_post_terminal_provider_retry_authorizations(scene_execution_id, created_at);
CREATE INDEX IF NOT EXISTS ai_story_post_terminal_retry_workspace_idx
  ON ai_story_post_terminal_provider_retry_authorizations(workspace_id, created_at);

ALTER TABLE ai_story_scene_scheduling_correlations
  ADD COLUMN IF NOT EXISTS post_terminal_retry_authorization_id uuid,
  ADD COLUMN IF NOT EXISTS source_provider_attempt_id text;

DO $$ BEGIN
  ALTER TABLE ai_story_scene_scheduling_correlations
    ADD CONSTRAINT ai_story_scene_scheduling_post_terminal_retry_fk
    FOREIGN KEY (post_terminal_retry_authorization_id)
    REFERENCES ai_story_post_terminal_provider_retry_authorizations(authorization_id)
    ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ai_story_scene_scheduling_post_terminal_retry_unique
  ON ai_story_scene_scheduling_correlations(post_terminal_retry_authorization_id)
  WHERE post_terminal_retry_authorization_id IS NOT NULL;

CREATE OR REPLACE FUNCTION deny_ai_story_post_terminal_retry_mutation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI_STORY_POST_TERMINAL_RETRY_AUTHORITY_IMMUTABLE';
END $$;

DROP TRIGGER IF EXISTS ai_story_post_terminal_retry_immutable_v1
  ON ai_story_post_terminal_provider_retry_authorizations;
CREATE TRIGGER ai_story_post_terminal_retry_immutable_v1
  BEFORE UPDATE OR DELETE ON ai_story_post_terminal_provider_retry_authorizations
  FOR EACH ROW EXECUTE FUNCTION deny_ai_story_post_terminal_retry_mutation_v1();

ALTER TABLE ai_story_post_terminal_provider_retry_authorizations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    DROP POLICY IF EXISTS ai_story_post_terminal_retry_service_role
      ON ai_story_post_terminal_provider_retry_authorizations;
    CREATE POLICY ai_story_post_terminal_retry_service_role
      ON ai_story_post_terminal_provider_retry_authorizations
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
