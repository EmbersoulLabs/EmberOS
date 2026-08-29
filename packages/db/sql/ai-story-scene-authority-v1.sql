-- Additive provider-neutral Location and canonical Scene authority.
CREATE TABLE IF NOT EXISTS ai_story_locations (
  location_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid REFERENCES ai_stories(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('CAMPAIGN_LOCATION','STORY_LOCATION')),
  current_version integer NOT NULL CHECK (current_version > 0),
  current_location_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','DELETED')),
  display_name text NOT NULL CHECK (length(trim(display_name)) > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  deleted_at timestamptz,
  CONSTRAINT ai_story_location_owner_check CHECK (
    (scope='CAMPAIGN_LOCATION' AND story_id IS NULL) OR
    (scope='STORY_LOCATION' AND story_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS ai_story_location_versions (
  location_version_id uuid PRIMARY KEY,
  location_id uuid NOT NULL REFERENCES ai_story_locations(location_id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid REFERENCES ai_stories(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('CAMPAIGN_LOCATION','STORY_LOCATION')),
  version integer NOT NULL CHECK (version > 0),
  contract_version text NOT NULL CHECK (contract_version='ai-story-location.v1'),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE','DELETED')),
  supersedes_location_version_id uuid REFERENCES ai_story_location_versions(location_version_id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_location_version_unique UNIQUE (location_id,version),
  CONSTRAINT ai_story_location_fingerprint_unique UNIQUE (location_id,fingerprint),
  CONSTRAINT ai_story_location_version_owner_check CHECK (
    (scope='CAMPAIGN_LOCATION' AND story_id IS NULL) OR
    (scope='STORY_LOCATION' AND story_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS ai_story_location_promotions (
  promotion_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  source_scope text NOT NULL CHECK (source_scope IN ('EPHEMERAL_ENVIRONMENT','STORY_LOCATION')),
  source_id uuid NOT NULL,
  target_scope text NOT NULL CHECK (target_scope IN ('STORY_LOCATION','CAMPAIGN_LOCATION')),
  target_id uuid NOT NULL,
  promotion jsonb NOT NULL,
  promoted_by uuid NOT NULL,
  promoted_at timestamptz NOT NULL,
  CONSTRAINT ai_story_location_promotion_source_unique UNIQUE (source_scope,source_id),
  CONSTRAINT ai_story_location_promotion_direction CHECK (
    (source_scope='EPHEMERAL_ENVIRONMENT' AND target_scope='STORY_LOCATION') OR
    (source_scope='STORY_LOCATION' AND target_scope='CAMPAIGN_LOCATION')
  )
);

CREATE TABLE IF NOT EXISTS ai_story_canonical_scenes (
  scene_id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  current_version integer NOT NULL CHECK (current_version > 0),
  current_scene_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','VALIDATED','APPROVED','FROZEN','SUPERSEDED')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_story_canonical_scene_versions (
  scene_version_id uuid PRIMARY KEY,
  scene_id uuid NOT NULL REFERENCES ai_story_canonical_scenes(scene_id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL REFERENCES ai_stories(id) ON DELETE RESTRICT,
  story_version_id uuid NOT NULL REFERENCES ai_story_versions(id) ON DELETE RESTRICT,
  script_version_id uuid NOT NULL REFERENCES ai_story_script_versions(script_version_id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  scene_order integer NOT NULL CHECK (scene_order >= 0),
  contract_version text NOT NULL CHECK (contract_version='ai-story-scene.v1'),
  source_hash text NOT NULL CHECK (source_hash ~ '^sha256:[0-9a-f]{64}$'),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('DRAFT','VALIDATED','APPROVED','FROZEN','SUPERSEDED')),
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  frozen_at timestamptz,
  CONSTRAINT ai_story_canonical_scene_version_unique UNIQUE (scene_id,version),
  CONSTRAINT ai_story_canonical_scene_fingerprint_unique UNIQUE (scene_id,fingerprint)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_location_current_version_fk') THEN
    ALTER TABLE ai_story_locations ADD CONSTRAINT ai_story_location_current_version_fk
      FOREIGN KEY (current_location_version_id) REFERENCES ai_story_location_versions(location_version_id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='ai_story_canonical_scene_current_version_fk') THEN
    ALTER TABLE ai_story_canonical_scenes ADD CONSTRAINT ai_story_canonical_scene_current_version_fk
      FOREIGN KEY (current_scene_version_id) REFERENCES ai_story_canonical_scene_versions(scene_version_id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_story_locations_campaign_idx ON ai_story_locations(campaign_id,scope,status);
CREATE INDEX IF NOT EXISTS ai_story_locations_story_idx ON ai_story_locations(story_id,scope,status);
CREATE INDEX IF NOT EXISTS ai_story_location_versions_scope_idx ON ai_story_location_versions(workspace_id,campaign_id,story_id,location_id);
CREATE INDEX IF NOT EXISTS ai_story_location_promotions_story_idx ON ai_story_location_promotions(story_id,promoted_at);
CREATE INDEX IF NOT EXISTS ai_story_canonical_scenes_story_idx ON ai_story_canonical_scenes(story_id,status);
CREATE INDEX IF NOT EXISTS ai_story_canonical_scene_versions_story_order_idx ON ai_story_canonical_scene_versions(story_version_id,scene_order);
CREATE INDEX IF NOT EXISTS ai_story_canonical_scene_versions_script_idx ON ai_story_canonical_scene_versions(script_version_id,scene_id);

CREATE OR REPLACE FUNCTION protect_ai_story_location_version_v1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  RAISE EXCEPTION 'AI Story Location versions are immutable' USING ERRCODE='23514';
END $$;
DROP TRIGGER IF EXISTS ai_story_location_version_immutable_v1 ON ai_story_location_versions;
CREATE TRIGGER ai_story_location_version_immutable_v1 BEFORE UPDATE ON ai_story_location_versions FOR EACH ROW EXECUTE FUNCTION protect_ai_story_location_version_v1();

CREATE OR REPLACE FUNCTION protect_ai_story_canonical_scene_version_v1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.status IN ('FROZEN','SUPERSEDED') AND (to_jsonb(NEW)-'status') IS DISTINCT FROM (to_jsonb(OLD)-'status') THEN RAISE EXCEPTION 'Frozen canonical Scene truth is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.status='FROZEN' AND NEW.status NOT IN ('FROZEN','SUPERSEDED') THEN RAISE EXCEPTION 'Invalid canonical Scene lifecycle transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_story_canonical_scene_version_immutable_v1 ON ai_story_canonical_scene_versions;
CREATE TRIGGER ai_story_canonical_scene_version_immutable_v1 BEFORE UPDATE ON ai_story_canonical_scene_versions FOR EACH ROW EXECUTE FUNCTION protect_ai_story_canonical_scene_version_v1();

CREATE OR REPLACE FUNCTION enforce_ai_story_location_aggregate_v1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.story_id IS DISTINCT FROM OLD.story_id OR NEW.scope IS DISTINCT FROM OLD.scope OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Location ownership identity and scope are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.current_version <> OLD.current_version + 1 THEN RAISE EXCEPTION 'Location version must advance exactly once' USING ERRCODE='23514'; END IF;
  IF OLD.status='DELETED' THEN RAISE EXCEPTION 'Deleted Location cannot be mutated' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_story_location_aggregate_v1 ON ai_story_locations;
CREATE TRIGGER ai_story_location_aggregate_v1 BEFORE UPDATE ON ai_story_locations FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_location_aggregate_v1();

CREATE OR REPLACE FUNCTION enforce_ai_story_canonical_scene_aggregate_v1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.scene_id IS DISTINCT FROM OLD.scene_id OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id OR NEW.story_id IS DISTINCT FROM OLD.story_id OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Canonical Scene identity and ownership are immutable' USING ERRCODE='23514';
  END IF;
  IF NEW.current_version <> OLD.current_version + 1 THEN RAISE EXCEPTION 'Canonical Scene version must advance exactly once' USING ERRCODE='23514'; END IF;
  IF OLD.status='SUPERSEDED' THEN RAISE EXCEPTION 'Superseded canonical Scene cannot mutate' USING ERRCODE='23514'; END IF;
  IF OLD.status='FROZEN' AND NEW.status<>'DRAFT' THEN RAISE EXCEPTION 'A frozen Scene may only advance to a new DRAFT revision' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_story_canonical_scene_aggregate_v1 ON ai_story_canonical_scenes;
CREATE TRIGGER ai_story_canonical_scene_aggregate_v1 BEFORE UPDATE ON ai_story_canonical_scenes FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_canonical_scene_aggregate_v1();

ALTER TABLE ai_story_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_location_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_location_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_canonical_scenes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_canonical_scene_versions ENABLE ROW LEVEL SECURITY;

DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['ai_story_locations','ai_story_location_versions','ai_story_location_promotions','ai_story_canonical_scenes','ai_story_canonical_scene_versions'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',table_name||'_select',table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid()))',table_name||'_select',table_name);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',table_name||'_insert',table_name);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN (''admin'',''operator'')))',table_name||'_insert',table_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS ai_story_locations_update ON ai_story_locations;
CREATE POLICY ai_story_locations_update ON ai_story_locations FOR UPDATE TO authenticated USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator'))) WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator')));
DROP POLICY IF EXISTS ai_story_canonical_scenes_update ON ai_story_canonical_scenes;
CREATE POLICY ai_story_canonical_scenes_update ON ai_story_canonical_scenes FOR UPDATE TO authenticated USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator'))) WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator')));

REVOKE UPDATE, DELETE ON ai_story_location_versions, ai_story_location_promotions FROM authenticated;
REVOKE DELETE ON ai_story_canonical_scene_versions FROM authenticated;

DROP POLICY IF EXISTS ai_story_canonical_scene_versions_update ON ai_story_canonical_scene_versions;
CREATE POLICY ai_story_canonical_scene_versions_update ON ai_story_canonical_scene_versions FOR UPDATE TO authenticated USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator'))) WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id=auth.uid() AND role IN ('admin','operator')));
