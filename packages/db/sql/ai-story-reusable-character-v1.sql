-- Additive workspace reusable Character library.
-- Workspace library is the reusable identity root.
-- Campaign Character authority remains the execution projection.
-- Historical versions stay readable. Persistence is not Provider execution.

CREATE TABLE IF NOT EXISTS ai_story_reusable_characters (
  reusable_character_id uuid PRIMARY KEY,
  org_id uuid NOT NULL CONSTRAINT as_rc_root_org_fk REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL CONSTRAINT as_rc_root_ws_fk REFERENCES workspaces(id) ON DELETE RESTRICT,
  current_version integer NOT NULL CHECK (current_version > 0),
  current_reusable_character_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','ARCHIVED','DELETED')),
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  archived_at timestamptz,
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS ai_story_reusable_character_versions (
  reusable_character_version_id uuid PRIMARY KEY,
  reusable_character_id uuid NOT NULL CONSTRAINT as_rc_ver_root_fk REFERENCES ai_story_reusable_characters(reusable_character_id) ON DELETE RESTRICT,
  org_id uuid NOT NULL CONSTRAINT as_rc_ver_org_fk REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL CONSTRAINT as_rc_ver_ws_fk REFERENCES workspaces(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  contract_version text NOT NULL CHECK (contract_version = 'ai-story-reusable-character.v1'),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  identity_fingerprint text NOT NULL CHECK (identity_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('ACTIVE','ARCHIVED','DELETED')),
  supersedes_reusable_character_version_id uuid CONSTRAINT as_rc_ver_supersede_fk REFERENCES ai_story_reusable_character_versions(reusable_character_version_id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_reusable_character_version_unique UNIQUE (reusable_character_id, version),
  CONSTRAINT ai_story_reusable_character_fingerprint_unique UNIQUE (reusable_character_id, fingerprint)
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_story_reusable_character_current_version_fk') THEN
    ALTER TABLE ai_story_reusable_characters ADD CONSTRAINT ai_story_reusable_character_current_version_fk
      FOREIGN KEY (current_reusable_character_version_id) REFERENCES ai_story_reusable_character_versions(reusable_character_version_id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_story_reusable_character_campaign_projections (
  projection_id uuid PRIMARY KEY,
  org_id uuid NOT NULL CONSTRAINT as_rc_proj_org_fk REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL CONSTRAINT as_rc_proj_ws_fk REFERENCES workspaces(id) ON DELETE RESTRICT,
  reusable_character_id uuid NOT NULL CONSTRAINT as_rc_proj_root_fk REFERENCES ai_story_reusable_characters(reusable_character_id) ON DELETE RESTRICT,
  reusable_character_version_id uuid NOT NULL CONSTRAINT as_rc_proj_ver_fk REFERENCES ai_story_reusable_character_versions(reusable_character_version_id) ON DELETE RESTRICT,
  reusable_character_fingerprint text NOT NULL,
  campaign_id uuid NOT NULL CONSTRAINT as_rc_proj_campaign_fk REFERENCES campaigns(id) ON DELETE RESTRICT,
  campaign_character_id uuid NOT NULL CONSTRAINT as_rc_proj_char_fk REFERENCES ai_story_characters(character_id) ON DELETE RESTRICT,
  campaign_character_version_id uuid NOT NULL CONSTRAINT as_rc_proj_char_ver_fk REFERENCES ai_story_character_versions(character_version_id) ON DELETE RESTRICT,
  campaign_character_fingerprint text NOT NULL,
  projection_fingerprint text NOT NULL CHECK (projection_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_reusable_character_campaign_projection_unique UNIQUE (reusable_character_version_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS ai_story_episode_character_bindings (
  episode_character_binding_id uuid PRIMARY KEY,
  org_id uuid NOT NULL CONSTRAINT as_ep_char_bind_org_fk REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL CONSTRAINT as_ep_char_bind_ws_fk REFERENCES workspaces(id) ON DELETE RESTRICT,
  story_id uuid NOT NULL CONSTRAINT as_ep_char_bind_story_fk REFERENCES ai_stories(id) ON DELETE RESTRICT,
  episode_id uuid NOT NULL,
  reusable_character_id uuid NOT NULL CONSTRAINT as_ep_char_bind_root_fk REFERENCES ai_story_reusable_characters(reusable_character_id) ON DELETE RESTRICT,
  reusable_character_version_id uuid NOT NULL CONSTRAINT as_ep_char_bind_ver_fk REFERENCES ai_story_reusable_character_versions(reusable_character_version_id) ON DELETE RESTRICT,
  campaign_character_id uuid NOT NULL CONSTRAINT as_ep_char_bind_char_fk REFERENCES ai_story_characters(character_id) ON DELETE RESTRICT,
  campaign_character_version_id uuid NOT NULL CONSTRAINT as_ep_char_bind_char_ver_fk REFERENCES ai_story_character_versions(character_version_id) ON DELETE RESTRICT,
  identity_fingerprint text NOT NULL,
  binding_fingerprint text NOT NULL CHECK (binding_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  snapshot jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  CONSTRAINT ai_story_episode_character_binding_unique UNIQUE (story_id, reusable_character_id, binding_fingerprint)
);

CREATE TABLE IF NOT EXISTS ai_story_character_continuity_anchors (
  anchor_id uuid PRIMARY KEY,
  org_id uuid NOT NULL CONSTRAINT as_char_anchor_org_fk REFERENCES organizations(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL CONSTRAINT as_char_anchor_ws_fk REFERENCES workspaces(id) ON DELETE RESTRICT,
  reusable_character_id uuid NOT NULL CONSTRAINT as_char_anchor_root_fk REFERENCES ai_story_reusable_characters(reusable_character_id) ON DELETE RESTRICT,
  reusable_character_version_id uuid NOT NULL CONSTRAINT as_char_anchor_ver_fk REFERENCES ai_story_reusable_character_versions(reusable_character_version_id) ON DELETE RESTRICT,
  source_episode_id uuid NOT NULL CONSTRAINT as_char_anchor_story_fk REFERENCES ai_stories(id) ON DELETE RESTRICT,
  source_generation_unit_id uuid NOT NULL,
  source_result_id uuid NOT NULL,
  asset_id uuid NOT NULL CONSTRAINT as_char_anchor_asset_fk REFERENCES assets(id) ON DELETE RESTRICT,
  content_hash text NOT NULL CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$'),
  frame_timestamp_ms integer,
  status text NOT NULL CHECK (status IN ('PROPOSED','APPROVED','REJECTED')),
  source text NOT NULL CHECK (source = 'ACCEPTED_GENERATED_RESULT'),
  snapshot jsonb NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ai_story_reusable_characters_workspace_idx
  ON ai_story_reusable_characters (workspace_id, status, name);
CREATE INDEX IF NOT EXISTS ai_story_reusable_character_versions_workspace_idx
  ON ai_story_reusable_character_versions (workspace_id, reusable_character_id, version);
CREATE INDEX IF NOT EXISTS ai_story_reusable_character_projection_campaign_idx
  ON ai_story_reusable_character_campaign_projections (campaign_id, reusable_character_id);
CREATE INDEX IF NOT EXISTS ai_story_episode_character_binding_story_idx
  ON ai_story_episode_character_bindings (story_id, reusable_character_id);
CREATE INDEX IF NOT EXISTS ai_story_character_continuity_anchor_character_idx
  ON ai_story_character_continuity_anchors (reusable_character_id, reusable_character_version_id, status);

CREATE OR REPLACE FUNCTION protect_ai_story_reusable_character_version_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI Story reusable Character versions are immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS ai_story_reusable_character_version_immutable_v1 ON ai_story_reusable_character_versions;
CREATE TRIGGER ai_story_reusable_character_version_immutable_v1 BEFORE UPDATE ON ai_story_reusable_character_versions
FOR EACH ROW EXECUTE FUNCTION protect_ai_story_reusable_character_version_v1();

CREATE OR REPLACE FUNCTION protect_ai_story_reusable_character_projection_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI Story reusable Character campaign projections are immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS ai_story_reusable_character_projection_immutable_v1 ON ai_story_reusable_character_campaign_projections;
CREATE TRIGGER ai_story_reusable_character_projection_immutable_v1 BEFORE UPDATE ON ai_story_reusable_character_campaign_projections
FOR EACH ROW EXECUTE FUNCTION protect_ai_story_reusable_character_projection_v1();

CREATE OR REPLACE FUNCTION protect_ai_story_episode_character_binding_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'AI Story Episode Character bindings are immutable' USING ERRCODE = '23514';
END $$;
DROP TRIGGER IF EXISTS ai_story_episode_character_binding_immutable_v1 ON ai_story_episode_character_bindings;
CREATE TRIGGER ai_story_episode_character_binding_immutable_v1 BEFORE UPDATE ON ai_story_episode_character_bindings
FOR EACH ROW EXECUTE FUNCTION protect_ai_story_episode_character_binding_v1();

CREATE OR REPLACE FUNCTION enforce_ai_story_reusable_character_aggregate_v1() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.reusable_character_id IS DISTINCT FROM OLD.reusable_character_id
     OR NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'AI Story reusable Character ownership identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.current_version <> OLD.current_version + 1 THEN
    RAISE EXCEPTION 'AI Story reusable Character version must advance exactly once' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'DELETED' THEN
    RAISE EXCEPTION 'Deleted AI Story reusable Character cannot be mutated' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_story_reusable_character_aggregate_v1 ON ai_story_reusable_characters;
CREATE TRIGGER ai_story_reusable_character_aggregate_v1 BEFORE UPDATE ON ai_story_reusable_characters
FOR EACH ROW EXECUTE FUNCTION enforce_ai_story_reusable_character_aggregate_v1();

ALTER TABLE ai_story_reusable_characters ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_reusable_character_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_reusable_character_campaign_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_episode_character_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_story_character_continuity_anchors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_story_reusable_characters_select ON ai_story_reusable_characters;
CREATE POLICY ai_story_reusable_characters_select ON ai_story_reusable_characters FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS ai_story_reusable_characters_insert ON ai_story_reusable_characters;
CREATE POLICY ai_story_reusable_characters_insert ON ai_story_reusable_characters FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));
DROP POLICY IF EXISTS ai_story_reusable_characters_update ON ai_story_reusable_characters;
CREATE POLICY ai_story_reusable_characters_update ON ai_story_reusable_characters FOR UPDATE TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')))
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));

DROP POLICY IF EXISTS ai_story_reusable_character_versions_select ON ai_story_reusable_character_versions;
CREATE POLICY ai_story_reusable_character_versions_select ON ai_story_reusable_character_versions FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS ai_story_reusable_character_versions_insert ON ai_story_reusable_character_versions;
CREATE POLICY ai_story_reusable_character_versions_insert ON ai_story_reusable_character_versions FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));

DROP POLICY IF EXISTS ai_story_reusable_character_projections_select ON ai_story_reusable_character_campaign_projections;
CREATE POLICY ai_story_reusable_character_projections_select ON ai_story_reusable_character_campaign_projections FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS ai_story_reusable_character_projections_insert ON ai_story_reusable_character_campaign_projections;
CREATE POLICY ai_story_reusable_character_projections_insert ON ai_story_reusable_character_campaign_projections FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));

DROP POLICY IF EXISTS ai_story_episode_character_bindings_select ON ai_story_episode_character_bindings;
CREATE POLICY ai_story_episode_character_bindings_select ON ai_story_episode_character_bindings FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS ai_story_episode_character_bindings_insert ON ai_story_episode_character_bindings;
CREATE POLICY ai_story_episode_character_bindings_insert ON ai_story_episode_character_bindings FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));

DROP POLICY IF EXISTS ai_story_character_continuity_anchors_select ON ai_story_character_continuity_anchors;
CREATE POLICY ai_story_character_continuity_anchors_select ON ai_story_character_continuity_anchors FOR SELECT TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()));
DROP POLICY IF EXISTS ai_story_character_continuity_anchors_insert ON ai_story_character_continuity_anchors;
CREATE POLICY ai_story_character_continuity_anchors_insert ON ai_story_character_continuity_anchors FOR INSERT TO authenticated
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));
DROP POLICY IF EXISTS ai_story_character_continuity_anchors_update ON ai_story_character_continuity_anchors;
CREATE POLICY ai_story_character_continuity_anchors_update ON ai_story_character_continuity_anchors FOR UPDATE TO authenticated
USING (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')))
WITH CHECK (workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid() AND role IN ('admin','operator')));

REVOKE UPDATE, DELETE ON ai_story_reusable_character_versions FROM authenticated;
REVOKE UPDATE, DELETE ON ai_story_reusable_character_campaign_projections FROM authenticated;
REVOKE UPDATE, DELETE ON ai_story_episode_character_bindings FROM authenticated;
