CREATE TABLE IF NOT EXISTS ai_story_script_versions (
  script_version_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  outline_version_id uuid NOT NULL REFERENCES ai_story_outline_versions(outline_version_id) ON DELETE RESTRICT,
  version integer NOT NULL CONSTRAINT ai_story_script_version_positive CHECK (version > 0),
  contract_version text NOT NULL CONSTRAINT ai_story_script_contract_check CHECK (contract_version = 'ai-story-script.v1'),
  profile_id text NOT NULL CONSTRAINT ai_story_script_profile_check CHECK (profile_id = 'CORE'), profile_version integer NOT NULL CONSTRAINT ai_story_script_profile_version_check CHECK (profile_version = 1),
  outline_source_hash text NOT NULL CONSTRAINT ai_story_script_outline_hash_check CHECK (outline_source_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_hash text NOT NULL CONSTRAINT ai_story_script_source_hash_check CHECK (source_hash ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CONSTRAINT ai_story_script_status_check CHECK (status IN ('DRAFT','VALIDATED','APPROVED','FROZEN','SUPERSEDED')),
  supersedes_script_version_id uuid REFERENCES ai_story_script_versions(script_version_id) ON DELETE RESTRICT,
  script jsonb NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL,
  approved_by uuid, approved_at timestamptz, frozen_at timestamptz,
  CONSTRAINT ai_story_script_story_version_unique UNIQUE (story_id, version),
  CONSTRAINT ai_story_script_source_unique UNIQUE (story_id, source_hash)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_script_version_positive') THEN ALTER TABLE ai_story_script_versions ADD CONSTRAINT ai_story_script_version_positive CHECK(version>0); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_script_contract_check') THEN ALTER TABLE ai_story_script_versions ADD CONSTRAINT ai_story_script_contract_check CHECK(contract_version='ai-story-script.v1'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_script_profile_check') THEN ALTER TABLE ai_story_script_versions ADD CONSTRAINT ai_story_script_profile_check CHECK(profile_id='CORE'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_script_profile_version_check') THEN ALTER TABLE ai_story_script_versions ADD CONSTRAINT ai_story_script_profile_version_check CHECK(profile_version=1); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_script_outline_hash_check') THEN ALTER TABLE ai_story_script_versions ADD CONSTRAINT ai_story_script_outline_hash_check CHECK(outline_source_hash ~ '^sha256:[0-9a-f]{64}$'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_script_source_hash_check') THEN ALTER TABLE ai_story_script_versions ADD CONSTRAINT ai_story_script_source_hash_check CHECK(source_hash ~ '^sha256:[0-9a-f]{64}$'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_script_status_check') THEN ALTER TABLE ai_story_script_versions ADD CONSTRAINT ai_story_script_status_check CHECK(status IN ('DRAFT','VALIDATED','APPROVED','FROZEN','SUPERSEDED')); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_script_outline_fk') THEN ALTER TABLE ai_story_script_versions ADD CONSTRAINT ai_story_script_outline_fk FOREIGN KEY(outline_version_id) REFERENCES ai_story_outline_versions(outline_version_id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_script_supersedes_fk') THEN ALTER TABLE ai_story_script_versions ADD CONSTRAINT ai_story_script_supersedes_fk FOREIGN KEY(supersedes_script_version_id) REFERENCES ai_story_script_versions(script_version_id) ON DELETE RESTRICT; END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_story_script_workspace_idx ON ai_story_script_versions(workspace_id,story_id,version);
CREATE INDEX IF NOT EXISTS ai_story_script_outline_idx ON ai_story_script_versions(outline_version_id,version);
ALTER TABLE ai_story_script_versions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION enforce_ai_story_script_lifecycle_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.script_version_id IS DISTINCT FROM OLD.script_version_id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
    OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.story_id IS DISTINCT FROM OLD.story_id OR NEW.story_version_id IS DISTINCT FROM OLD.story_version_id
    OR NEW.outline_version_id IS DISTINCT FROM OLD.outline_version_id OR NEW.version IS DISTINCT FROM OLD.version OR NEW.contract_version IS DISTINCT FROM OLD.contract_version
    OR NEW.profile_id IS DISTINCT FROM OLD.profile_id OR NEW.profile_version IS DISTINCT FROM OLD.profile_version OR NEW.outline_source_hash IS DISTINCT FROM OLD.outline_source_hash
    OR NEW.source_hash IS DISTINCT FROM OLD.source_hash OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AI Story Script authority identity is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='DRAFT' AND NEW.status='VALIDATED') OR (OLD.status='VALIDATED' AND NEW.status='APPROVED') OR (OLD.status='APPROVED' AND NEW.status='FROZEN') OR (OLD.status='FROZEN' AND NEW.status='SUPERSEDED')) THEN
    RAISE EXCEPTION 'Invalid AI Story Script lifecycle transition: % -> %',OLD.status,NEW.status USING ERRCODE='23514';
  END IF;
  IF NEW.script->>'status' IS DISTINCT FROM NEW.status THEN RAISE EXCEPTION 'AI Story Script artifact status must match durable status' USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('FROZEN','SUPERSEDED') AND (NEW.script-'status') IS DISTINCT FROM (OLD.script-'status') THEN RAISE EXCEPTION 'Frozen AI Story Script content is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_story_script_lifecycle_v1 ON ai_story_script_versions;
CREATE TRIGGER ai_story_script_lifecycle_v1 BEFORE UPDATE ON ai_story_script_versions FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_script_lifecycle_v1();

DROP POLICY IF EXISTS ai_story_script_select ON ai_story_script_versions;
CREATE POLICY ai_story_script_select ON ai_story_script_versions FOR SELECT TO authenticated USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()));
DROP POLICY IF EXISTS ai_story_script_insert ON ai_story_script_versions;
CREATE POLICY ai_story_script_insert ON ai_story_script_versions FOR INSERT TO authenticated WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));
DROP POLICY IF EXISTS ai_story_script_update ON ai_story_script_versions;
CREATE POLICY ai_story_script_update ON ai_story_script_versions FOR UPDATE TO authenticated USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer'))) WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));
