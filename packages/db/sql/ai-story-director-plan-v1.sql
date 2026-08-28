CREATE TABLE IF NOT EXISTS ai_story_director_plan_versions (
  director_plan_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  outline_version_id uuid NOT NULL REFERENCES ai_story_outline_versions(outline_version_id) ON DELETE RESTRICT,
  script_version_id uuid NOT NULL REFERENCES ai_story_script_versions(script_version_id) ON DELETE RESTRICT,
  handoff_id uuid NOT NULL REFERENCES ai_story_script_director_handoffs(handoff_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK(version > 0), contract_version text NOT NULL CHECK(contract_version='ai-story-director-plan.v1'),
  source_handoff_fingerprint text NOT NULL CHECK(source_handoff_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  source_hash text NOT NULL CHECK(source_hash ~ '^sha256:[0-9a-f]{64}$'), director_fingerprint text NOT NULL CHECK(director_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('DRAFT','VALIDATED','APPROVED','FROZEN','SUPERSEDED')),
  supersedes_director_plan_id uuid REFERENCES ai_story_director_plan_versions(director_plan_id) ON DELETE RESTRICT,
  director_plan jsonb NOT NULL, created_by uuid NOT NULL, created_at timestamptz NOT NULL,
  approved_by uuid, approved_at timestamptz, frozen_at timestamptz,
  CONSTRAINT ai_story_director_plan_story_version_unique UNIQUE(story_id,version),
  CONSTRAINT ai_story_director_plan_source_unique UNIQUE(story_id,source_hash),
  CONSTRAINT ai_story_director_plan_fingerprint_unique UNIQUE(story_id,director_fingerprint)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_plan_version_positive') THEN ALTER TABLE ai_story_director_plan_versions ADD CONSTRAINT ai_story_director_plan_version_positive CHECK(version>0); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_plan_contract_check') THEN ALTER TABLE ai_story_director_plan_versions ADD CONSTRAINT ai_story_director_plan_contract_check CHECK(contract_version='ai-story-director-plan.v1'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_plan_handoff_hash_check') THEN ALTER TABLE ai_story_director_plan_versions ADD CONSTRAINT ai_story_director_plan_handoff_hash_check CHECK(source_handoff_fingerprint ~ '^sha256:[0-9a-f]{64}$'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_plan_source_hash_check') THEN ALTER TABLE ai_story_director_plan_versions ADD CONSTRAINT ai_story_director_plan_source_hash_check CHECK(source_hash ~ '^sha256:[0-9a-f]{64}$'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_plan_fingerprint_check') THEN ALTER TABLE ai_story_director_plan_versions ADD CONSTRAINT ai_story_director_plan_fingerprint_check CHECK(director_fingerprint ~ '^sha256:[0-9a-f]{64}$'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_plan_status_check') THEN ALTER TABLE ai_story_director_plan_versions ADD CONSTRAINT ai_story_director_plan_status_check CHECK(status IN('DRAFT','VALIDATED','APPROVED','FROZEN','SUPERSEDED')); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_director_plan_supersedes_fk') THEN ALTER TABLE ai_story_director_plan_versions ADD CONSTRAINT ai_story_director_plan_supersedes_fk FOREIGN KEY(supersedes_director_plan_id) REFERENCES ai_story_director_plan_versions(director_plan_id) ON DELETE RESTRICT; END IF;
END $$;
CREATE INDEX IF NOT EXISTS ai_story_director_plan_workspace_idx ON ai_story_director_plan_versions(workspace_id,story_id,version);
ALTER TABLE ai_story_director_plan_versions ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION enforce_ai_story_director_plan_freeze_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('FROZEN','SUPERSEDED') AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'Frozen Director plan is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status='FROZEN' AND NEW.status NOT IN ('FROZEN','SUPERSEDED') THEN RAISE EXCEPTION 'Invalid Director lifecycle transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_story_director_plan_freeze_v1 ON ai_story_director_plan_versions;
CREATE TRIGGER ai_story_director_plan_freeze_v1 BEFORE UPDATE ON ai_story_director_plan_versions FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_director_plan_freeze_v1();
DROP POLICY IF EXISTS ai_story_director_plan_select ON ai_story_director_plan_versions;
CREATE POLICY ai_story_director_plan_select ON ai_story_director_plan_versions FOR SELECT TO authenticated USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()));
DROP POLICY IF EXISTS ai_story_director_plan_insert ON ai_story_director_plan_versions;
CREATE POLICY ai_story_director_plan_insert ON ai_story_director_plan_versions FOR INSERT TO authenticated WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN('admin','operator','editor','reviewer')));
DROP POLICY IF EXISTS ai_story_director_plan_update ON ai_story_director_plan_versions;
CREATE POLICY ai_story_director_plan_update ON ai_story_director_plan_versions FOR UPDATE TO authenticated USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN('admin','operator','editor','reviewer'))) WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN('admin','operator','editor','reviewer')));
