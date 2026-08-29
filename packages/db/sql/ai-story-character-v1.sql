CREATE TABLE IF NOT EXISTS ai_story_characters (
  character_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  current_version integer NOT NULL CHECK (current_version > 0),
  current_character_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','DELETED')),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ai_story_character_versions (
  character_version_id uuid PRIMARY KEY,
  character_id uuid NOT NULL REFERENCES ai_story_characters(character_id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  contract_version text NOT NULL CHECK (contract_version = 'ai-story-character.v1'),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE','DELETED')),
  supersedes_character_version_id uuid REFERENCES ai_story_character_versions(character_version_id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_character_version_unique UNIQUE (character_id, version),
  CONSTRAINT ai_story_character_fingerprint_unique UNIQUE (character_id, fingerprint)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_story_character_current_version_fk') THEN
    ALTER TABLE ai_story_characters ADD CONSTRAINT ai_story_character_current_version_fk
      FOREIGN KEY (current_character_version_id) REFERENCES ai_story_character_versions(character_version_id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_story_characters_campaign_idx ON ai_story_characters(campaign_id, status, name);
CREATE INDEX IF NOT EXISTS ai_story_characters_workspace_idx ON ai_story_characters(workspace_id, campaign_id);
CREATE INDEX IF NOT EXISTS ai_story_character_versions_campaign_idx ON ai_story_character_versions(campaign_id, character_id, version);

CREATE OR REPLACE FUNCTION protect_ai_story_character_version_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI Story Character authority versions are immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS ai_story_character_version_immutable_v1 ON ai_story_character_versions;
CREATE TRIGGER ai_story_character_version_immutable_v1 BEFORE UPDATE ON ai_story_character_versions
FOR EACH ROW EXECUTE FUNCTION protect_ai_story_character_version_v1();

CREATE OR REPLACE FUNCTION enforce_ai_story_character_aggregate_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.character_id IS DISTINCT FROM OLD.character_id OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AI Story Character ownership identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.current_version <> OLD.current_version + 1 THEN
    RAISE EXCEPTION 'AI Story Character version must advance exactly once' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'DELETED' THEN
    RAISE EXCEPTION 'Deleted AI Story Character cannot be mutated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_story_character_aggregate_v1 ON ai_story_characters;
CREATE TRIGGER ai_story_character_aggregate_v1 BEFORE UPDATE ON ai_story_characters
FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_character_aggregate_v1();

ALTER TABLE ai_story_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_character_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_characters_select ON ai_story_characters;
CREATE POLICY ai_story_characters_select ON ai_story_characters FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS ai_story_characters_insert ON ai_story_characters;
CREATE POLICY ai_story_characters_insert ON ai_story_characters FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));
DROP POLICY IF EXISTS ai_story_characters_update ON ai_story_characters;
CREATE POLICY ai_story_characters_update ON ai_story_characters FOR UPDATE TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')))
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));

DROP POLICY IF EXISTS ai_story_character_versions_select ON ai_story_character_versions;
CREATE POLICY ai_story_character_versions_select ON ai_story_character_versions FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS ai_story_character_versions_insert ON ai_story_character_versions;
CREATE POLICY ai_story_character_versions_insert ON ai_story_character_versions FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));

REVOKE UPDATE, DELETE ON ai_story_character_versions FROM authenticated;
