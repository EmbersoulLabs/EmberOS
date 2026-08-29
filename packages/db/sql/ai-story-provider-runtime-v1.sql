CREATE TABLE IF NOT EXISTS ai_story_compiled_provider_requests(
  compiled_request_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  scene_execution_id uuid NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  request_fingerprint text NOT NULL UNIQUE CHECK(request_fingerprint~'^sha256:[0-9a-f]{64}$'),
  generation_mode text NOT NULL CHECK(generation_mode IN('TEXT_TO_VIDEO','FIRST_FRAME_IMAGE_TO_VIDEO')),
  provider_id text NOT NULL CHECK(provider_id='seedance'),
  model_id text NOT NULL CHECK(model_id='dreamina-seedance-2-0-260128'),
  adapter_version text NOT NULL,
  mapping_version text NOT NULL,
  capability_version text NOT NULL,
  qc_evaluation_id uuid NOT NULL,
  qc_fingerprint text NOT NULL,
  compiled_request jsonb NOT NULL,
  compiled_at timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_story_compiled_request_scene_idx ON ai_story_compiled_provider_requests(scene_execution_id,compiled_at);
CREATE INDEX IF NOT EXISTS ai_story_compiled_request_workspace_idx ON ai_story_compiled_provider_requests(workspace_id,compiled_at);
ALTER TABLE ai_story_compiled_provider_requests ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION enforce_ai_story_compiled_request_immutable_v1()RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Compiled Provider request is immutable' USING ERRCODE='23514';END $$;
DROP TRIGGER IF EXISTS ai_story_compiled_request_immutable_v1 ON ai_story_compiled_provider_requests;
CREATE TRIGGER ai_story_compiled_request_immutable_v1 BEFORE UPDATE OR DELETE ON ai_story_compiled_provider_requests FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_compiled_request_immutable_v1();
DROP POLICY IF EXISTS ai_story_compiled_request_select ON ai_story_compiled_provider_requests;
CREATE POLICY ai_story_compiled_request_select ON ai_story_compiled_provider_requests FOR SELECT TO authenticated USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()));
DROP POLICY IF EXISTS ai_story_compiled_request_insert ON ai_story_compiled_provider_requests;
CREATE POLICY ai_story_compiled_request_insert ON ai_story_compiled_provider_requests FOR INSERT TO authenticated WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()AND role IN('admin','operator','editor','reviewer')));

CREATE TABLE IF NOT EXISTS ai_story_provider_attempt_compiled_bindings(
  provider_attempt_id text PRIMARY KEY REFERENCES provider_attempts(attempt_id) ON DELETE RESTRICT,
  compiled_request_id uuid NOT NULL REFERENCES ai_story_compiled_provider_requests(compiled_request_id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  scene_execution_id uuid NOT NULL REFERENCES ai_story_scene_executions(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  request_fingerprint text NOT NULL,
  attempt_input_fingerprint text NOT NULL UNIQUE,
  status text NOT NULL,
  provider_task_id text,
  submission_claim_owner text,
  submission_claimed_at timestamptz,
  poll_count integer NOT NULL DEFAULT 0,
  failure_class text,
  binding jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ai_story_provider_attempt_binding_scene_idx ON ai_story_provider_attempt_compiled_bindings(scene_execution_id,created_at);
CREATE INDEX IF NOT EXISTS ai_story_provider_attempt_binding_workspace_idx ON ai_story_provider_attempt_compiled_bindings(workspace_id,created_at);
ALTER TABLE ai_story_provider_attempt_compiled_bindings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_story_provider_attempt_binding_select ON ai_story_provider_attempt_compiled_bindings;
CREATE POLICY ai_story_provider_attempt_binding_select ON ai_story_provider_attempt_compiled_bindings FOR SELECT TO authenticated USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()));
DROP POLICY IF EXISTS ai_story_provider_attempt_binding_insert ON ai_story_provider_attempt_compiled_bindings;
CREATE POLICY ai_story_provider_attempt_binding_insert ON ai_story_provider_attempt_compiled_bindings FOR INSERT TO authenticated WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()AND role IN('admin','operator')));
DROP POLICY IF EXISTS ai_story_provider_attempt_binding_update ON ai_story_provider_attempt_compiled_bindings;
CREATE POLICY ai_story_provider_attempt_binding_update ON ai_story_provider_attempt_compiled_bindings FOR UPDATE TO authenticated USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()AND role IN('admin','operator'))) WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()AND role IN('admin','operator')));
