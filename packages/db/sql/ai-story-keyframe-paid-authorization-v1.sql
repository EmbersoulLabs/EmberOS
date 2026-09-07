-- Immutable subordinate AI Story authority for one paid keyframe image-generation call.
CREATE TABLE IF NOT EXISTS ai_story_keyframe_paid_authorizations (
  authorization_id uuid PRIMARY KEY,
  contract_version text NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  scene_id uuid NOT NULL,
  scene_version_id uuid NOT NULL,
  preparation_authority_id text NOT NULL,
  preparation_fingerprint text NOT NULL,
  keyframe_brief_fingerprint text NOT NULL,
  provider_id text NOT NULL,
  model_id text NOT NULL,
  maximum_image_provider_calls integer NOT NULL,
  authorized_by uuid NOT NULL,
  authorized_at timestamptz NOT NULL,
  authorization_reason text NOT NULL,
  deterministic_integrity_hash text NOT NULL,
  fact jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_story_keyframe_paid_auth_integrity_unique UNIQUE (deterministic_integrity_hash),
  CONSTRAINT ai_story_keyframe_paid_auth_contract_check CHECK (contract_version = 'ai-story-keyframe-paid-authorization.v1'),
  CONSTRAINT ai_story_keyframe_paid_auth_calls_check CHECK (maximum_image_provider_calls = 1),
  CONSTRAINT ai_story_keyframe_paid_auth_reason_check CHECK (authorization_reason = 'EXPLICIT_PAID_KEYFRAME_GENERATION_CONFIRMATION'),
  CONSTRAINT ai_story_keyframe_paid_auth_hashes_check CHECK (
    preparation_fingerprint ~ '^sha256:[a-f0-9]{64}$' AND
    keyframe_brief_fingerprint ~ '^sha256:[a-f0-9]{64}$' AND
    deterministic_integrity_hash ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT ai_story_keyframe_paid_auth_text_check CHECK (
    btrim(preparation_authority_id) <> '' AND btrim(provider_id) <> '' AND btrim(model_id) <> '')
);

CREATE INDEX IF NOT EXISTS ai_story_keyframe_paid_auth_scope_idx
  ON ai_story_keyframe_paid_authorizations(workspace_id, story_id, scene_id, created_at);

CREATE OR REPLACE FUNCTION validate_ai_story_keyframe_paid_authority_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = NEW.workspace_id AND w.org_id = NEW.org_id)
     OR NOT EXISTS (SELECT 1 FROM ai_stories s WHERE s.id = NEW.story_id AND s.workspace_id = NEW.workspace_id AND s.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'AI_STORY_KEYFRAME_PAID_AUTHORITY_SCOPE_INVALID';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_story_keyframe_paid_auth_scope_v1 ON ai_story_keyframe_paid_authorizations;
CREATE TRIGGER ai_story_keyframe_paid_auth_scope_v1 BEFORE INSERT ON ai_story_keyframe_paid_authorizations
  FOR EACH ROW EXECUTE FUNCTION validate_ai_story_keyframe_paid_authority_v1();

CREATE OR REPLACE FUNCTION deny_ai_story_keyframe_paid_authority_mutation_v1()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI_STORY_KEYFRAME_PAID_AUTHORITY_IMMUTABLE';
END $$;

DROP TRIGGER IF EXISTS ai_story_keyframe_paid_auth_immutable_v1 ON ai_story_keyframe_paid_authorizations;
CREATE TRIGGER ai_story_keyframe_paid_auth_immutable_v1 BEFORE UPDATE OR DELETE ON ai_story_keyframe_paid_authorizations
  FOR EACH ROW EXECUTE FUNCTION deny_ai_story_keyframe_paid_authority_mutation_v1();

ALTER TABLE ai_story_keyframe_paid_authorizations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    DROP POLICY IF EXISTS ai_story_keyframe_paid_auth_service_role ON ai_story_keyframe_paid_authorizations;
    CREATE POLICY ai_story_keyframe_paid_auth_service_role ON ai_story_keyframe_paid_authorizations
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
