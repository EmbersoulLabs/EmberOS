CREATE TABLE IF NOT EXISTS ai_story_script_director_handoffs (
  handoff_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  outline_version_id uuid NOT NULL REFERENCES ai_story_outline_versions(outline_version_id) ON DELETE RESTRICT,
  script_version_id uuid NOT NULL REFERENCES ai_story_script_versions(script_version_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  contract_version text NOT NULL CHECK (contract_version = 'ai-story-script-director-handoff.v1'),
  script_source_hash text NOT NULL CHECK (script_source_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_hash text NOT NULL CHECK (source_hash ~ '^sha256:[0-9a-f]{64}$'),
  handoff_fingerprint text NOT NULL CHECK (handoff_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  authority_status text NOT NULL DEFAULT 'CURRENT' CHECK (authority_status IN ('CURRENT','SUPERSEDED')),
  supersedes_handoff_id uuid REFERENCES ai_story_script_director_handoffs(handoff_id) ON DELETE RESTRICT,
  handoff jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  frozen_at timestamptz NOT NULL,
  CONSTRAINT ai_story_director_handoff_script_unique UNIQUE (script_version_id),
  CONSTRAINT ai_story_director_handoff_story_version_unique UNIQUE (story_id, version),
  CONSTRAINT ai_story_director_handoff_story_fingerprint_unique UNIQUE (story_id, handoff_fingerprint)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_handoff_version_positive') THEN ALTER TABLE ai_story_script_director_handoffs ADD CONSTRAINT ai_story_director_handoff_version_positive CHECK(version>0); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_handoff_contract_check') THEN ALTER TABLE ai_story_script_director_handoffs ADD CONSTRAINT ai_story_director_handoff_contract_check CHECK(contract_version='ai-story-script-director-handoff.v1'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_handoff_script_hash_check') THEN ALTER TABLE ai_story_script_director_handoffs ADD CONSTRAINT ai_story_director_handoff_script_hash_check CHECK(script_source_hash ~ '^sha256:[0-9a-f]{64}$'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_handoff_source_hash_check') THEN ALTER TABLE ai_story_script_director_handoffs ADD CONSTRAINT ai_story_director_handoff_source_hash_check CHECK(source_hash ~ '^sha256:[0-9a-f]{64}$'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_handoff_fingerprint_check') THEN ALTER TABLE ai_story_script_director_handoffs ADD CONSTRAINT ai_story_director_handoff_fingerprint_check CHECK(handoff_fingerprint ~ '^sha256:[0-9a-f]{64}$'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_handoff_status_check') THEN ALTER TABLE ai_story_script_director_handoffs ADD CONSTRAINT ai_story_director_handoff_status_check CHECK(authority_status IN ('CURRENT','SUPERSEDED')); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_handoff_supersedes_fk') THEN ALTER TABLE ai_story_script_director_handoffs ADD CONSTRAINT ai_story_director_handoff_supersedes_fk FOREIGN KEY(supersedes_handoff_id) REFERENCES ai_story_script_director_handoffs(handoff_id) ON DELETE RESTRICT; END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_story_director_handoff_workspace_idx ON ai_story_script_director_handoffs(workspace_id, story_id, version);
ALTER TABLE ai_story_script_director_handoffs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION enforce_ai_story_director_handoff_immutability_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(NEW) - 'authority_status') IS DISTINCT FROM (to_jsonb(OLD) - 'authority_status') THEN
    RAISE EXCEPTION 'AI Story Script Director handoff is immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.authority_status IS DISTINCT FROM OLD.authority_status AND NOT (OLD.authority_status='CURRENT' AND NEW.authority_status='SUPERSEDED') THEN
    RAISE EXCEPTION 'Invalid Script Director handoff lifecycle transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_story_director_handoff_immutability_v1 ON ai_story_script_director_handoffs;
CREATE TRIGGER ai_story_director_handoff_immutability_v1 BEFORE UPDATE ON ai_story_script_director_handoffs FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_director_handoff_immutability_v1();

DROP POLICY IF EXISTS ai_story_director_handoff_select ON ai_story_script_director_handoffs;
CREATE POLICY ai_story_director_handoff_select ON ai_story_script_director_handoffs FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()));
DROP POLICY IF EXISTS ai_story_director_handoff_insert ON ai_story_script_director_handoffs;
CREATE POLICY ai_story_director_handoff_insert ON ai_story_script_director_handoffs FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));
DROP POLICY IF EXISTS ai_story_director_handoff_update ON ai_story_script_director_handoffs;
CREATE POLICY ai_story_director_handoff_update ON ai_story_script_director_handoffs FOR UPDATE TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')))
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator','editor','reviewer')));
