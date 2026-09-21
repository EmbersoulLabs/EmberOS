-- Additive durable Episode revision persistence.
-- Revisions create new versions. Historical authority is never mutated in place.
-- Persistence is not Provider execution.

CREATE TABLE IF NOT EXISTS ai_story_episode_revisions (
  revision_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  episode_id uuid NOT NULL,
  revision_type text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  status text NOT NULL,
  revision_version integer NOT NULL CONSTRAINT ai_story_episode_revision_version_positive CHECK (revision_version > 0),
  contract_version text NOT NULL,
  idempotency_key text,
  revision_request jsonb NOT NULL,
  impact jsonb NOT NULL,
  execution_plan jsonb NOT NULL,
  source_version_ids jsonb NOT NULL,
  result_version_ids jsonb NOT NULL,
  source_fingerprints jsonb NOT NULL,
  result_fingerprints jsonb NOT NULL,
  impact_summary text NOT NULL,
  requires_provider_execution boolean NOT NULL,
  requires_assembly_rebuild boolean NOT NULL,
  commercial_authorization_status text NOT NULL,
  spend_authorization_created boolean NOT NULL DEFAULT false,
  obsolete_retry_authorization_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  CONSTRAINT ai_story_episode_revision_type_check CHECK (revision_type IN ('EDIT_DIALOGUE','ADJUST_ENDING','ADJUST_PACING','REPLACE_REFERENCE','REGENERATE_MOMENT')),
  CONSTRAINT ai_story_episode_revision_status_check CHECK (status IN ('PROPOSED','PERSISTED','AWAITING_AUTHORIZATION','READY_FOR_REGENERATION','REGENERATION_IN_PROGRESS','REASSEMBLY_REQUIRED','COMPLETED','FAILED','SUPERSEDED')),
  CONSTRAINT ai_story_episode_revision_contract_check CHECK (contract_version = 'ai-story-episode-revision-authority.v1'),
  CONSTRAINT ai_story_episode_revision_no_spend_check CHECK (spend_authorization_created = false)
);

CREATE UNIQUE INDEX IF NOT EXISTS ai_story_episode_revision_idempotency_unique
  ON ai_story_episode_revisions (org_id, workspace_id, story_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_story_episode_revision_workspace_idx
  ON ai_story_episode_revisions (workspace_id, story_id, revision_version);
CREATE INDEX IF NOT EXISTS ai_story_episode_revision_story_created_idx
  ON ai_story_episode_revisions (story_id, created_at);

CREATE TABLE IF NOT EXISTS ai_story_episode_revision_current (
  story_id uuid PRIMARY KEY REFERENCES ai_stories(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  current_revision_id uuid NOT NULL REFERENCES ai_story_episode_revisions(revision_id) ON DELETE RESTRICT,
  current_revision_version integer NOT NULL,
  current_script_version_id uuid REFERENCES ai_story_script_versions(script_version_id) ON DELETE RESTRICT,
  current_story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  current_editorial_plan_id uuid,
  current_reference_binding_id uuid,
  current_reference_fingerprint text,
  current_assembly_fingerprint text,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_story_editorial_plan_versions (
  editorial_plan_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  script_version_id uuid REFERENCES ai_story_script_versions(script_version_id) ON DELETE RESTRICT,
  version integer NOT NULL CONSTRAINT ai_story_editorial_plan_version_positive CHECK (version > 0),
  status text NOT NULL,
  editorial_fingerprint text NOT NULL,
  supersedes_editorial_plan_id uuid REFERENCES ai_story_editorial_plan_versions(editorial_plan_id) ON DELETE RESTRICT,
  revision_id uuid REFERENCES ai_story_episode_revisions(revision_id) ON DELETE RESTRICT,
  plan jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_editorial_plan_status_check CHECK (status IN ('FROZEN','SUPERSEDED')),
  CONSTRAINT ai_story_editorial_plan_story_version_unique UNIQUE (story_id, version),
  CONSTRAINT ai_story_editorial_plan_fingerprint_unique UNIQUE (story_id, editorial_fingerprint)
);

CREATE INDEX IF NOT EXISTS ai_story_editorial_plan_workspace_idx
  ON ai_story_editorial_plan_versions (workspace_id, story_id, version);

CREATE TABLE IF NOT EXISTS ai_story_reference_binding_versions (
  reference_binding_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  version integer NOT NULL CONSTRAINT ai_story_reference_binding_version_positive CHECK (version > 0),
  status text NOT NULL,
  reference_kind text NOT NULL,
  authority_id uuid NOT NULL,
  source_asset_id uuid,
  source_content_hash text,
  fingerprint text NOT NULL,
  supersedes_binding_id uuid REFERENCES ai_story_reference_binding_versions(reference_binding_id) ON DELETE RESTRICT,
  revision_id uuid REFERENCES ai_story_episode_revisions(revision_id) ON DELETE RESTRICT,
  binding jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_reference_binding_status_check CHECK (status IN ('CURRENT','SUPERSEDED')),
  CONSTRAINT ai_story_reference_binding_kind_check CHECK (reference_kind IN ('PRODUCT','LOCATION','CHARACTER','BRAND','VISUAL')),
  CONSTRAINT ai_story_reference_binding_story_version_unique UNIQUE (story_id, reference_kind, version),
  CONSTRAINT ai_story_reference_binding_fingerprint_unique UNIQUE (story_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS ai_story_reference_binding_workspace_idx
  ON ai_story_reference_binding_versions (workspace_id, story_id, version);

CREATE TABLE IF NOT EXISTS ai_story_revision_stale_authorities (
  stale_authority_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  revision_id uuid NOT NULL REFERENCES ai_story_episode_revisions(revision_id) ON DELETE RESTRICT,
  authority_type text NOT NULL,
  authority_id uuid NOT NULL,
  status text NOT NULL,
  source_version_id uuid,
  current_version_id uuid,
  historical_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_revision_stale_type_check CHECK (authority_type IN ('GENERATION_UNIT','NATIVE_DIALOGUE','DIRECTOR_SHOT','PROVIDER_RESULT','EDITORIAL_ENTRY','ASSEMBLY')),
  CONSTRAINT ai_story_revision_stale_status_check CHECK (status IN ('VALID','STALE','SUPERSEDED')),
  CONSTRAINT ai_story_revision_stale_unique UNIQUE (revision_id, authority_type, authority_id)
);

CREATE INDEX IF NOT EXISTS ai_story_revision_stale_workspace_idx
  ON ai_story_revision_stale_authorities (workspace_id, story_id, status);

ALTER TABLE ai_story_episode_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_episode_revision_current ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_editorial_plan_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_reference_binding_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_revision_stale_authorities ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION enforce_ai_story_episode_revision_identity_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision_id IS DISTINCT FROM OLD.revision_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
    OR NEW.story_id IS DISTINCT FROM OLD.story_id OR NEW.revision_type IS DISTINCT FROM OLD.revision_type
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.spend_authorization_created IS DISTINCT FROM OLD.spend_authorization_created THEN
    RAISE EXCEPTION 'AI Story Episode revision identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_story_episode_revision_identity_v1 ON ai_story_episode_revisions;
CREATE TRIGGER ai_story_episode_revision_identity_v1 BEFORE UPDATE ON ai_story_episode_revisions
  FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_episode_revision_identity_v1();

CREATE OR REPLACE FUNCTION enforce_ai_story_editorial_plan_immutability_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.editorial_plan_id IS DISTINCT FROM OLD.editorial_plan_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.story_id IS DISTINCT FROM OLD.story_id
    OR NEW.version IS DISTINCT FROM OLD.version OR NEW.editorial_fingerprint IS DISTINCT FROM OLD.editorial_fingerprint
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AI Story Editorial Plan identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('FROZEN','SUPERSEDED') AND (NEW.plan) IS DISTINCT FROM (OLD.plan) THEN
    RAISE EXCEPTION 'Frozen AI Story Editorial Plan content is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='FROZEN' AND NEW.status='SUPERSEDED') THEN
    RAISE EXCEPTION 'Invalid AI Story Editorial Plan lifecycle transition: % -> %', OLD.status, NEW.status USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_story_editorial_plan_immutability_v1 ON ai_story_editorial_plan_versions;
CREATE TRIGGER ai_story_editorial_plan_immutability_v1 BEFORE UPDATE ON ai_story_editorial_plan_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_editorial_plan_immutability_v1();

CREATE OR REPLACE FUNCTION enforce_ai_story_reference_binding_immutability_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reference_binding_id IS DISTINCT FROM OLD.reference_binding_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.story_id IS DISTINCT FROM OLD.story_id
    OR NEW.version IS DISTINCT FROM OLD.version OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
    OR NEW.authority_id IS DISTINCT FROM OLD.authority_id OR NEW.source_asset_id IS DISTINCT FROM OLD.source_asset_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.binding IS DISTINCT FROM OLD.binding THEN
    RAISE EXCEPTION 'AI Story reference binding identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='CURRENT' AND NEW.status='SUPERSEDED') THEN
    RAISE EXCEPTION 'Invalid AI Story reference binding lifecycle transition: % -> %', OLD.status, NEW.status USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_story_reference_binding_immutability_v1 ON ai_story_reference_binding_versions;
CREATE TRIGGER ai_story_reference_binding_immutability_v1 BEFORE UPDATE ON ai_story_reference_binding_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_reference_binding_immutability_v1();

DROP POLICY IF EXISTS ai_story_episode_revision_select ON ai_story_episode_revisions;
CREATE POLICY ai_story_episode_revision_select ON ai_story_episode_revisions FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()));
DROP POLICY IF EXISTS ai_story_episode_revision_insert ON ai_story_episode_revisions;
CREATE POLICY ai_story_episode_revision_insert ON ai_story_episode_revisions FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));
DROP POLICY IF EXISTS ai_story_episode_revision_update ON ai_story_episode_revisions;
CREATE POLICY ai_story_episode_revision_update ON ai_story_episode_revisions FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));

DROP POLICY IF EXISTS ai_story_episode_revision_current_select ON ai_story_episode_revision_current;
CREATE POLICY ai_story_episode_revision_current_select ON ai_story_episode_revision_current FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()));
DROP POLICY IF EXISTS ai_story_episode_revision_current_write ON ai_story_episode_revision_current;
CREATE POLICY ai_story_episode_revision_current_write ON ai_story_episode_revision_current FOR ALL TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));

DROP POLICY IF EXISTS ai_story_editorial_plan_select ON ai_story_editorial_plan_versions;
CREATE POLICY ai_story_editorial_plan_select ON ai_story_editorial_plan_versions FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()));
DROP POLICY IF EXISTS ai_story_editorial_plan_insert ON ai_story_editorial_plan_versions;
CREATE POLICY ai_story_editorial_plan_insert ON ai_story_editorial_plan_versions FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));
DROP POLICY IF EXISTS ai_story_editorial_plan_update ON ai_story_editorial_plan_versions;
CREATE POLICY ai_story_editorial_plan_update ON ai_story_editorial_plan_versions FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));

DROP POLICY IF EXISTS ai_story_reference_binding_select ON ai_story_reference_binding_versions;
CREATE POLICY ai_story_reference_binding_select ON ai_story_reference_binding_versions FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()));
DROP POLICY IF EXISTS ai_story_reference_binding_insert ON ai_story_reference_binding_versions;
CREATE POLICY ai_story_reference_binding_insert ON ai_story_reference_binding_versions FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));
DROP POLICY IF EXISTS ai_story_reference_binding_update ON ai_story_reference_binding_versions;
CREATE POLICY ai_story_reference_binding_update ON ai_story_reference_binding_versions FOR UPDATE TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')))
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));

DROP POLICY IF EXISTS ai_story_revision_stale_select ON ai_story_revision_stale_authorities;
CREATE POLICY ai_story_revision_stale_select ON ai_story_revision_stale_authorities FOR SELECT TO authenticated
  USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()));
DROP POLICY IF EXISTS ai_story_revision_stale_insert ON ai_story_revision_stale_authorities;
CREATE POLICY ai_story_revision_stale_insert ON ai_story_revision_stale_authorities FOR INSERT TO authenticated
  WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));
